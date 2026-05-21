const { config } = require("./config");
const { getClimateNews } = require("./providers/news");
const { getDashboardData, getNearestObservation } = require("./providers/inmet");

async function buildClimateReport() {
  const dashboard = await getDashboardData({ limit: config.alertLimit });
  const [stationSnapshot, newsBundle] = await Promise.all([
    collectStationSamples(config.stationSamples),
    getClimateNews({ limit: 6 })
  ]);

  const alerts = Array.isArray(dashboard.alerts) ? dashboard.alerts.map(toReportAlert) : [];
  const activeAlerts = alerts.filter((alert) => alert.phase === "ongoing" || alert.phase === "upcoming");
  const highestSeverity = deriveHighestSeverity(dashboard.summary && dashboard.summary.byLevel);
  const hottestStation = findMaxMetric(stationSnapshot.items, "airTemperature");
  const wettestStation = findMaxMetric(stationSnapshot.items, "precipitationLastHour");
  const generatedAt = new Date().toISOString();

  return {
    reportKey: config.reportKey,
    generatedAt,
    cadenceMinutes: config.reportCadenceMinutes,
    description: "Relatorio consolidado para monitoramento climatico, operado por agendamento e armazenado na Supabase.",
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
        : null
    },
    highlights: buildHighlights({
      dashboard,
      stationSnapshot,
      highestSeverity,
      hottestStation,
      wettestStation
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
        label: "INMET Estacoes",
        status: stationSnapshot.failed > 0 ? "partial" : "ok",
        updatedAt: stationSnapshot.latestObservedAt,
        detail: stationSnapshot.items.length + " regioes amostradas; " + stationSnapshot.failed + " falha(s)."
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
    relativeHumidity: normalizeMetric(metrics && metrics.relativeHumidity),
    windSpeed: normalizeMetric(metrics && metrics.windSpeed),
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

function toReportAlert(alert) {
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
    area: {
      description: alert.area && alert.area.description ? alert.area.description : "",
      states: alert.area && Array.isArray(alert.area.states) ? alert.area.states : [],
      stateNames: alert.area && Array.isArray(alert.area.stateNames) ? alert.area.stateNames : [],
      municipalityCount: alert.area && alert.area.municipalityCount ? alert.area.municipalityCount : 0,
      municipalitiesPreview: alert.area && Array.isArray(alert.area.municipalitiesPreview)
        ? alert.area.municipalitiesPreview
        : [],
      geometry: alert.area ? alert.area.geometry : null,
      centroid: alert.area ? alert.area.centroid : null,
      bbox: alert.area ? alert.area.bbox : null
    }
  };
}

function buildHighlights(context) {
  const totalAlerts = countOf(context.dashboard.summary && context.dashboard.summary, "total");
  const statesAffected = Array.isArray(context.dashboard.summary && context.dashboard.summary.states)
    ? context.dashboard.summary.states.length
    : 0;

  return [
    {
      id: "active-alerts",
      label: "Alertas monitorados",
      value: String(totalAlerts),
      tone: context.highestSeverity.key,
      detail: statesAffected + " estado(s) com area afetada."
    },
    {
      id: "severity",
      label: "Maior severidade",
      value: context.highestSeverity.label,
      tone: context.highestSeverity.key,
      detail: "Baseado no feed CAP oficial do INMET."
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
        : "Sem leitura util nas estacoes amostradas."
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

function deriveHighestSeverity(byLevel) {
  if (countOf(byLevel, "verm") > 0) {
    return { key: "verm", label: "Perigo" };
  }

  if (countOf(byLevel, "lar") > 0) {
    return { key: "lar", label: "Laranja" };
  }

  return { key: "ama", label: "Amarelo" };
}

function formatMetric(metric) {
  if (!metric) {
    return "n/d";
  }

  return String(metric.value) + (metric.units ? " " + metric.units : "");
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
