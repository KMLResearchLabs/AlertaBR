import { inject } from "@vercel/analytics"

inject()

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

const state = {
  report: null,
  selectedAlertId: null,
  map: null,
  polygonLayer: null,
  markerLayer: null,
  loading: false,
  mapFlashCard: null,
  currentView: "home",
  menuOpen: false,
  menuBackdropTimer: null
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  initMap();
  syncViewFromHash();
  loadReport();
});

function cacheElements() {
  elements.siteTitle = document.getElementById("site-title");
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
}

async function loadReport() {
  if (state.loading) {
    return;
  }

  state.loading = true;
  setStatus("loading", "Consultando base de dados", "Buscando o ultimo relatorio publicado.");

  try {
    const report = await fetchLatestReport();
    state.report = report;
    state.selectedAlertId = keepValidSelection(report.alerts, state.selectedAlertId);

    if (!state.selectedAlertId && Array.isArray(report.alerts) && report.alerts.length) {
      state.selectedAlertId = report.alerts[0].id;
    }

    renderReport();
    setStatus(
      "ready",
      "Relatorio carregado",
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

  if (elements.siteTitle) {
    elements.siteTitle.textContent = "AlertaBR";
  }
  elements.generatedAt.textContent = "Gerado em " + formatDateTime(report.generatedAt);
  elements.summaryActiveAlerts.textContent = safeValue(report.summary && report.summary.activeAlerts);
  elements.summaryStates.textContent = safeValue(report.summary && report.summary.statesAffected);
  elements.summarySeverity.textContent = safeValue(report.summary && report.summary.highestSeverity);
  elements.summaryStations.textContent = safeValue(report.summary && report.summary.stationsSampled);
  elements.mapMeta.textContent = (Array.isArray(report.alerts) ? report.alerts.length : 0) + " area(s) renderizadas.";
  elements.alertCount.textContent = (Array.isArray(report.alerts) ? report.alerts.length : 0) + " item(ns)";

  renderHighlights(report.highlights);
  renderSources(report.sources);
  renderAlerts(report.alerts);
  renderStations(report.sampleStations);
  renderNews(report.news);
  renderSelectedAlert();
  renderMap();
}

function renderHighlights(items) {
  if (!Array.isArray(items) || !items.length) {
    elements.highlightsGrid.innerHTML = "<div class=\"empty-state\">Nenhum destaque calculado no relatorio atual.</div>";
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
    elements.sourcesGrid.innerHTML = "<div class=\"empty-state\">Sem status de fontes neste relatorio.</div>";
    return;
  }

  elements.sourcesGrid.innerHTML = items.map((item) => (
    "<article class=\"source-card\">" +
      "<span class=\"source-pill " + escapeHtml(item.status || "empty") + "\">" + escapeHtml(labelForStatus(item.status)) + "</span>" +
      "<strong class=\"metric-value\" style=\"font-size:1.15rem;margin-top:14px\">" + escapeHtml(item.label || "Fonte") + "</strong>" +
      "<p class=\"source-detail\">" + escapeHtml(item.detail || "") + "</p>" +
      "<p class=\"source-meta\">" + escapeHtml(item.updatedAt ? formatDateTime(item.updatedAt) : "Sem horario informado") + "</p>" +
    "</article>"
  )).join("");
}

function renderAlerts(items) {
  if (!Array.isArray(items) || !items.length) {
    elements.alertList.innerHTML = "<div class=\"empty-state\">Nao ha alertas no relatorio salvo.</div>";
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
        "<span>ate " + escapeHtml(formatDateTime(alert.expires)) + "</span>" +
      "</p>" +
    "</button>"
  )).join("");
}

function renderStations(items) {
  if (!Array.isArray(items) || !items.length) {
    elements.stationsGrid.innerHTML = "<div class=\"empty-state\">Sem leituras de estacao neste ciclo.</div>";
    return;
  }

  elements.stationsGrid.innerHTML = items.map((item) => (
    "<article class=\"station-card\">" +
      "<h3>" + escapeHtml(item.label) + "</h3>" +
      "<p class=\"station-meta\">" + escapeHtml(item.region) + " · " + escapeHtml(item.station && item.station.name ? item.station.name : "Estacao INMET") + "</p>" +
      "<div class=\"station-stack\">" +
        stationRow("Temperatura", formatMetric(item.metrics && item.metrics.airTemperature)) +
        stationRow("Umidade", formatMetric(item.metrics && item.metrics.relativeHumidity)) +
        stationRow("Chuva 1h", formatMetric(item.metrics && item.metrics.precipitationLastHour)) +
        stationRow("Vento", formatMetric(item.metrics && item.metrics.windSpeed)) +
        stationRow(
          "Distancia",
          item.distanceKm !== undefined && item.distanceKm !== null ? formatNumber(item.distanceKm) + " km" : "n/d"
        ) +
      "</div>" +
      "<p class=\"station-meta\">Observado em " + escapeHtml(formatDateTime(item.observedAt)) + "</p>" +
    "</article>"
  )).join("");
}

function renderNews(items) {
  if (!Array.isArray(items) || !items.length) {
    elements.newsList.innerHTML = "<div class=\"empty-state\">Nenhuma noticia agregada no ciclo atual.</div>";
    return;
  }

  elements.newsList.innerHTML = items.map((item) => {
    const safeUrl = safeExternalUrl(item.url);

    return (
    "<a class=\"news-card\" href=\"" + escapeHtml(safeUrl || "#") + "\" target=\"_blank\" rel=\"noopener noreferrer\" referrerpolicy=\"no-referrer\">" +
      "<h3 class=\"news-title\">" + escapeHtml(item.title || "Sem titulo") + "</h3>" +
      "<p class=\"news-summary\">" + escapeHtml(item.summary || "Sem resumo adicional.") + "</p>" +
      "<p class=\"news-meta\">" + escapeHtml(item.source || "Fonte") + " · " + escapeHtml(formatDateTime(item.publishedAt)) + "</p>" +
    "</a>"
  );
  }).filter(Boolean).join("");
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

  elements.alertDetail.innerHTML =
    "<div class=\"detail-badge-row\">" +
      "<span class=\"detail-badge " + escapeHtml(alert.level || "ama") + "\">" + escapeHtml(levelLabel(alert.level)) + "</span>" +
      "<span class=\"detail-badge ama\">" + escapeHtml(phaseLabel(alert.phase)) + "</span>" +
    "</div>" +
    "<h3 class=\"detail-title\">" + escapeHtml(alert.headline || "Alerta") + "</h3>" +
    "<p class=\"detail-copy\">" + escapeHtml(alert.description || "Sem descricao adicional.") + "</p>" +
    "<ul class=\"detail-list\">" +
      detailLine("Evento", alert.event || "n/d") +
      detailLine("Estados", formatStates(alert.area && alert.area.states)) +
      detailLine("Municipios", municipalities || "Sem amostra") +
      detailLine("Validade", formatDateTime(alert.onset) + " ate " + formatDateTime(alert.expires)) +
      detailLinkLine("Link oficial", safeUrl) +
    "</ul>";
}

function renderMap() {
  state.polygonLayer.clearLayers();
  state.markerLayer.clearLayers();

  const alerts = Array.isArray(state.report && state.report.alerts) ? state.report.alerts : [];
  const bounds = [];

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

      polygon.on("click", (event) => {
        selectAlert(alert.id, false, {
          source: "map",
          openMapFlashCard: true,
          latlng: event && event.latlng ? event.latlng : null
        });
      });
      polygon.addTo(state.polygonLayer);

      if (polygon.getBounds && polygon.getBounds().isValid()) {
        bounds.push(polygon.getBounds());
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

  if (bounds.length) {
    const aggregate = bounds[0];
    for (let index = 1; index < bounds.length; index += 1) {
      aggregate.extend(bounds[index]);
    }

    state.map.fitBounds(aggregate, {
      padding: [24, 24],
      maxZoom: 6
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
  elements.mapMeta.textContent = "Sem geometrias carregadas.";
  elements.alertCount.textContent = "0 item(ns)";
  elements.highlightsGrid.innerHTML = "<div class=\"empty-state\">" + escapeHtml(buildErrorMessage(error)) + "</div>";
  elements.sourcesGrid.innerHTML = "<div class=\"empty-state\">Configure `SITE_SUPABASE_URL` e `SITE_SUPABASE_ANON_KEY` para ativar o painel.</div>";
  elements.alertList.innerHTML = "<div class=\"empty-state\">Nenhum alerta disponivel no momento.</div>";
  elements.stationsGrid.innerHTML = "<div class=\"empty-state\">Sem leituras disponiveis.</div>";
  elements.newsList.innerHTML = "<div class=\"empty-state\">Sem noticias disponiveis.</div>";
  elements.alertDetail.innerHTML = "<p class=\"detail-empty\">O detalhe do alerta aparecera aqui quando o relatorio for carregado.</p>";
  state.polygonLayer.clearLayers();
  state.markerLayer.clearLayers();
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
    return detailLine(label, "Nao informado");
  }

  return (
    "<li><strong>" + escapeHtml(label) + ":</strong> " +
    "<a class=\"detail-link\" href=\"" + escapeHtml(url) + "\" target=\"_blank\" rel=\"noopener noreferrer\" referrerpolicy=\"no-referrer\">" +
    "Abrir aviso oficial" +
    "</a></li>"
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
  return LEVEL_META[level] ? LEVEL_META[level].label : "Sem nivel";
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
  const municipalities = alert.area && alert.area.municipalityCount
    ? String(alert.area.municipalityCount) + " municipio(s)"
    : "Cobertura sem contagem";
  const states = formatStates(alert.area && alert.area.states);

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
        "<p class=\"map-flash-card-copy\">" + escapeHtml(municipalities) + " · " + escapeHtml(formatDateTime(alert.expires)) + "</p>" +
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
    return "Faltam as credenciais publicas da Supabase no build do Site.";
  }

  if (error && error.code === "REPORT_NOT_FOUND") {
    return "A tabela existe, mas ainda nao ha relatorio salvo para a chave configurada.";
  }

  return "Nao foi possivel carregar o relatorio atual da Supabase.";
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
