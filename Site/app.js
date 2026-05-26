// Vercel Web Analytics queue initialization
window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };

const DEFAULT_VIEW = {
  center: [-15, -52],
  zoom: 4
};

const LEVEL_META = {
  verm: { label: "Perigo", color: "#7f1116", stroke: "#5e0d11" },
  lar: { label: "Laranja", color: "#f08c00", stroke: "#c66a00" },
  ama: { label: "Amarelo", color: "#f2c94c", stroke: "#d4a017" }
};

const PHASE_LABELS = {
  ongoing: "Em vigor",
  upcoming: "A caminho",
  expired: "Expirado",
  cancelled: "Cancelado"
};

const DEFAULT_NOTIFICATION_LEVEL = "ama";
const NOTIFICATION_DEVICE_KEY = "alertabr.device-id";

const state = {
  report: null,
  selectedAlertId: null,
  map: null,
  polygonLayer: null,
  markerLayer: null,
  stationLayer: null,
  loading: false,
  mapFlashCard: null,
  currentView: "home",
  menuOpen: false,
  menuBackdropTimer: null,
  notificationBusy: false,
  notificationEnabled: false,
  notificationRegistrationReady: false,
  pendingAlertId: null
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  state.pendingAlertId = readAlertIdFromUrl();
  cacheElements();
  bindEvents();
  initMap();
  syncViewFromHash();
  void initRegionalNotifications();
  loadReport();
});

function cacheElements() {
  elements.siteTitle = document.getElementById("site-title");
  elements.siteTitleText = document.getElementById("site-title-text");
  elements.menuButton = document.getElementById("menu-button");
  elements.menuBackdrop = document.getElementById("menu-backdrop");
  elements.siteMenu = document.getElementById("site-menu");
  elements.menuClose = document.getElementById("menu-close");
  elements.viewLinks = Array.from(document.querySelectorAll("[data-view-target]"));
  elements.views = Array.from(document.querySelectorAll(".app-view"));
  elements.refreshButton = document.getElementById("refresh-button");
  elements.statusDot = document.getElementById("status-dot");
  elements.statusLabel = document.getElementById("status-label");
  elements.statusMeta = document.getElementById("status-meta");
  elements.generatedAt = document.getElementById("generated-at");
  elements.summaryActiveAlerts = document.getElementById("metric-active-alerts");
  elements.summaryStates = document.getElementById("metric-states");
  elements.summarySeverity = document.getElementById("metric-severity");
  elements.summaryStations = document.getElementById("metric-stations");
  elements.highlightsGrid = document.getElementById("highlights-grid");
  elements.sourcesGrid = document.getElementById("sources-grid");
  elements.mapMeta = document.getElementById("map-meta");
  elements.alertDetail = document.getElementById("alert-detail");
  elements.alertCount = document.getElementById("alert-count");
  elements.alertList = document.getElementById("alert-list");
  elements.stationsGrid = document.getElementById("stations-grid");
  elements.newsList = document.getElementById("news-list");
  elements.mapInsightCard = document.getElementById("map-insight-card");
  elements.mapLegend = document.getElementById("map-legend");
  elements.notificationStatusLabel = document.getElementById("notification-status-label");
  elements.notificationStatusMeta = document.getElementById("notification-status-meta");
  elements.notificationLevel = document.getElementById("notification-level");
  elements.notificationEnableButton = document.getElementById("notification-enable-button");
  elements.notificationDisableButton = document.getElementById("notification-disable-button");
}

function bindEvents() {
  if (elements.menuButton) {
    elements.menuButton.addEventListener("click", () => {
      setMenuOpen(!state.menuOpen);
    });
  }

  if (elements.menuClose) {
    elements.menuClose.addEventListener("click", () => {
      setMenuOpen(false);
    });
  }

  if (elements.menuBackdrop) {
    elements.menuBackdrop.addEventListener("click", () => {
      setMenuOpen(false);
    });
  }

  elements.viewLinks.forEach((link) => {
    link.addEventListener("click", () => {
      setView(link.getAttribute("data-view-target"));
    });
  });

  window.addEventListener("hashchange", () => {
    setView(viewFromHash(), { updateHash: false });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.menuOpen) {
      setMenuOpen(false);
    }
  });

  if (elements.refreshButton) {
    elements.refreshButton.addEventListener("click", () => {
      loadReport();
    });
  }

  if (elements.notificationEnableButton) {
    elements.notificationEnableButton.addEventListener("click", () => {
      void handleEnableRegionalAlerts();
    });
  }

  if (elements.notificationDisableButton) {
    elements.notificationDisableButton.addEventListener("click", () => {
      void handleDisableRegionalAlerts();
    });
  }

  elements.alertList.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-alert-id]");
    if (!trigger) {
      return;
    }

    selectAlert(trigger.getAttribute("data-alert-id"), false);
  });
}

function syncViewFromHash() {
  setView(viewFromHash(), { updateHash: false });
}

function viewFromHash() {
  return window.location.hash === "#about" ? "about" : "home";
}

function setMenuOpen(isOpen) {
  if (!elements.siteMenu || !elements.menuButton || !elements.menuBackdrop) {
    return;
  }

  if (state.menuBackdropTimer) {
    window.clearTimeout(state.menuBackdropTimer);
    state.menuBackdropTimer = null;
  }

  state.menuOpen = Boolean(isOpen);
  elements.menuButton.setAttribute("aria-expanded", String(state.menuOpen));
  elements.siteMenu.classList.toggle("is-open", state.menuOpen);
  elements.siteMenu.setAttribute("aria-hidden", String(!state.menuOpen));
  document.body.classList.toggle("menu-open", state.menuOpen);

  if (state.menuOpen) {
    elements.menuBackdrop.hidden = false;
    window.requestAnimationFrame(() => {
      elements.menuBackdrop.classList.add("is-visible");
    });
    return;
  }

  elements.menuBackdrop.classList.remove("is-visible");
  state.menuBackdropTimer = window.setTimeout(() => {
    if (!state.menuOpen && elements.menuBackdrop) {
      elements.menuBackdrop.hidden = true;
    }
  }, 180);
}

function setView(view, options = {}) {
  const nextView = view === "about" ? "about" : "home";
  const shouldUpdateHash = options.updateHash !== false;

  state.currentView = nextView;

  elements.views.forEach((panel) => {
    const isActive = panel.getAttribute("data-view") === nextView;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });

  elements.viewLinks.forEach((link) => {
    const isActive = link.getAttribute("data-view-target") === nextView;
    link.classList.toggle("is-active", isActive);
  });

  if (shouldUpdateHash) {
    const nextHash = nextView === "about" ? "#about" : "#home";
    window.history.replaceState(null, "", nextHash);
  }

  setMenuOpen(false);

  if (nextView !== "home") {
    closeMapFlashCard();
    return;
  }

  if (state.map) {
    window.setTimeout(() => {
      state.map.invalidateSize();
    }, 50);
  }
}

function initMap() {
  state.map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: true
  }).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
    maxZoom: 18
  }).addTo(state.map);

  state.polygonLayer = L.layerGroup().addTo(state.map);
  state.markerLayer = L.layerGroup().addTo(state.map);
  state.stationLayer = L.layerGroup().addTo(state.map);
}

async function loadReport() {
  if (state.loading) {
    return;
  }

  state.loading = true;
  setStatus("loading", "Consultando base de dados", "Buscando o último relatório publicado.");

  try {
    const report = await fetchLatestReport();
    state.report = report;
    state.selectedAlertId = keepValidSelection(report.alerts, state.selectedAlertId);

    if (state.pendingAlertId && Array.isArray(report.alerts) && report.alerts.some((alert) => alert.id === state.pendingAlertId)) {
      state.selectedAlertId = state.pendingAlertId;
      state.pendingAlertId = null;
    }

    if (!state.selectedAlertId && Array.isArray(report.alerts) && report.alerts.length) {
      state.selectedAlertId = report.alerts[0].id;
    }

    renderReport();
    setStatus(
      "ready",
      "Relatório carregado",
      "Utilizando o pacote salvo em " + formatDateTime(report.generatedAt) + "."
    );
  } catch (error) {
    console.error(error);
    renderError(error);
    setStatus("error", "Falha ao carregar", buildErrorMessage(error));
  } finally {
    state.loading = false;
  }
}

async function fetchLatestReport() {
  const runtimeConfig = getRuntimeConfig();
  if (!runtimeConfig.supabaseUrl || !runtimeConfig.supabaseAnonKey) {
    const error = new Error("CONFIG_MISSING");
    error.code = "CONFIG_MISSING";
    throw error;
  }

  const url = new URL(runtimeConfig.supabaseUrl.replace(/\/+$/, "") + "/rest/v1/climate_reports");
  url.searchParams.set("select", "generated_at,report");
  url.searchParams.set("report_key", "eq." + runtimeConfig.reportKey);
  url.searchParams.set("is_public", "is.true");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: {
      apikey: runtimeConfig.supabaseAnonKey,
      authorization: "Bearer " + runtimeConfig.supabaseAnonKey,
      accept: "application/json"
    }
  });

  if (!response.ok) {
    const detail = await response.text();
    const error = new Error("SUPABASE_HTTP_" + response.status + ": " + detail);
    error.code = "SUPABASE_HTTP";
    throw error;
  }

  const rows = await response.json();
  if (!Array.isArray(rows) || !rows.length || !rows[0].report) {
    const error = new Error("REPORT_NOT_FOUND");
    error.code = "REPORT_NOT_FOUND";
    throw error;
  }

  return rows[0].report;
}

function renderReport() {
  const report = state.report;

  if (elements.siteTitleText) {
    elements.siteTitleText.textContent = "AlertaBR";
  } else if (elements.siteTitle) {
    elements.siteTitle.textContent = "AlertaBR";
  }
  elements.generatedAt.textContent = "Gerado em " + formatDateTime(report.generatedAt);
  elements.summaryActiveAlerts.textContent = safeValue(report.summary && report.summary.activeAlerts);
  elements.summaryStates.textContent = safeValue(report.summary && report.summary.statesAffected);
  elements.summarySeverity.textContent = safeValue(report.summary && report.summary.highestSeverity);
  elements.summaryStations.textContent = safeValue(report.summary && report.summary.stationsSampled);
  if (elements.mapMeta) {
    elements.mapMeta.textContent = buildMapMeta(report);
  }
  elements.alertCount.textContent = (Array.isArray(report.alerts) ? report.alerts.length : 0) + " item(ns)";

  renderHighlights(report.highlights);
  renderSources(report.sources);
  renderAlerts(report.alerts);
  renderStations(report.sampleStations);
  renderNews(report.news);
  renderMapOverlays(report);
  renderSelectedAlert();
  renderMap();
}

function renderHighlights(items) {
  if (!Array.isArray(items) || !items.length) {
    elements.highlightsGrid.innerHTML = "<div class=\"empty-state\">Nenhum destaque calculado no relatório atual.</div>";
    return;
  }

  elements.highlightsGrid.innerHTML = items.map((item) => (
    "<article class=\"highlight-card\" data-tone=\"" + escapeHtml(item.tone || "ama") + "\">" +
      "<p class=\"highlight-label\">" + escapeHtml(item.label || "Destaque") + "</p>" +
      "<strong class=\"highlight-value\">" + escapeHtml(item.value || "n/d") + "</strong>" +
      "<p class=\"highlight-note\">" + escapeHtml(item.detail || "") + "</p>" +
    "</article>"
  )).join("");
}

function renderSources(items) {
  if (!Array.isArray(items) || !items.length) {
    elements.sourcesGrid.innerHTML = "<div class=\"empty-state\">Sem status de fontes neste relatório.</div>";
    return;
  }

  elements.sourcesGrid.innerHTML = items.map((item) => (
    "<article class=\"source-card\">" +
      "<span class=\"source-pill " + escapeHtml(item.status || "empty") + "\">" + escapeHtml(labelForStatus(item.status)) + "</span>" +
      "<strong class=\"metric-value\" style=\"font-size:1.15rem;margin-top:14px\">" + escapeHtml(item.label || "Fonte") + "</strong>" +
      "<p class=\"source-detail\">" + escapeHtml(item.detail || "") + "</p>" +
      "<p class=\"source-meta\">" + escapeHtml(item.updatedAt ? formatDateTime(item.updatedAt) : "Sem horário informado") + "</p>" +
    "</article>"
  )).join("");
}

function renderAlerts(items) {
  if (!Array.isArray(items) || !items.length) {
    elements.alertList.innerHTML = "<div class=\"empty-state\">Não há alertas no relatório salvo.</div>";
    return;
  }

  elements.alertList.innerHTML = items.map((alert) => (
    "<button class=\"alert-item" + (alert.id === state.selectedAlertId ? " is-active" : "") + "\" type=\"button\" data-alert-id=\"" + escapeHtml(alert.id) + "\">" +
      "<div class=\"alert-topline\">" +
        "<p class=\"alert-title\">" + escapeHtml(alert.headline || "Alerta") + "</p>" +
        "<span class=\"badge " + escapeHtml(alert.level || "ama") + "\">" + escapeHtml(levelLabel(alert.level)) + "</span>" +
      "</div>" +
      "<div class=\"alert-meta\">" +
        "<span class=\"badge phase\">" + escapeHtml(phaseLabel(alert.phase)) + "</span>" +
        "<span>" + escapeHtml(alert.event || "Evento") + "</span>" +
        "<span>" + escapeHtml(formatStates(alert.area && alert.area.states)) + "</span>" +
      "</div>" +
      "<p class=\"alert-meta\">" +
        "<span>" + escapeHtml(formatDateTime(alert.onset)) + "</span>" +
        "<span>até " + escapeHtml(formatDateTime(alert.expires)) + "</span>" +
      "</p>" +
    "</button>"
  )).join("");
}

function renderStations(items) {
  if (!Array.isArray(items) || !items.length) {
    elements.stationsGrid.innerHTML = "<div class=\"empty-state\">Sem leituras de estação neste ciclo.</div>";
    return;
  }

  elements.stationsGrid.innerHTML = items.map((item) => (
    "<article class=\"station-card\">" +
      "<h3>" + escapeHtml(item.label) + "</h3>" +
      "<p class=\"station-meta\">" + escapeHtml(item.region) + " · " + escapeHtml(item.station && item.station.name ? item.station.name : "Estação INMET") + "</p>" +
      "<div class=\"station-stack\">" +
        stationRow("Temperatura", formatMetric(item.metrics && item.metrics.airTemperature)) +
        stationRow("Umidade", formatMetric(item.metrics && item.metrics.relativeHumidity)) +
        stationRow("Chuva 1h", formatMetric(item.metrics && item.metrics.precipitationLastHour)) +
        stationRow("Vento", formatMetric(item.metrics && item.metrics.windSpeed)) +
        stationRow(
          "Distância",
          item.distanceKm !== undefined && item.distanceKm !== null ? formatNumber(item.distanceKm) + " km" : "n/d"
        ) +
      "</div>" +
      "<p class=\"station-meta\">Observado em " + escapeHtml(formatDateTime(item.observedAt)) + "</p>" +
    "</article>"
  )).join("");
}

function renderNews(items) {
  if (!Array.isArray(items) || !items.length) {
    elements.newsList.innerHTML = "<div class=\"empty-state\">Nenhuma notícia agregada no ciclo atual.</div>";
    return;
  }

  elements.newsList.innerHTML = items.map((item) => {
    const safeUrl = safeExternalUrl(item.url);

    return (
    "<a class=\"news-card\" href=\"" + escapeHtml(safeUrl || "#") + "\" target=\"_blank\" rel=\"noopener noreferrer\" referrerpolicy=\"no-referrer\">" +
      "<h3 class=\"news-title\">" + escapeHtml(item.title || "Sem título") + "</h3>" +
      "<p class=\"news-summary\">" + escapeHtml(item.summary || "Sem resumo adicional.") + "</p>" +
      "<p class=\"news-meta\">" + escapeHtml(item.source || "Fonte") + " · " + escapeHtml(formatDateTime(item.publishedAt)) + "</p>" +
    "</a>"
  );
  }).filter(Boolean).join("");
}

function renderMapOverlays(report) {
  if (elements.mapInsightCard) {
    elements.mapInsightCard.innerHTML = buildMapInsightCard(report);
  }

  if (elements.mapLegend) {
    elements.mapLegend.innerHTML = buildMapLegend(report);
  }
}

function renderSelectedAlert() {
  const alert = getSelectedAlert();
  if (!alert) {
    elements.alertDetail.innerHTML = "<p class=\"detail-empty\">Selecione um alerta para ver detalhes.</p>";
    return;
  }

  const municipalities = Array.isArray(alert.area && alert.area.municipalitiesPreview)
    ? alert.area.municipalitiesPreview.slice(0, 8).map((item) => item.name + " - " + item.state).join(", ")
    : "";
  const safeUrl = safeExternalUrl(alert.webUrl);
  const nearbyStation = formatNearbyStation(alert.nearbyStation);
  const nearbyStationMetrics = formatNearbyStationMetrics(alert.nearbyStation);

  elements.alertDetail.innerHTML =
    "<div class=\"detail-badge-row\">" +
      "<span class=\"detail-badge " + escapeHtml(alert.level || "ama") + "\">" + escapeHtml(levelLabel(alert.level)) + "</span>" +
      "<span class=\"detail-badge ama\">" + escapeHtml(phaseLabel(alert.phase)) + "</span>" +
    "</div>" +
    "<h3 class=\"detail-title\">" + escapeHtml(alert.headline || "Alerta") + "</h3>" +
    "<p class=\"detail-copy\">" + escapeHtml(alert.description || "Sem descrição adicional.") + "</p>" +
    "<ul class=\"detail-list\">" +
      detailLine("Evento", alert.event || "n/d") +
      detailLine("Estados", formatStates(alert.area && alert.area.states)) +
      detailLine("Cobertura", formatAlertCoverage(alert)) +
      detailLine("Municípios", municipalities || "Sem amostra") +
      detailLine("Janela", formatAlertTiming(alert.timing, alert.phase)) +
      detailLine("Urgência CAP", formatOperationalValue(alert.urgency)) +
      detailLine("Certeza", formatOperationalValue(alert.certainty)) +
      (nearbyStation ? detailLine("Estação próxima", nearbyStation) : "") +
      (nearbyStationMetrics ? detailLine("Leitura próxima", nearbyStationMetrics) : "") +
      detailLinkLine("Link oficial", safeUrl) +
    "</ul>" +
    (alert.instruction
      ? "<p class=\"detail-note\"><strong>Orientação:</strong> " + escapeHtml(alert.instruction) + "</p>"
      : "");
}

function renderMap() {
  state.polygonLayer.clearLayers();
  state.markerLayer.clearLayers();
  state.stationLayer.clearLayers();

  const alerts = Array.isArray(state.report && state.report.alerts) ? state.report.alerts : [];
  const alertBounds = [];
  const stationBounds = [];

  alerts.forEach((alert) => {
    const mapTone = levelMapTone(alert.level);

    if (alert.area && alert.area.geometry) {
      const polygon = L.geoJSON(alert.area.geometry, {
        style: {
          color: mapTone.stroke,
          fillColor: mapTone.fill,
          weight: state.selectedAlertId === alert.id ? 3.2 : 2,
          opacity: state.selectedAlertId === alert.id ? 0.96 : 0.78,
          fillOpacity: state.selectedAlertId === alert.id ? 0.32 : 0.18
        }
      });

      polygon.bindTooltip(buildAlertTooltip(alert), {
        sticky: true,
        direction: "top",
        opacity: 0.94,
        className: "map-inline-tooltip"
      });
      polygon.on("click", (event) => {
        selectAlert(alert.id, false, {
          source: "map",
          openMapFlashCard: true,
          latlng: event && event.latlng ? event.latlng : null
        });
      });
      polygon.addTo(state.polygonLayer);

      if (polygon.getBounds && polygon.getBounds().isValid()) {
        alertBounds.push(polygon.getBounds());
      }
    }

    if (alert.area && alert.area.centroid) {
      const marker = L.circleMarker([alert.area.centroid.lat, alert.area.centroid.lng], {
        radius: state.selectedAlertId === alert.id ? 7.5 : 5.5,
        color: "#fff",
        weight: state.selectedAlertId === alert.id ? 2.2 : 1.6,
        fillColor: mapTone.fill,
        fillOpacity: 1
      });

      marker.bindTooltip(buildAlertTooltip(alert), {
        direction: "top",
        opacity: 0.94,
        className: "map-inline-tooltip"
      });
      marker.on("click", (event) => {
        selectAlert(alert.id, false, {
          source: "map",
          openMapFlashCard: true,
          latlng: event && event.latlng ? event.latlng : null
        });
      });
      marker.addTo(state.markerLayer);
    }
  });

  const stations = Array.isArray(state.report && state.report.sampleStations) ? state.report.sampleStations : [];
  stations.forEach((item) => {
    const position = stationLatLng(item);
    if (!position) {
      return;
    }

    const marker = L.circleMarker(position, {
      radius: 6.5,
      color: "#ffffff",
      weight: 2,
      fillColor: "#1f4e79",
      fillOpacity: 0.96
    });

    marker.bindTooltip(buildStationTooltip(item), {
      direction: "top",
      opacity: 0.94,
      className: "map-inline-tooltip"
    });
    marker.bindPopup(buildStationPopup(item), {
      className: "map-station-popup",
      maxWidth: 320
    });
    marker.addTo(state.stationLayer);
    stationBounds.push(L.latLng(position[0], position[1]));
  });

  if (alertBounds.length) {
    const aggregate = alertBounds[0];
    for (let index = 1; index < alertBounds.length; index += 1) {
      aggregate.extend(alertBounds[index]);
    }

    state.map.fitBounds(aggregate, {
      padding: [24, 24],
      maxZoom: 6
    });
    return;
  }

  if (stationBounds.length) {
    state.map.fitBounds(L.latLngBounds(stationBounds), {
      padding: [28, 28],
      maxZoom: 5
    });
    return;
  }

  const view = state.report && state.report.mapDefaults ? state.report.mapDefaults : DEFAULT_VIEW;
  state.map.setView(view.center || DEFAULT_VIEW.center, view.zoom || DEFAULT_VIEW.zoom);
}

function selectAlert(alertId, keepMapView, options = {}) {
  state.selectedAlertId = alertId;
  renderAlerts(state.report && state.report.alerts);
  renderSelectedAlert();
  renderMap();

  if (!options.openMapFlashCard) {
    closeMapFlashCard();
  }

  if (options && options.source === "map") {
    scrollSelectedAlertIntoView();
  }

  if (keepMapView) {
    if (options && options.openMapFlashCard) {
      openMapFlashCard(getSelectedAlert(), options.latlng);
    }
    return;
  }

  const alert = getSelectedAlert();
  if (!alert || !alert.area) {
    closeMapFlashCard();
    return;
  }

  const popupLatLng = (options && options.latlng) || alertLatLng(alert);
  if (options && options.openMapFlashCard && popupLatLng) {
    state.map.once("moveend", () => {
      openMapFlashCard(alert, popupLatLng);
    });
  }

  if (Array.isArray(alert.area.bbox) && alert.area.bbox.length === 4) {
    state.map.fitBounds([
      [alert.area.bbox[1], alert.area.bbox[0]],
      [alert.area.bbox[3], alert.area.bbox[2]]
    ], {
      padding: [28, 28],
      maxZoom: 7
    });
    return;
  }

  if (alert.area.centroid) {
    state.map.flyTo([alert.area.centroid.lat, alert.area.centroid.lng], 7, {
      duration: 0.8
    });
    return;
  }

  if (options && options.openMapFlashCard) {
    openMapFlashCard(alert, popupLatLng);
  }
}

function getSelectedAlert() {
  const alerts = Array.isArray(state.report && state.report.alerts) ? state.report.alerts : [];
  return alerts.find((alert) => alert.id === state.selectedAlertId) || null;
}

function keepValidSelection(alerts, selectedAlertId) {
  if (!Array.isArray(alerts) || !alerts.length) {
    return null;
  }

  return alerts.some((alert) => alert.id === selectedAlertId) ? selectedAlertId : null;
}

function renderError(error) {
  elements.generatedAt.textContent = "Sem dados carregados.";
  elements.summaryActiveAlerts.textContent = "-";
  elements.summaryStates.textContent = "-";
  elements.summarySeverity.textContent = "-";
  elements.summaryStations.textContent = "-";
  if (elements.mapMeta) {
    elements.mapMeta.textContent = "Sem geometrias carregadas.";
  }
  elements.alertCount.textContent = "0 item(ns)";
  elements.highlightsGrid.innerHTML = "<div class=\"empty-state\">" + escapeHtml(buildErrorMessage(error)) + "</div>";
  elements.sourcesGrid.innerHTML = "<div class=\"empty-state\">Configure `SITE_SUPABASE_URL` e `SITE_SUPABASE_ANON_KEY` para ativar o painel.</div>";
  elements.alertList.innerHTML = "<div class=\"empty-state\">Nenhum alerta disponível no momento.</div>";
  elements.stationsGrid.innerHTML = "<div class=\"empty-state\">Sem leituras disponíveis.</div>";
  elements.newsList.innerHTML = "<div class=\"empty-state\">Sem notícias disponíveis.</div>";
  elements.alertDetail.innerHTML = "<p class=\"detail-empty\">O detalhe do alerta aparecerá aqui quando o relatório for carregado.</p>";
  state.polygonLayer.clearLayers();
  state.markerLayer.clearLayers();
  state.stationLayer.clearLayers();
  if (elements.mapInsightCard) {
    elements.mapInsightCard.innerHTML = "<p class=\"map-overlay-copy\">Sem leitura operacional para exibir no mapa.</p>";
  }
  if (elements.mapLegend) {
    elements.mapLegend.innerHTML = "<p class=\"map-overlay-copy\">A legenda volta a aparecer quando houver relatório salvo.</p>";
  }
  closeMapFlashCard();
}

function setStatus(mode, label, meta) {
  elements.statusDot.className = "status-dot " + mode;
  elements.statusLabel.textContent = label;
  elements.statusMeta.textContent = meta;
}

function getRuntimeConfig() {
  return window.HAPPY_NATION_CONFIG || {};
}

async function initRegionalNotifications() {
  syncNotificationLevel();

  if (!elements.notificationStatusLabel || !elements.notificationStatusMeta) {
    return;
  }

  if (!isRegionalNotificationSupported()) {
    renderRegionalNotificationState("unsupported", "Indisponível", buildNotificationSupportMessage());
    return;
  }

  try {
    const registration = await getNotificationRegistration();
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    state.notificationRegistrationReady = Boolean(registration);
    state.notificationEnabled = Boolean(subscription);

    renderRegionalNotificationState(
      state.notificationEnabled ? "enabled" : "idle",
      state.notificationEnabled ? "Ativado neste navegador" : "Desativado",
      state.notificationEnabled
        ? "Os avisos seguem ativos para esta instalação do navegador."
        : "Ative para receber avisos do INMET quando um alerta atingir sua localização atual."
    );
  } catch (error) {
    console.error(error);
    renderRegionalNotificationState("error", "Falha ao preparar", "Não foi possível inicializar as notificações deste navegador.");
  }
}

async function handleEnableRegionalAlerts() {
  if (state.notificationBusy) {
    return;
  }

  state.notificationBusy = true;
  renderRegionalNotificationState("loading", "Ativando", "Solicitando permissão de notificação e localização.");

  try {
    ensureNotificationConfig();

    if (Notification.permission === "denied") {
      const error = new Error("NOTIFICATION_DENIED");
      error.code = "NOTIFICATION_DENIED";
      throw error;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      const error = new Error("NOTIFICATION_DENIED");
      error.code = "NOTIFICATION_DENIED";
      throw error;
    }

    const position = await getCurrentBrowserPosition();
    const registration = await getOrCreateNotificationRegistration();
    const existingSubscription = await registration.pushManager.getSubscription();
    const subscription = existingSubscription || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(getRuntimeConfig().pushPublicKey)
    });

    await postNotificationRequest("/api/notifications/subscribe", {
      deviceId: getOrCreateAnonymousDeviceId(),
      subscription: subscription.toJSON(),
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      minLevel: getSelectedNotificationLevel()
    });

    state.notificationEnabled = true;
    state.notificationRegistrationReady = true;
    renderRegionalNotificationState("enabled", "Alertas ativos", "Seu navegador já está inscrito para avisos anônimos desta região.");
  } catch (error) {
    console.error(error);
    renderRegionalNotificationState("error", "Não foi possível ativar", describeNotificationError(error));
  } finally {
    state.notificationBusy = false;
    syncNotificationControls();
  }
}

async function handleDisableRegionalAlerts() {
  if (state.notificationBusy) {
    return;
  }

  state.notificationBusy = true;
  renderRegionalNotificationState("loading", "Desativando", "Removendo a assinatura deste navegador.");

  try {
    const registration = await getNotificationRegistration();
    const subscription = registration ? await registration.pushManager.getSubscription() : null;

    await postNotificationRequest("/api/notifications/unsubscribe", {
      deviceId: getStoredAnonymousDeviceId(),
      endpoint: subscription ? subscription.endpoint : ""
    });

    if (subscription) {
      await subscription.unsubscribe();
    }

    state.notificationEnabled = false;
    renderRegionalNotificationState("idle", "Desativado", "Os alertas foram removidos deste navegador.");
  } catch (error) {
    console.error(error);
    renderRegionalNotificationState("error", "Falha ao desativar", "Não foi possível remover a assinatura deste navegador.");
  } finally {
    state.notificationBusy = false;
    syncNotificationControls();
  }
}

function syncNotificationLevel() {
  if (!elements.notificationLevel) {
    return;
  }

  elements.notificationLevel.value = getSelectedNotificationLevel();
}

function syncNotificationControls() {
  if (!elements.notificationEnableButton || !elements.notificationDisableButton || !elements.notificationLevel) {
    return;
  }

  const supported = isRegionalNotificationSupported();
  const busy = state.notificationBusy;

  elements.notificationEnableButton.disabled = !supported || busy;
  elements.notificationDisableButton.disabled = !supported || busy || !state.notificationEnabled;
  elements.notificationLevel.disabled = !supported || busy;
  elements.notificationEnableButton.textContent = state.notificationEnabled ? "Atualizar alertas" : "Ativar alertas";
}

function renderRegionalNotificationState(mode, label, meta) {
  if (!elements.notificationStatusLabel || !elements.notificationStatusMeta) {
    return;
  }

  elements.notificationStatusLabel.textContent = label;
  elements.notificationStatusLabel.setAttribute("data-tone", mode);
  elements.notificationStatusMeta.textContent = meta;
  syncNotificationControls();
}

function isRegionalNotificationSupported() {
  return Boolean(
    window.isSecureContext &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "geolocation" in navigator
  );
}

function ensureNotificationConfig() {
  const runtimeConfig = getRuntimeConfig();

  if (!isRegionalNotificationSupported()) {
    const error = new Error("NOTIFICATION_UNSUPPORTED");
    error.code = "NOTIFICATION_UNSUPPORTED";
    throw error;
  }

  if (!runtimeConfig.pushPublicKey) {
    const error = new Error("PUSH_CONFIG_MISSING");
    error.code = "PUSH_CONFIG_MISSING";
    throw error;
  }
}

function buildNotificationSupportMessage() {
  if (!window.isSecureContext) {
    return "As notificações exigem HTTPS ou localhost para acessar service worker e localização.";
  }

  return "Este navegador não oferece suporte completo para push web com localização.";
}

function getSelectedNotificationLevel() {
  const value = elements.notificationLevel ? elements.notificationLevel.value : DEFAULT_NOTIFICATION_LEVEL;
  return value === "lar" || value === "verm" ? value : DEFAULT_NOTIFICATION_LEVEL;
}

async function getNotificationRegistration() {
  if (!("serviceWorker" in navigator)) {
    return null;
  }

  return navigator.serviceWorker.getRegistration();
}

async function getOrCreateNotificationRegistration() {
  const existing = await getNotificationRegistration();
  if (existing) {
    return existing;
  }

  return navigator.serviceWorker.register("/notification-worker.js");
}

function getCurrentBrowserPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 15000,
      maximumAge: 300000
    });
  });
}

async function postNotificationRequest(pathname, payload) {
  const runtimeConfig = getRuntimeConfig();
  const baseUrl = runtimeConfig.apiBaseUrl ? runtimeConfig.apiBaseUrl.replace(/\/+$/, "") : "";
  const response = await fetch(baseUrl + pathname, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await response.text();
    const error = new Error("NOTIFICATION_HTTP_" + response.status + ": " + detail);
    error.code = "NOTIFICATION_HTTP";
    throw error;
  }

  return response.json().catch(() => ({}));
}

function getStoredAnonymousDeviceId() {
  try {
    return window.localStorage.getItem(NOTIFICATION_DEVICE_KEY) || "";
  } catch (_error) {
    return "";
  }
}

function getOrCreateAnonymousDeviceId() {
  const current = getStoredAnonymousDeviceId();
  if (current) {
    return current;
  }

  const next = window.crypto && typeof window.crypto.randomUUID === "function"
    ? window.crypto.randomUUID()
    : "device-" + Math.random().toString(36).slice(2) + Date.now().toString(36);

  try {
    window.localStorage.setItem(NOTIFICATION_DEVICE_KEY, next);
  } catch (_error) {
    return next;
  }

  return next;
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);

  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }

  return output;
}

function readAlertIdFromUrl() {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get("alert") || "";
  } catch (_error) {
    return "";
  }
}

function describeNotificationError(error) {
  if (error && error.code === "NOTIFICATION_DENIED") {
    return "A permissão de notificação foi negada. Reative nas configurações do navegador para continuar.";
  }

  if (error && error.code === "PUSH_CONFIG_MISSING") {
    return "O deploy ainda não recebeu a chave pública de push.";
  }

  if (error && error.code === "NOTIFICATION_UNSUPPORTED") {
    return buildNotificationSupportMessage();
  }

  if (error && error.code === "NOTIFICATION_HTTP") {
    return "O backend recusou a inscrição anônima. Revise as funções serverless e as chaves do deploy.";
  }

  if (error && error.code === 1) {
    return "A localização foi bloqueada. Se o deploy saiu da pasta Site/, atualize o header Permissions-Policy e permita localização no navegador.";
  }

  if (error && error.code === 2) {
    return "O navegador não conseguiu obter sua localização agora. Tente novamente com GPS/rede ativos.";
  }

  if (error && error.code === 3) {
    return "A consulta de localização expirou antes de responder. Tente novamente em uma conexão melhor.";
  }

  return "Não foi possível concluir a assinatura anônima deste navegador.";
}

function safeValue(value) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }

  return String(value);
}

function stationRow(label, value) {
  return "<div class=\"station-row\"><span>" + escapeHtml(label) + "</span><span>" + escapeHtml(value || "n/d") + "</span></div>";
}

function detailLine(label, value) {
  return "<li><strong>" + escapeHtml(label) + ":</strong> " + escapeHtml(value || "n/d") + "</li>";
}

function detailLinkLine(label, url) {
  if (!url) {
    return detailLine(label, "Não informado");
  }

  return (
    "<li><strong>" + escapeHtml(label) + ":</strong> " +
    "<a class=\"detail-link\" href=\"" + escapeHtml(url) + "\" target=\"_blank\" rel=\"noopener noreferrer\" referrerpolicy=\"no-referrer\">" +
    "Abrir aviso oficial" +
    "</a></li>"
  );
}

function buildMapMeta(report) {
  const alerts = Array.isArray(report && report.alerts) ? report.alerts.length : 0;
  const insights = report && report.mapInsights ? report.mapInsights : {};
  const geometryAlerts = typeof insights.geometryAlerts === "number" ? insights.geometryAlerts : alerts;
  const stationMarkers = typeof insights.stationMarkers === "number" ? insights.stationMarkers : 0;
  const expiringSoon = typeof insights.expiringSoon === "number" ? insights.expiringSoon : 0;
  const fragments = [
    alerts + " alerta(s)",
    geometryAlerts + " polígono(s)",
    stationMarkers + " estação(ões) no mapa"
  ];

  if (expiringSoon > 0) {
    fragments.push(expiringSoon + " vencendo em até 6h");
  }

  return fragments.join(" · ") + ".";
}

function buildMapInsightCard(report) {
  const insights = report && report.mapInsights ? report.mapInsights : {};
  const analysis = report && report.analysis ? report.analysis : {};
  const topState = insights.topState;
  const largestArea = analysis.coverage && analysis.coverage.largestAreaAlert
    ? analysis.coverage.largestAreaAlert
    : null;

  return (
    "<p class=\"map-overlay-kicker\">Leitura operacional</p>" +
    "<strong class=\"map-overlay-title\">" + escapeHtml(String(insights.expiringSoon || 0)) + " alerta(s) vencem em 6h</strong>" +
    "<p class=\"map-overlay-copy\">" + escapeHtml(
      topState
        ? "Hotspot atual: " + topState.state + " com " + topState.alertCount + " alerta(s) e severidade até " + topState.highestSeverityLabel + "."
        : "Sem hotspot territorial calculado para o relatório atual."
    ) + "</p>" +
    "<div class=\"map-overlay-pills\">" +
      mapPill("Geometrias", insights.geometryAlerts) +
      mapPill("Estações", insights.stationMarkers) +
      mapPill("Iniciando em 6h", insights.startingSoon) +
    "</div>" +
    (largestArea
      ? "<p class=\"map-overlay-copy\">Maior área nominal: " +
          escapeHtml(largestArea.headline || "Alerta") +
          " com " +
          escapeHtml(String(largestArea.municipalityCount || 0)) +
          " município(s).</p>"
      : "")
  );
}

function buildMapLegend(report) {
  const severity = report && report.severityBreakdown ? report.severityBreakdown : {};
  const insights = report && report.mapInsights ? report.mapInsights : {};
  const dominantEvent = insights.dominantEvent;

  return (
    "<p class=\"map-legend-title\">Camadas do mapa</p>" +
    "<div class=\"map-legend-list\">" +
      legendRow("Perigo", "verm", severity.verm) +
      legendRow("Laranja", "lar", severity.lar) +
      legendRow("Amarelo", "ama", severity.ama) +
      legendRow("Estações INMET", "station", insights.stationMarkers) +
    "</div>" +
    (dominantEvent
      ? "<p class=\"map-overlay-copy\">Evento dominante: " +
          escapeHtml(dominantEvent.event) +
          " (" +
          escapeHtml(String(dominantEvent.count)) +
          ").</p>"
      : "")
  );
}

function mapPill(label, value) {
  return (
    "<span class=\"map-overlay-pill\">" +
      "<strong>" + escapeHtml(String(value === undefined || value === null ? "-" : value)) + "</strong>" +
      "<span>" + escapeHtml(label) + "</span>" +
    "</span>"
  );
}

function legendRow(label, tone, value) {
  return (
    "<div class=\"map-legend-row\">" +
      "<span class=\"map-legend-label\"><span class=\"legend-swatch " + escapeHtml(tone) + "\"></span>" + escapeHtml(label) + "</span>" +
      "<strong>" + escapeHtml(String(value === undefined || value === null ? "-" : value)) + "</strong>" +
    "</div>"
  );
}

function formatAlertCoverage(alert) {
  if (!alert || !alert.area) {
    return "n/d";
  }

  const municipalityCount = Number(alert.area.municipalityCount) || 0;
  const stateCount = Number(alert.area.stateCount) || (Array.isArray(alert.area.states) ? alert.area.states.length : 0);

  return municipalityCount + " município(s) em " + stateCount + " UF(s)";
}

function formatAlertTiming(timing, phase) {
  if (!timing) {
    return "Janela sem horário calculado";
  }

  if (phase === "upcoming" && typeof timing.startsInMinutes === "number" && timing.startsInMinutes > 0) {
    return "Começa em " + formatMinutesFromNow(timing.startsInMinutes);
  }

  if (typeof timing.expiresInMinutes === "number" && timing.expiresInMinutes > 0) {
    return "Expira em " + formatMinutesFromNow(timing.expiresInMinutes);
  }

  if (typeof timing.expiresInMinutes === "number" && timing.expiresInMinutes <= 0) {
    return "Janela já encerrada";
  }

  return "Janela sem horário calculado";
}

function formatMinutesFromNow(minutes) {
  if (minutes < 60) {
    return minutes + " min";
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!remainder) {
    return hours + "h";
  }

  return hours + "h" + remainder;
}

function formatOperationalValue(value) {
  if (!value) {
    return "n/d";
  }

  return String(value)
    .split(/[_-]/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function formatNearbyStation(nearbyStation) {
  if (!nearbyStation) {
    return "";
  }

  const parts = [
    nearbyStation.label || "",
    nearbyStation.station && nearbyStation.station.name ? nearbyStation.station.name : "",
    nearbyStation.distanceKm !== undefined && nearbyStation.distanceKm !== null
      ? formatNumber(nearbyStation.distanceKm) + " km"
      : ""
  ].filter(Boolean);

  return parts.join(" · ");
}

function formatNearbyStationMetrics(nearbyStation) {
  if (!nearbyStation || !nearbyStation.metrics) {
    return "";
  }

  const metrics = [];
  if (nearbyStation.metrics.airTemperature) {
    metrics.push("Temp " + formatMetric(nearbyStation.metrics.airTemperature));
  }
  if (nearbyStation.metrics.relativeHumidity) {
    metrics.push("Umid " + formatMetric(nearbyStation.metrics.relativeHumidity));
  }
  if (nearbyStation.metrics.precipitationLastHour) {
    metrics.push("Chuva 1h " + formatMetric(nearbyStation.metrics.precipitationLastHour));
  }
  if (nearbyStation.metrics.windSpeed) {
    metrics.push("Vento " + formatMetric(nearbyStation.metrics.windSpeed));
  }

  return metrics.join(" · ");
}

function buildAlertTooltip(alert) {
  return escapeHtml((alert.headline || "Alerta") + " · " + levelLabel(alert.level));
}

function stationLatLng(item) {
  if (!item || !item.station || !item.station.position) {
    return null;
  }

  return [item.station.position.lat, item.station.position.lng];
}

function buildStationTooltip(item) {
  const label = item && item.label ? item.label : "Estação";
  const temp = item && item.metrics && item.metrics.airTemperature ? formatMetric(item.metrics.airTemperature) : "n/d";
  return escapeHtml(label + " · " + temp);
}

function buildStationPopup(item) {
  return (
    "<article class=\"map-station-card\">" +
      "<div class=\"map-flash-card-head\">" +
        "<span class=\"detail-badge ama\">Estação</span>" +
        "<span class=\"detail-badge ama\">" + escapeHtml(item.region || "INMET") + "</span>" +
      "</div>" +
      "<h4 class=\"map-station-title\">" + escapeHtml(item.label || "Estação") + "</h4>" +
      "<p class=\"map-station-copy\">" + escapeHtml(item.station && item.station.name ? item.station.name : "Estação INMET") + "</p>" +
      "<div class=\"map-station-grid\">" +
        stationMetricCell("Temperatura", formatMetric(item.metrics && item.metrics.airTemperature)) +
        stationMetricCell("Umidade", formatMetric(item.metrics && item.metrics.relativeHumidity)) +
        stationMetricCell("Chuva 1h", formatMetric(item.metrics && item.metrics.precipitationLastHour)) +
        stationMetricCell("Vento", formatMetric(item.metrics && item.metrics.windSpeed)) +
      "</div>" +
      "<p class=\"map-station-copy\">Observado em " + escapeHtml(formatDateTime(item.observedAt)) + "</p>" +
    "</article>"
  );
}

function stationMetricCell(label, value) {
  return (
    "<div class=\"map-station-metric\">" +
      "<span>" + escapeHtml(label) + "</span>" +
      "<strong>" + escapeHtml(value || "n/d") + "</strong>" +
    "</div>"
  );
}

function scrollSelectedAlertIntoView() {
  const activeAlert = elements.alertList.querySelector(".alert-item.is-active");

  if (!activeAlert) {
    return;
  }

  activeAlert.scrollIntoView({
    block: "nearest",
    behavior: "smooth"
  });
}

function formatStates(states) {
  if (!Array.isArray(states) || !states.length) {
    return "Sem UF";
  }

  return states.join(", ");
}

function formatMetric(metric) {
  if (!metric || metric.value === undefined || metric.value === null || metric.value === "") {
    return "n/d";
  }

  return formatNumber(metric.value) + (metric.units ? " " + metric.units : "");
}

function formatNumber(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return String(value);
  }

  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(numeric);
}

function formatDateTime(value) {
  if (!value) {
    return "n/d";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "n/d";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function phaseLabel(phase) {
  return PHASE_LABELS[phase] || "Status desconhecido";
}

function levelLabel(level) {
  return LEVEL_META[level] ? LEVEL_META[level].label : "Sem nível";
}

function levelColor(level) {
  return LEVEL_META[level] ? LEVEL_META[level].color : LEVEL_META.ama.color;
}

function levelMapTone(level) {
  const meta = LEVEL_META[level] || LEVEL_META.ama;

  return {
    fill: meta.color,
    stroke: meta.stroke || meta.color
  };
}

function openMapFlashCard(alert, latlng) {
  if (!state.map || !alert || !latlng) {
    return;
  }

  closeMapFlashCard();

  const safeUrl = safeExternalUrl(alert.webUrl);
  const states = formatStates(alert.area && alert.area.states);
  const nearbyStation = formatNearbyStation(alert.nearbyStation);
  const nearbyStationMetrics = formatNearbyStationMetrics(alert.nearbyStation);

  state.mapFlashCard = L.popup({
    autoClose: true,
    closeButton: false,
    className: "map-flash-card-popup",
    maxWidth: 320,
    offset: [0, -10]
  })
    .setLatLng(latlng)
    .setContent(
      "<article class=\"map-flash-card\">" +
        "<div class=\"map-flash-card-head\">" +
          "<span class=\"detail-badge " + escapeHtml(alert.level || "ama") + "\">" + escapeHtml(levelLabel(alert.level)) + "</span>" +
          "<span class=\"detail-badge ama\">" + escapeHtml(phaseLabel(alert.phase)) + "</span>" +
        "</div>" +
        "<h4 class=\"map-flash-card-title\">" + escapeHtml(alert.headline || "Alerta") + "</h4>" +
        "<p class=\"map-flash-card-copy\">" + escapeHtml(alert.event || "Evento") + " · " + escapeHtml(states) + "</p>" +
        "<p class=\"map-flash-card-copy\">" + escapeHtml(formatAlertCoverage(alert)) + " · " + escapeHtml(formatAlertTiming(alert.timing, alert.phase)) + "</p>" +
        (nearbyStation
          ? "<p class=\"map-flash-card-copy\">Estação próxima: " + escapeHtml(nearbyStation) + "</p>"
          : "") +
        (nearbyStationMetrics
          ? "<p class=\"map-flash-card-copy\">" + escapeHtml(nearbyStationMetrics) + "</p>"
          : "") +
        (alert.instruction
          ? "<p class=\"map-flash-card-copy\">" + escapeHtml(alert.instruction) + "</p>"
          : "") +
        (safeUrl
          ? "<a class=\"map-flash-card-link\" href=\"" + escapeHtml(safeUrl) + "\" target=\"_blank\" rel=\"noopener noreferrer\" referrerpolicy=\"no-referrer\">Abrir aviso oficial</a>"
          : "") +
      "</article>"
    )
    .openOn(state.map);
}

function closeMapFlashCard() {
  if (!state.mapFlashCard || !state.map) {
    return;
  }

  state.map.closePopup(state.mapFlashCard);
  state.mapFlashCard = null;
}

function alertLatLng(alert) {
  if (alert && alert.area && alert.area.centroid) {
    return [alert.area.centroid.lat, alert.area.centroid.lng];
  }

  if (alert && alert.area && Array.isArray(alert.area.bbox) && alert.area.bbox.length === 4) {
    const bbox = alert.area.bbox;

    return [
      (bbox[1] + bbox[3]) / 2,
      (bbox[0] + bbox[2]) / 2
    ];
  }

  return null;
}

function labelForStatus(status) {
  const map = {
    ok: "OK",
    partial: "PARCIAL",
    stale: "STALE",
    empty: "VAZIO",
    error: "ERRO",
    skipped: "PULADO"
  };

  return map[status] || "INFO";
}

function buildErrorMessage(error) {
  if (error && error.code === "CONFIG_MISSING") {
    return "Faltam as credenciais públicas da Supabase no build do Site.";
  }

  if (error && error.code === "REPORT_NOT_FOUND") {
    return "A tabela existe, mas ainda não há relatório salvo para a chave configurada.";
  }

  return "Não foi possível carregar o relatório atual da Supabase.";
}

function safeExternalUrl(value) {
  if (!value) {
    return "";
  }

  try {
    const parsed = new URL(String(value));
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "";
    }

    return parsed.toString();
  } catch (_error) {
    return "";
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
