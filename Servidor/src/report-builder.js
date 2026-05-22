const { config } = require("./config");
const { distanceKm } = require("./lib/geo");
const { getClimateNews } = require("./providers/news");
const { getDashboardData, getNearestObservation } = require("./providers/inmet");

const SOON_WINDOW_MINUTES = 6 * 60;
const URGENT_WINDOW_MINUTES = 3 * 60;

async function buildClimateReport() {
  const dashboard = await getDashboardData({ limit: config.alertLimit });
  const [stationSnapshot, newsBundle] = await Promise.all([
    collectStationSamples(config.stationSamples),
    getClimateNews({ limit: 6 })
  ]);

  const alerts = Array.isArray(dashboard.alerts)
    ? dashboard.alerts.map((alert) => toReportAlert(alert, stationSnapshot.items))
    : [];
  const activeAlerts = alerts.filter((alert) => alert.phase === "ongoing" || alert.phase === "upcoming");
  const highestSeverity = deriveHighestSeverity(dashboard.summary && dashboard.summary.byLevel);
  const hottestStation = findMaxMetric(stationSnapshot.items, "airTemperature");
  const coldestStation = findMinMetric(stationSnapshot.items, "airTemperature");
  const wettestStation = findMaxMetric(stationSnapshot.items, "precipitationLastHour");
  const windiestStation = findMaxMetric(stationSnapshot.items, "windGust") || findMaxMetric(stationSnapshot.items, "windSpeed");
  const analysis = buildAnalysis({
    alerts,
    activeAlerts,
    stationItems: stationSnapshot.items,
    highestSeverity,
    hottestStation,
    coldestStation,
    wettestStation,
    windiestStation
  });
  const generatedAt = new Date().toISOString();

  return {
    reportKey: config.reportKey,
    generatedAt,
    cadenceMinutes: config.reportCadenceMinutes,
    description: "Relatório consolidado para monitoramento climático, operado por agendamento e armazenado na Supabase.",
    summary: {
      totalAlerts: alerts.length,
      activeAlerts: activeAlerts.length,
      statesAffected: Array.isArray(dashboard.summary && dashboard.summary.states)
        ? dashboard.summary.states.length
        : 0,
      stationsSampled: stationSnapshot.items.length,
      newsItems: newsBundle.items.length,
      highestSeverity: highestSeverity.label,
      hottestTemperatureC: hottestStation ? hottestStation.metrics.airTemperature.valueNumber : null,
      wettestHourMm: wettestStation ? wettestStation.metrics.precipitationLastHour.valueNumber : null,
      latestAlertPublication: dashboard.summary && dashboard.summary.latestPublication
        ? dashboard.summary.latestPublication
        : null,
      alertsWithGeometry: analysis.coverage.alertsWithGeometry,
      alertsExpiringSoon: analysis.riskWindow.expiringWithin6Hours,
      alertsStartingSoon: analysis.riskWindow.upcomingWithin6Hours,
      topAffectedState: analysis.hotspotsByState[0] ? analysis.hotspotsByState[0].state : null,
      dominantEvent: analysis.eventClusters[0] ? analysis.eventClusters[0].event : null
    },
    highlights: buildHighlights({
      activeAlerts,
      highestSeverity,
      hottestStation,
      wettestStation,
      analysis
    }),
    analysis,
    mapInsights: buildMapInsights({
      analysis,
      stationItems: stationSnapshot.items
    }),
    severityBreakdown: {
      verm: countOf(dashboard.summary && dashboard.summary.byLevel, "verm"),
      lar: countOf(dashboard.summary && dashboard.summary.byLevel, "lar"),
      ama: countOf(dashboard.summary && dashboard.summary.byLevel, "ama")
    },
    phaseBreakdown: {
      ongoing: countOf(dashboard.summary && dashboard.summary.byPhase, "ongoing"),
      upcoming: countOf(dashboard.summary && dashboard.summary.byPhase, "upcoming"),
      expired: countOf(dashboard.summary && dashboard.summary.byPhase, "expired"),
      cancelled: countOf(dashboard.summary && dashboard.summary.byPhase, "cancelled")
    },
    sources: [
      {
        id: "inmet-alerts",
        label: "INMET Alertas",
        status: dashboard.stale ? "stale" : "ok",
        updatedAt: dashboard.generatedAt || generatedAt,
        detail: alerts.length + " alertas consolidados do feed oficial."
      },
      {
        id: "inmet-stations",
        label: "INMET Estações",
        status: stationSnapshot.failed > 0 ? "partial" : "ok",
        updatedAt: stationSnapshot.latestObservedAt,
        detail: stationSnapshot.items.length + " regiões amostradas; " + stationSnapshot.failed + " falha(s)."
      },
      ...newsBundle.sources.map((source) => ({
        ...source,
        updatedAt: generatedAt
      }))
    ],
    links: {
      officialCatalog: dashboard.links && dashboard.links.officialCatalog ? dashboard.links.officialCatalog : null,
      officialAlertsFeed: dashboard.links && dashboard.links.officialAlertsFeed ? dashboard.links.officialAlertsFeed : null
    },
    alerts,
    sampleStations: stationSnapshot.items,
    news: newsBundle.items,
    mapDefaults: {
      center: [-15, -52],
      zoom: 4
    }
  };
}

async function collectStationSamples(locations) {
  const settled = await Promise.allSettled(
    locations.map(async (location) => {
      const payload = await getNearestObservation(location.lat, location.lng);
      return {
        key: location.key,
        label: location.label,
        region: location.region,
        requestedPosition: payload.requestedPosition,
        distanceKm: payload.distanceKm,
        station: payload.station,
        observedAt: payload.observation ? payload.observation.observedAt : null,
        metrics: mapObservationMetrics(payload.observation && payload.observation.metrics)
      };
    })
  );

  const items = [];
  let failed = 0;
  let latestObservedAt = null;

  settled.forEach((result) => {
    if (result.status === "fulfilled") {
      items.push(result.value);

      if (result.value.observedAt && (!latestObservedAt || new Date(result.value.observedAt) > new Date(latestObservedAt))) {
        latestObservedAt = result.value.observedAt;
      }

      return;
    }

    failed += 1;
  });

  return {
    items,
    failed,
    latestObservedAt
  };
}

function mapObservationMetrics(metrics) {
  return {
    airTemperature: normalizeMetric(metrics && metrics.airTemperature),
    dewPoint: normalizeMetric(metrics && metrics.dewPoint),
    relativeHumidity: normalizeMetric(metrics && metrics.relativeHumidity),
    windSpeed: normalizeMetric(metrics && metrics.windSpeed),
    windDirection: normalizeMetric(metrics && metrics.windDirection),
    windGust: normalizeMetric(metrics && metrics.windGust),
    precipitationLastHour: normalizeMetric(metrics && metrics.precipitationLastHour),
    pressure: normalizeMetric(metrics && metrics.pressure)
  };
}

function normalizeMetric(metric) {
  if (!metric) {
    return null;
  }

  const valueNumber = Number(metric.value);

  return {
    value: metric.value,
    units: metric.units || "",
    description: metric.description || null,
    valueNumber: Number.isFinite(valueNumber) ? valueNumber : null
  };
}

function toReportAlert(alert, stationItems) {
  const timing = buildTimingMeta(alert);

  return {
    id: alert.id,
    source: alert.source,
    headline: alert.headline,
    event: alert.event,
    description: alert.description,
    instruction: alert.instruction,
    level: alert.level,
    phase: alert.phase,
    publishedAt: alert.publishedAt,
    onset: alert.onset,
    expires: alert.expires,
    webUrl: alert.webUrl,
    urgency: alert.urgency || null,
    severity: alert.severity || null,
    certainty: alert.certainty || null,
    responseType: alert.responseType || null,
    timing,
    nearbyStation: summarizeNearbyStation(alert.area && alert.area.centroid, stationItems),
    area: {
      description: alert.area && alert.area.description ? alert.area.description : "",
      states: alert.area && Array.isArray(alert.area.states) ? alert.area.states : [],
      stateNames: alert.area && Array.isArray(alert.area.stateNames) ? alert.area.stateNames : [],
      stateCount: alert.area && Array.isArray(alert.area.states) ? alert.area.states.length : 0,
      municipalityCount: alert.area && alert.area.municipalityCount ? alert.area.municipalityCount : 0,
      municipalitiesPreview: alert.area && Array.isArray(alert.area.municipalitiesPreview)
        ? alert.area.municipalitiesPreview
        : [],
      geometry: alert.area ? alert.area.geometry : null,
      geometryType: alert.area && alert.area.geometry ? alert.area.geometry.type : null,
      centroid: alert.area ? alert.area.centroid : null,
      bbox: alert.area ? alert.area.bbox : null
    }
  };
}

function buildTimingMeta(alert) {
  const now = Date.now();
  const onsetTime = parseDateValue(alert && alert.onset);
  const expiresTime = parseDateValue(alert && alert.expires);
  const startsInMinutes = onsetTime ? Math.round((onsetTime - now) / 60_000) : null;
  const expiresInMinutes = expiresTime ? Math.round((expiresTime - now) / 60_000) : null;
  const durationHours = onsetTime && expiresTime
    ? roundNumber((expiresTime - onsetTime) / 3_600_000, 1)
    : null;

  return {
    startsInMinutes: Number.isFinite(startsInMinutes) ? startsInMinutes : null,
    expiresInMinutes: Number.isFinite(expiresInMinutes) ? expiresInMinutes : null,
    durationHours: Number.isFinite(durationHours) ? durationHours : null,
    isStartingSoon: startsInMinutes !== null && startsInMinutes > 0 && startsInMinutes <= SOON_WINDOW_MINUTES,
    isExpiringSoon: expiresInMinutes !== null && expiresInMinutes > 0 && expiresInMinutes <= SOON_WINDOW_MINUTES
  };
}

function summarizeNearbyStation(point, stationItems) {
  if (!point || !Array.isArray(stationItems) || !stationItems.length) {
    return null;
  }

  const nearest = stationItems.reduce((best, item) => {
    const position = item && item.station && item.station.position;
    if (!position) {
      return best;
    }

    const candidateDistance = distanceKm(point.lat, point.lng, position.lat, position.lng);
    if (!best || candidateDistance < best.distanceKm) {
      return {
        item,
        distanceKm: candidateDistance
      };
    }

    return best;
  }, null);

  if (!nearest) {
    return null;
  }

  return {
    key: nearest.item.key,
    label: nearest.item.label,
    region: nearest.item.region,
    distanceKm: roundNumber(nearest.distanceKm, 1),
    observedAt: nearest.item.observedAt,
    station: {
      name: nearest.item.station && nearest.item.station.name ? nearest.item.station.name : "Estação INMET",
      traditionalId: nearest.item.station && nearest.item.station.traditionalId ? nearest.item.station.traditionalId : null
    },
    metrics: {
      airTemperature: normalizeMetric(nearest.item.metrics && nearest.item.metrics.airTemperature),
      relativeHumidity: normalizeMetric(nearest.item.metrics && nearest.item.metrics.relativeHumidity),
      precipitationLastHour: normalizeMetric(nearest.item.metrics && nearest.item.metrics.precipitationLastHour),
      windSpeed: normalizeMetric(nearest.item.metrics && nearest.item.metrics.windSpeed),
      windGust: normalizeMetric(nearest.item.metrics && nearest.item.metrics.windGust)
    }
  };
}

function buildAnalysis(context) {
  const hotspotsByState = buildStateHotspots(context.activeAlerts);
  const eventClusters = buildEventClusters(context.activeAlerts);
  const largestAreaAlert = findLargestAreaAlert(context.activeAlerts);
  const statesAffected = Array.from(
    new Set(
      context.activeAlerts.flatMap((alert) => Array.isArray(alert.area && alert.area.states) ? alert.area.states : [])
    )
  ).sort();

  return {
    riskWindow: {
      ongoing: context.activeAlerts.filter((alert) => alert.phase === "ongoing").length,
      upcoming: context.activeAlerts.filter((alert) => alert.phase === "upcoming").length,
      expiringWithin3Hours: countAlertsByTiming(context.activeAlerts, "expiresInMinutes", URGENT_WINDOW_MINUTES),
      expiringWithin6Hours: countAlertsByTiming(context.activeAlerts, "expiresInMinutes", SOON_WINDOW_MINUTES),
      upcomingWithin6Hours: countAlertsByTiming(context.activeAlerts, "startsInMinutes", SOON_WINDOW_MINUTES)
    },
    coverage: {
      alertsWithGeometry: context.activeAlerts.filter((alert) => Boolean(alert.area && alert.area.geometry)).length,
      alertsWithCentroid: context.activeAlerts.filter((alert) => Boolean(alert.area && alert.area.centroid)).length,
      statesAffected,
      statesAffectedCount: statesAffected.length,
      largestAreaAlert: largestAreaAlert ? summarizeAreaAlert(largestAreaAlert) : null
    },
    hotspotsByState,
    eventClusters,
    stationExtremes: {
      hottest: summarizeStationExtreme(context.hottestStation, "airTemperature"),
      coldest: summarizeStationExtreme(context.coldestStation, "airTemperature"),
      wettest: summarizeStationExtreme(context.wettestStation, "precipitationLastHour"),
      windiest: summarizeStationExtreme(context.windiestStation, context.windiestStation && context.windiestStation.metrics.windGust ? "windGust" : "windSpeed")
    }
  };
}

function buildMapInsights(context) {
  return {
    alertCount: context.analysis.coverage.alertsWithCentroid || 0,
    geometryAlerts: context.analysis.coverage.alertsWithGeometry,
    stationMarkers: context.stationItems.filter((item) => Boolean(item.station && item.station.position)).length,
    expiringSoon: context.analysis.riskWindow.expiringWithin6Hours,
    startingSoon: context.analysis.riskWindow.upcomingWithin6Hours,
    topState: context.analysis.hotspotsByState[0] || null,
    dominantEvent: context.analysis.eventClusters[0] || null
  };
}

function buildStateHotspots(alerts) {
  const byState = new Map();

  alerts.forEach((alert) => {
    const states = Array.isArray(alert.area && alert.area.states) ? alert.area.states : [];
    states.forEach((state) => {
      const current = byState.get(state) || {
        state,
        alertCount: 0,
        municipalityCoverage: 0,
        highestSeverityKey: "ama",
        eventTypes: new Set()
      };

      current.alertCount += 1;
      current.municipalityCoverage += Number(alert.area && alert.area.municipalityCount) || 0;
      current.highestSeverityKey = pickHigherLevel(current.highestSeverityKey, alert.level);
      current.eventTypes.add(alert.event || "Evento");
      byState.set(state, current);
    });
  });

  return Array.from(byState.values())
    .map((entry) => ({
      state: entry.state,
      alertCount: entry.alertCount,
      municipalityCoverage: entry.municipalityCoverage,
      highestSeverityKey: entry.highestSeverityKey,
      highestSeverityLabel: deriveLevelLabel(entry.highestSeverityKey),
      eventDiversity: entry.eventTypes.size
    }))
    .sort((left, right) => {
      if (right.alertCount !== left.alertCount) {
        return right.alertCount - left.alertCount;
      }

      if (levelRank(right.highestSeverityKey) !== levelRank(left.highestSeverityKey)) {
        return levelRank(right.highestSeverityKey) - levelRank(left.highestSeverityKey);
      }

      if (right.municipalityCoverage !== left.municipalityCoverage) {
        return right.municipalityCoverage - left.municipalityCoverage;
      }

      return left.state.localeCompare(right.state);
    })
    .slice(0, 6);
}

function buildEventClusters(alerts) {
  const byEvent = new Map();

  alerts.forEach((alert) => {
    const key = alert.event || "Evento";
    const current = byEvent.get(key) || {
      event: key,
      count: 0,
      highestSeverityKey: "ama",
      states: new Set()
    };

    current.count += 1;
    current.highestSeverityKey = pickHigherLevel(current.highestSeverityKey, alert.level);
    (Array.isArray(alert.area && alert.area.states) ? alert.area.states : []).forEach((state) => current.states.add(state));
    byEvent.set(key, current);
  });

  return Array.from(byEvent.values())
    .map((entry) => ({
      event: entry.event,
      count: entry.count,
      highestSeverityKey: entry.highestSeverityKey,
      highestSeverityLabel: deriveLevelLabel(entry.highestSeverityKey),
      statesAffected: entry.states.size
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      if (levelRank(right.highestSeverityKey) !== levelRank(left.highestSeverityKey)) {
        return levelRank(right.highestSeverityKey) - levelRank(left.highestSeverityKey);
      }

      return left.event.localeCompare(right.event);
    })
    .slice(0, 6);
}

function buildHighlights(context) {
  const topState = context.analysis.hotspotsByState[0];
  const dominantEvent = context.analysis.eventClusters[0];

  return [
    {
      id: "active-alerts",
      label: "Alertas em monitoramento",
      value: String(context.activeAlerts.length),
      tone: context.highestSeverity.key,
      detail: context.analysis.coverage.statesAffectedCount + " estado(s) com cobertura no painel."
    },
    {
      id: "expiring-window",
      label: "Vencendo em 6h",
      value: String(context.analysis.riskWindow.expiringWithin6Hours),
      tone: context.analysis.riskWindow.expiringWithin6Hours > 0 ? context.highestSeverity.key : "ama",
      detail: context.analysis.riskWindow.upcomingWithin6Hours + " alerta(s) com início nas próximas 6 horas."
    },
    {
      id: "state-hotspot",
      label: "Hotspot territorial",
      value: topState ? topState.state : "n/d",
      tone: topState ? topState.highestSeverityKey : "ama",
      detail: topState
        ? topState.alertCount + " alerta(s) e " + topState.eventDiversity + " tipo(s) de evento."
        : "Sem concentração territorial acima do restante do painel."
    },
    {
      id: "event-cluster",
      label: "Evento dominante",
      value: dominantEvent ? dominantEvent.event : "n/d",
      tone: dominantEvent ? dominantEvent.highestSeverityKey : "ama",
      detail: dominantEvent
        ? dominantEvent.count + " ocorrencia(s) distribuida(s) em " + dominantEvent.statesAffected + " UF(s)."
        : "Sem agrupamento de eventos relevante neste ciclo."
    },
    {
      id: "hottest-station",
      label: "Leitura mais quente",
      value: context.hottestStation
        ? formatMetric(context.hottestStation.metrics.airTemperature)
        : "n/d",
      tone: "warm",
      detail: context.hottestStation
        ? context.hottestStation.label + " · " + context.hottestStation.station.name
        : "Sem leitura útil nas estações amostradas."
    },
    {
      id: "wettest-station",
      label: "Maior chuva em 1h",
      value: context.wettestStation
        ? formatMetric(context.wettestStation.metrics.precipitationLastHour)
        : "n/d",
      tone: "rain",
      detail: context.wettestStation
        ? context.wettestStation.label + " · " + context.wettestStation.station.name
        : "Sem acumulado recente detectado."
    }
  ];
}

function summarizeAreaAlert(alert) {
  return {
    id: alert.id,
    headline: alert.headline,
    municipalityCount: Number(alert.area && alert.area.municipalityCount) || 0,
    stateCount: Number(alert.area && alert.area.stateCount) || 0,
    states: Array.isArray(alert.area && alert.area.states) ? alert.area.states : [],
    level: alert.level
  };
}

function summarizeStationExtreme(item, metricKey) {
  if (!item || !item.metrics || !item.metrics[metricKey]) {
    return null;
  }

  return {
    key: item.key,
    label: item.label,
    region: item.region,
    observedAt: item.observedAt,
    stationName: item.station && item.station.name ? item.station.name : "Estação INMET",
    distanceKm: item.distanceKm,
    metricKey,
    metric: normalizeMetric(item.metrics[metricKey])
  };
}

function findLargestAreaAlert(alerts) {
  return alerts.reduce((best, alert) => {
    const candidateCount = Number(alert.area && alert.area.municipalityCount) || 0;
    if (!best) {
      return alert;
    }

    const bestCount = Number(best.area && best.area.municipalityCount) || 0;
    if (candidateCount > bestCount) {
      return alert;
    }

    if (candidateCount === bestCount && levelRank(alert.level) > levelRank(best.level)) {
      return alert;
    }

    return best;
  }, null);
}

function countAlertsByTiming(alerts, fieldName, upperBoundMinutes) {
  return alerts.filter((alert) => {
    const value = alert && alert.timing ? alert.timing[fieldName] : null;
    return typeof value === "number" && value > 0 && value <= upperBoundMinutes;
  }).length;
}

function findMaxMetric(items, metricKey) {
  return items.reduce((best, item) => {
    const candidate = item.metrics && item.metrics[metricKey];
    if (!candidate || candidate.valueNumber === null) {
      return best;
    }

    if (!best) {
      return item;
    }

    const bestMetric = best.metrics && best.metrics[metricKey];
    if (!bestMetric || bestMetric.valueNumber === null || candidate.valueNumber > bestMetric.valueNumber) {
      return item;
    }

    return best;
  }, null);
}

function findMinMetric(items, metricKey) {
  return items.reduce((best, item) => {
    const candidate = item.metrics && item.metrics[metricKey];
    if (!candidate || candidate.valueNumber === null) {
      return best;
    }

    if (!best) {
      return item;
    }

    const bestMetric = best.metrics && best.metrics[metricKey];
    if (!bestMetric || bestMetric.valueNumber === null || candidate.valueNumber < bestMetric.valueNumber) {
      return item;
    }

    return best;
  }, null);
}

function deriveHighestSeverity(byLevel) {
  if (countOf(byLevel, "verm") > 0) {
    return { key: "verm", label: "Perigo" };
  }

  if (countOf(byLevel, "lar") > 0) {
    return { key: "lar", label: "Laranja" };
  }

  return { key: "ama", label: "Amarelo" };
}

function deriveLevelLabel(level) {
  if (level === "verm") {
    return "Perigo";
  }

  if (level === "lar") {
    return "Laranja";
  }

  return "Amarelo";
}

function pickHigherLevel(left, right) {
  return levelRank(right) > levelRank(left) ? right : left;
}

function levelRank(level) {
  if (level === "verm") {
    return 3;
  }

  if (level === "lar") {
    return 2;
  }

  return 1;
}

function formatMetric(metric) {
  if (!metric) {
    return "n/d";
  }

  return String(metric.value) + (metric.units ? " " + metric.units : "");
}

function parseDateValue(value) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundNumber(value, precision) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function countOf(object, key) {
  if (!object || typeof object[key] !== "number") {
    return 0;
  }

  return object[key];
}

module.exports = {
  buildClimateReport
};
