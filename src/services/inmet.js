const { XMLParser } = require("fast-xml-parser");

const { MemoryCache } = require("../lib/memory-cache");
const {
  distanceKm,
  geometryBbox,
  geometryCenter,
  geometryFromRings,
  parseCapPolygon
} = require("../lib/geo");

const cache = new MemoryCache();
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false
});

const UPSTREAM_BASE_URL = "http://wis2bra.inmet.gov.br";
const ALERT_METADATA_ID = "urn:wmo:md:br-inmet:alerts";
const STATIONS_COLLECTION_URL = UPSTREAM_BASE_URL + "/oapi/collections/stations/items";
const SYNOP_COLLECTION_URL = UPSTREAM_BASE_URL + "/oapi/collections/urn:wmo:md:br-inmet:synop/items";
const ALERT_MESSAGES_URL = UPSTREAM_BASE_URL + "/oapi/collections/messages/items";
const DEFAULT_ALERT_LIMIT = clampInteger(process.env.ALERTABR_ALERT_OUTPUT_LIMIT, 80, 1, 120);
const ALERT_FEED_LIMIT = clampInteger(process.env.ALERTABR_ALERT_FEED_LIMIT, 120, 10, 250);
const ALERT_CACHE_TTL_MS = clampInteger(process.env.ALERTABR_ALERT_CACHE_TTL_MS, 5 * 60 * 1000, 60_000, 30 * 60 * 1000);
const STATIONS_CACHE_TTL_MS = clampInteger(process.env.ALERTABR_STATIONS_CACHE_TTL_MS, 12 * 60 * 60 * 1000, 5 * 60 * 1000, 24 * 60 * 60 * 1000);
const OBSERVATION_CACHE_TTL_MS = clampInteger(process.env.ALERTABR_OBSERVATION_CACHE_TTL_MS, 10 * 60 * 1000, 60_000, 60 * 60 * 1000);
const REQUEST_TIMEOUT_MS = clampInteger(process.env.ALERTABR_REQUEST_TIMEOUT_MS, 15_000, 5_000, 30_000);

async function getDashboardData(options = {}) {
  const alertsPayload = await getAlerts({
    ...options,
    activeOnly: true
  });

  return {
    source: "INMET",
    description: "Alertas CAP oficiais e observações de estações do INMET.",
    generatedAt: new Date().toISOString(),
    stale: alertsPayload.stale,
    cacheStatus: alertsPayload.cacheStatus,
    summary: alertsPayload.summary,
    alerts: alertsPayload.alerts,
    sourceHealth: alertsPayload.sourceHealth,
    links: {
      apiDocs: "/api/health",
      officialCatalog: UPSTREAM_BASE_URL + "/oapi/collections/discovery-metadata/items?f=json&limit=200",
      officialAlertsFeed: ALERT_MESSAGES_URL + "?f=json&metadata_id=" + encodeURIComponent(ALERT_METADATA_ID) + "&sortby=-pubtime"
    }
  };
}

async function getAlerts(options = {}) {
  const activeOnly = options.activeOnly !== false;
  const limit = clampInteger(options.limit, DEFAULT_ALERT_LIMIT, 1, 120);
  const filters = {
    state: typeof options.state === "string" ? options.state.trim().toUpperCase() : "",
    level: normalizeToken(options.level),
    phase: normalizeToken(options.phase),
    search: normalizeSearch(options.search)
  };

  const result = await cache.getOrRefresh("inmet-alerts-dashboard", ALERT_CACHE_TTL_MS, async () => {
    const notifications = await fetchAlertNotifications();
    const parsedAlerts = await mapWithConcurrency(notifications, 8, async (notification) => {
      const xmlUrl = getCanonicalXmlUrl(notification);
      if (!xmlUrl) {
        return null;
      }

      try {
        const xml = await fetchText(xmlUrl);
        const parsed = xmlParser.parse(xml);
        return normalizeAlert(notification, parsed);
      } catch (error) {
        return null;
      }
    });

    const dedupedAlerts = dedupeAlerts(parsedAlerts.filter(Boolean));
    const sortedAlerts = dedupedAlerts.sort(compareAlerts);

    return {
      alerts: sortedAlerts,
      summary: buildSummary(sortedAlerts),
      fetchedAt: new Date().toISOString(),
      upstream: {
        provider: "INMET",
        feedUrl: ALERT_MESSAGES_URL,
        metadataId: ALERT_METADATA_ID,
        notificationsFetched: notifications.length
      }
    };
  });

  const filteredAlerts = result.value.alerts.filter((alert) => {
    if (activeOnly && !isVisibleAlert(alert)) {
      return false;
    }

    if (
      filters.state &&
      !alert.area.states.includes(filters.state) &&
      !alert.area.stateNamesNormalized.includes(normalizeSearch(filters.state))
    ) {
      return false;
    }

    if (filters.level && alert.level !== filters.level) {
      return false;
    }

    if (filters.phase && alert.phase !== filters.phase) {
      return false;
    }

    if (filters.search && !buildSearchText(alert).includes(filters.search)) {
      return false;
    }

    return true;
  }).slice(0, limit);

  return {
    source: "INMET",
    generatedAt: new Date().toISOString(),
    stale: result.stale,
    cacheStatus: result.cacheStatus,
    filters: {
      activeOnly,
      ...filters
    },
    summary: buildSummary(filteredAlerts),
    alerts: filteredAlerts.map(serializeAlert),
    sourceHealth: {
      provider: "INMET",
      stale: result.stale,
      cachedAt: new Date(result.fetchedAt).toISOString(),
      upstream: result.value.upstream
    }
  };
}

async function getNearestObservation(lat, lng) {
  const stations = await getStations();
  if (!stations.length) {
    const error = new Error("Nenhuma estação oficial disponível.");
    error.statusCode = 503;
    throw error;
  }

  const nearestStation = stations.reduce((closest, candidate) => {
    const candidateDistance = distanceKm(lat, lng, candidate.position.lat, candidate.position.lng);
    if (!closest || candidateDistance < closest.distanceKm) {
      return {
        station: candidate,
        distanceKm: candidateDistance
      };
    }

    return closest;
  }, null);

  const observation = await getStationObservation(nearestStation.station.wigosId);

  return {
    source: "INMET",
    generatedAt: new Date().toISOString(),
    requestedPosition: {
      lat,
      lng
    },
    station: nearestStation.station,
    distanceKm: roundNumber(nearestStation.distanceKm, 1),
    observation
  };
}

function getServiceStatus() {
  const alertsEntry = cache.peek("inmet-alerts-dashboard");
  const stationsEntry = cache.peek("inmet-stations");

  return {
    provider: "INMET",
    alertsCache: formatCacheEntry(alertsEntry),
    stationsCache: formatCacheEntry(stationsEntry),
    upstreamBaseUrl: UPSTREAM_BASE_URL
  };
}

async function fetchAlertNotifications() {
  const url = new URL(ALERT_MESSAGES_URL);
  url.searchParams.set("f", "json");
  url.searchParams.set("limit", String(ALERT_FEED_LIMIT));
  url.searchParams.set("sortby", "-pubtime");
  url.searchParams.set("metadata_id", ALERT_METADATA_ID);

  const payload = await fetchJson(url.toString());
  return Array.isArray(payload.features) ? payload.features : [];
}

async function getStations() {
  const result = await cache.getOrRefresh("inmet-stations", STATIONS_CACHE_TTL_MS, async () => {
    const url = new URL(STATIONS_COLLECTION_URL);
    url.searchParams.set("f", "json");
    url.searchParams.set("limit", "2000");

    const payload = await fetchJson(url.toString());
    const features = Array.isArray(payload.features) ? payload.features : [];

    return features
      .map(normalizeStation)
      .filter(Boolean);
  });

  return result.value;
}

async function getStationObservation(wigosId) {
  const cacheKey = "station-observation:" + wigosId;
  const result = await cache.getOrRefresh(cacheKey, OBSERVATION_CACHE_TTL_MS, async () => {
    const url = new URL(SYNOP_COLLECTION_URL);
    url.searchParams.set("f", "json");
    url.searchParams.set("limit", "40");
    url.searchParams.set("sortby", "-reportTime");
    url.searchParams.set("wigos_station_identifier", wigosId);

    const payload = await fetchJson(url.toString());
    const features = Array.isArray(payload.features) ? payload.features : [];

    return normalizeObservation(features, wigosId);
  });

  return {
    ...result.value,
    stale: result.stale,
    cacheStatus: result.cacheStatus
  };
}

function normalizeAlert(notification, parsedXml) {
  const capAlert = parsedXml && parsedXml.alert;
  if (!capAlert) {
    return null;
  }

  const info = pickPortugueseInfo(capAlert.info);
  if (!info) {
    return null;
  }

  const areas = arrayify(info.area);
  const polygons = areas
    .map((area) => parseCapPolygon(area.polygon))
    .filter(Boolean);
  const geometry = geometryFromRings(polygons);
  const parameters = parameterMap(info.parameter);
  const stateNames = splitCommaList(parameters.Estados);
  const municipalities = parseMunicipalities(parameters.Municipios);
  const states = Array.from(new Set(municipalities.map((item) => item.state))).sort();
  const webUrl = normalizeDetailUrl(info.web);
  const noticeId = extractNoticeId(webUrl || notification?.properties?.data_id || "");
  const sentAt = capAlert.sent || notification?.properties?.pubtime || null;
  const publishedAt = notification?.properties?.pubtime || sentAt;
  const phase = derivePhase({
    status: capAlert.status,
    msgType: capAlert.msgType,
    onset: info.onset,
    expires: info.expires
  });

  return {
    id: noticeId || capAlert.identifier,
    noticeId,
    capIdentifier: capAlert.identifier,
    source: "INMET",
    status: capAlert.status,
    messageType: capAlert.msgType,
    event: info.event || "Aviso meteorológico",
    headline: info.headline || info.event || "Aviso meteorológico",
    description: info.description || "",
    instruction: info.instruction || "",
    responseType: info.responseType || null,
    urgency: info.urgency || null,
    severity: info.severity || null,
    certainty: info.certainty || null,
    level: deriveLevel(parameters.ColorRisk, info.severity),
    colorRisk: normalizeColor(parameters.ColorRisk),
    isCancellation: capAlert.msgType === "Cancel",
    publishedAt,
    sentAt,
    onset: info.onset || null,
    expires: info.expires || null,
    phase,
    webUrl,
    sourceUrls: {
      cap: getCanonicalXmlUrl(notification),
      detail: webUrl,
      catalog: ALERT_MESSAGES_URL + "?f=json&metadata_id=" + encodeURIComponent(ALERT_METADATA_ID)
    },
    area: {
      description: areas.map((item) => item.areaDesc).filter(Boolean).join(" | "),
      states,
      stateNames,
      stateNamesNormalized: stateNames.map(normalizeSearch),
      municipalities,
      municipalityCount: municipalities.length,
      geometry,
      bbox: geometryBbox(geometry),
      centroid: geometryCenter(geometry)
    },
    parameters: {
      states: parameters.Estados || "",
      municipalitiesRaw: parameters.Municipios || "",
      colorRisk: normalizeColor(parameters.ColorRisk),
      raw: pickRelevantParameters(parameters)
    }
  };
}

function normalizeStation(feature) {
  const properties = feature && feature.properties;
  const coordinates = feature && feature.geometry && feature.geometry.coordinates;
  if (!properties || !Array.isArray(coordinates) || coordinates.length < 2) {
    return null;
  }

  return {
    id: properties.id || feature.id,
    wigosId: properties.wigos_station_identifier,
    traditionalId: properties.traditional_station_identifier || null,
    name: properties.name || "Estação INMET",
    status: properties.status || null,
    facilityType: properties.facility_type || null,
    url: properties.url || null,
    position: {
      lng: Number(coordinates[0]),
      lat: Number(coordinates[1]),
      elevation: Number(coordinates[2] || 0)
    }
  };
}

function normalizeObservation(features, wigosId) {
  if (!features.length) {
    return {
      stationId: wigosId,
      observedAt: null,
      metrics: {},
      values: []
    };
  }

  const latestReportId = features[0].properties.reportId;
  const latestFeatures = features.filter((feature) => feature.properties.reportId === latestReportId);
  const valuesByName = new Map(
    latestFeatures.map((feature) => [feature.properties.name, feature.properties])
  );

  return {
    stationId: wigosId,
    reportId: latestReportId,
    observedAt: latestFeatures[0].properties.reportTime,
    metrics: {
      airTemperature: extractMetric(valuesByName, "air_temperature"),
      dewPoint: extractMetric(valuesByName, "dewpoint_temperature"),
      relativeHumidity: extractMetric(valuesByName, "relative_humidity"),
      windSpeed: extractMetric(valuesByName, "wind_speed"),
      windDirection: extractMetric(valuesByName, "wind_direction"),
      windGust: extractMetric(valuesByName, "maximum_wind_gust_speed"),
      precipitationLastHour: extractMetric(valuesByName, "total_precipitation_or_total_water_equivalent"),
      pressure: extractMetric(valuesByName, "pressure_reduced_to_mean_sea_level") || extractMetric(valuesByName, "non_coordinate_pressure")
    },
    values: latestFeatures.map((feature) => ({
      name: feature.properties.name,
      value: feature.properties.value,
      units: feature.properties.units,
      description: feature.properties.description || null
    }))
  };
}

function buildSummary(alerts) {
  const summary = {
    total: 0,
    byLevel: {
      verm: 0,
      lar: 0,
      ama: 0
    },
    byPhase: {
      ongoing: 0,
      upcoming: 0,
      expired: 0,
      cancelled: 0
    },
    states: [],
    latestPublication: null
  };

  const states = new Set();

  for (const alert of alerts) {
    summary.total += 1;
    if (summary.byLevel[alert.level] !== undefined) {
      summary.byLevel[alert.level] += 1;
    }

    if (summary.byPhase[alert.phase] !== undefined) {
      summary.byPhase[alert.phase] += 1;
    }

    alert.area.states.forEach((state) => states.add(state));

    if (!summary.latestPublication || new Date(alert.publishedAt) > new Date(summary.latestPublication)) {
      summary.latestPublication = alert.publishedAt;
    }
  }

  summary.states = Array.from(states).sort();
  return summary;
}

function serializeAlert(alert) {
  const area = {
    description: alert.area.description,
    states: alert.area.states,
    stateNames: alert.area.stateNames,
    municipalityCount: alert.area.municipalityCount,
    municipalitiesPreview: alert.area.municipalities.slice(0, 12),
    geometry: alert.area.geometry,
    bbox: alert.area.bbox,
    centroid: alert.area.centroid
  };

  return {
    ...alert,
    area,
    parameters: {
      states: alert.parameters.states,
      colorRisk: alert.parameters.colorRisk,
      raw: alert.parameters.raw
    }
  };
}

function dedupeAlerts(alerts) {
  const byKey = new Map();

  for (const alert of alerts.sort(compareAlerts)) {
    const key = alert.noticeId || alert.webUrl || alert.capIdentifier;
    if (!byKey.has(key)) {
      byKey.set(key, alert);
    }
  }

  return Array.from(byKey.values());
}

function isVisibleAlert(alert) {
  if (alert.status !== "Actual") {
    return false;
  }

  if (alert.isCancellation) {
    return false;
  }

  return alert.phase === "ongoing" || alert.phase === "upcoming";
}

function buildSearchText(alert) {
  return normalizeSearch([
    alert.headline,
    alert.event,
    alert.description,
    alert.area.description,
    alert.area.stateNames.join(" "),
    alert.area.states.join(" "),
    alert.area.municipalities.map((item) => item.name + " " + item.state).join(" ")
  ].join(" "));
}

function compareAlerts(left, right) {
  return new Date(right.publishedAt || 0) - new Date(left.publishedAt || 0);
}

function derivePhase({ status, msgType, onset, expires }) {
  if (msgType === "Cancel") {
    return "cancelled";
  }

  if (status !== "Actual") {
    return "expired";
  }

  const now = Date.now();
  const onsetTime = onset ? Date.parse(onset) : null;
  const expiresTime = expires ? Date.parse(expires) : null;

  if (expiresTime && expiresTime <= now) {
    return "expired";
  }

  if (onsetTime && onsetTime > now) {
    return "upcoming";
  }

  return "ongoing";
}

function pickPortugueseInfo(value) {
  const infos = arrayify(value);
  if (!infos.length) {
    return null;
  }

  return infos.find((item) => item.language === "pt-BR") || infos[0];
}

function parameterMap(value) {
  const parameters = {};

  for (const item of arrayify(value)) {
    if (!item || !item.valueName) {
      continue;
    }

    parameters[item.valueName] = typeof item.value === "string" ? item.value.trim() : item.value;
  }

  return parameters;
}

function pickRelevantParameters(parameters) {
  return {
    ColorRisk: parameters.ColorRisk || null,
    Estados: parameters.Estados || null,
    TimeStampDateOnSet: parameters.TimeStampDateOnSet || null,
    TimeStampDateExpires: parameters.TimeStampDateExpires || null
  };
}

function splitCommaList(value) {
  if (!value || typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseMunicipalities(value) {
  if (!value || typeof value !== "string") {
    return [];
  }

  const municipalities = [];
  const regex = /([^,]+?) - ([A-Z]{2}) \((\d{7})\)/g;
  let match;

  while ((match = regex.exec(value)) !== null) {
    municipalities.push({
      name: match[1].trim(),
      state: match[2],
      ibgeCode: match[3]
    });
  }

  return municipalities;
}

function deriveLevel(colorRisk, severity) {
  const normalizedColor = normalizeColor(colorRisk);

  if (normalizedColor === "#FE0000") {
    return "verm";
  }

  if (normalizedColor === "#FFA500") {
    return "lar";
  }

  if (normalizedColor === "#FFFE00") {
    return "ama";
  }

  const normalizedSeverity = String(severity || "").toLowerCase();
  if (normalizedSeverity === "extreme") {
    return "verm";
  }

  if (normalizedSeverity === "severe") {
    return "lar";
  }

  return "ama";
}

function normalizeColor(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  return value.trim().toUpperCase();
}

function normalizeDetailUrl(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  if (value.startsWith("http://")) {
    return "https://" + value.slice("http://".length);
  }

  return value;
}

function extractNoticeId(value) {
  if (!value) {
    return null;
  }

  const match = String(value).match(/(\d{4,})/);
  return match ? match[1] : null;
}

function getCanonicalXmlUrl(notification) {
  const links = notification && Array.isArray(notification.links) ? notification.links : [];
  const canonical = links.find((link) => link.type === "application/xml");
  return canonical ? canonical.href : null;
}

function extractMetric(valuesByName, name) {
  const metric = valuesByName.get(name);
  if (!metric) {
    return null;
  }

  return {
    value: metric.value,
    units: metric.units,
    description: metric.description || null
  };
}

function arrayify(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null) {
    return [];
  }

  return [value];
}

function normalizeToken(value) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : "";
}

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatCacheEntry(entry) {
  if (!entry) {
    return {
      available: false
    };
  }

  return {
    available: true,
    fetchedAt: new Date(entry.fetchedAt).toISOString(),
    lastRefreshFailed: entry.hasError
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function next() {
    const index = cursor;
    cursor += 1;

    if (index >= items.length) {
      return;
    }

    results[index] = await worker(items[index], index);
    await next();
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
  await Promise.all(workers);

  return results;
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "AlertaBR/1.0 (+Render)"
    }
  });

  if (!response.ok) {
    throw createUpstreamError(url, response.status);
  }

  return response.json();
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url, {
    headers: {
      "accept": "application/xml,text/xml;q=0.9,*/*;q=0.8",
      "user-agent": "AlertaBR/1.0 (+Render)"
    }
  });

  if (!response.ok) {
    throw createUpstreamError(url, response.status);
  }

  return response.text();
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function createUpstreamError(url, status) {
  const error = new Error("Falha ao consultar a fonte oficial do INMET.");
  error.statusCode = 502;
  error.detail = {
    url,
    status
  };
  return error;
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function roundNumber(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

module.exports = {
  DEFAULT_ALERT_LIMIT,
  getAlerts,
  getDashboardData,
  getNearestObservation,
  getServiceStatus
};
