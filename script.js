const STORAGE_KEY = "alertabr.preferences.v1";
const DEFAULT_VIEW = { center: [-15, -52], zoom: 4 };
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const API_BASE = resolveApiBase();

const COR = {
  verm: "#e24b4a",
  lar: "#ef9f27",
  ama: "#d4b400",
  user: "#378add",
  station: "#2f7a1f"
};

const LAYER_CONFIG = {
  markers: { label: "Marcadores", enabled: true },
  polygons: { label: "Áreas afetadas", enabled: true },
  user: { label: "Minha posição", enabled: true }
};

const state = {
  alerts: [],
  summary: null,
  filter: "todos",
  selectedId: null,
  map: null,
  layerGroups: {},
  userContext: null,
  toastTimer: null,
  refreshTimer: null,
  loading: false
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  initMap();
  bindEvents();
  loadPreferences();
  loadDashboard();
  state.refreshTimer = window.setInterval(loadDashboard, REFRESH_INTERVAL_MS);
});

function resolveApiBase() {
  const configured = window.ALERTABR_CONFIG && typeof window.ALERTABR_CONFIG.apiBase === "string"
    ? window.ALERTABR_CONFIG.apiBase.trim()
    : "";

  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  if (window.location.protocol === "file:") {
    return "http://localhost:3000";
  }

  return "";
}

function cacheElements() {
  elements.list = document.getElementById("alist");
  elements.count = document.getElementById("cnt");
  elements.popup = document.getElementById("popup");
  elements.popupClose = document.getElementById("popup-close");
  elements.popupTag = document.getElementById("ptag");
  elements.popupTitle = document.getElementById("ptitle");
  elements.popupLocation = document.getElementById("ploc");
  elements.popupDescription = document.getElementById("pdesc");
  elements.popupStats = document.getElementById("pstats");
  elements.popupSource = document.getElementById("psrc");
  elements.locationButton = document.getElementById("loc-btn");
  elements.locationButtonLabel = document.getElementById("loc-btn-label");
  elements.locationInput = document.getElementById("loc-input");
  elements.locationInfo = document.getElementById("locinfo");
  elements.toast = document.getElementById("toast");
  elements.modal = document.getElementById("modal");
  elements.openModal = document.getElementById("modal-open");
  elements.closeModal = document.getElementById("modal-close");
  elements.cancelModal = document.getElementById("modal-cancel");
  elements.subscriptionForm = document.getElementById("subscription-form");
  elements.emailInput = document.getElementById("memail");
  elements.cityInput = document.getElementById("mcity");
  elements.summaryDanger = document.getElementById("summary-danger");
  elements.summaryOrange = document.getElementById("summary-orange");
  elements.summaryYellow = document.getElementById("summary-yellow");
  elements.summaryUpcoming = document.getElementById("summary-elnino");
  elements.feedStatus = document.getElementById("feed-status");
  elements.feedStatusLabel = document.getElementById("feed-status-label");
  elements.feedUpdatedAt = document.getElementById("feed-updated-at");
}

function bindEvents() {
  elements.list.addEventListener("click", (event) => {
    const item = event.target.closest("[data-alert-id]");
    if (!item) return;
    selectAlert(item.getAttribute("data-alert-id"), true);
  });

  elements.list.addEventListener("keydown", (event) => {
    const item = event.target.closest("[data-alert-id]");
    if (!item) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectAlert(item.getAttribute("data-alert-id"), true);
    }
  });

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach((item) => {
        item.classList.toggle("on", item === button);
      });
      renderList();
    });
  });

  document.querySelectorAll("[data-layer]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleLayer(button.dataset.layer);
    });
  });

  elements.locationButton.addEventListener("click", handleLocationAction);
  elements.locationInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleLocationAction();
    }
  });

  elements.popupClose.addEventListener("click", closePopup);
  elements.openModal.addEventListener("click", openModal);
  elements.closeModal.addEventListener("click", closeModal);
  elements.cancelModal.addEventListener("click", closeModal);
  elements.modal.addEventListener("click", (event) => {
    if (event.target === elements.modal) {
      closeModal();
    }
  });
  elements.subscriptionForm.addEventListener("submit", savePreferences);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (elements.modal.classList.contains("open")) {
        closeModal();
        return;
      }

      if (elements.popup.classList.contains("show")) {
        closePopup();
      }
    }
  });
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

  state.layerGroups.markers = L.layerGroup().addTo(state.map);
  state.layerGroups.polygons = L.layerGroup().addTo(state.map);
  state.layerGroups.user = L.layerGroup().addTo(state.map);
}

async function loadDashboard() {
  if (state.loading) {
    return;
  }

  state.loading = true;
  setFeedStatus("Carregando feed oficial", "loading");

  try {
    const response = await fetch(apiUrl("/api/dashboard?limit=80"));
    if (!response.ok) {
      throw new Error("A API respondeu com erro ao consultar o dashboard.");
    }

    const payload = await response.json();
    state.alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
    state.summary = payload.summary || null;

    if (!state.alerts.some((alert) => alert.id === state.selectedId)) {
      state.selectedId = null;
      elements.popup.classList.remove("show");
    }

    renderSummary();
    renderList();
    renderMapLayers();
    syncLayerButtons();
    updateFeedStatus(payload);

    if (!state.selectedId && state.alerts.length) {
      selectAlert(state.alerts[0].id, false);
    }
  } catch (error) {
    console.error(error);
    setFeedStatus("Falha ao carregar o feed oficial", "error");
    elements.feedUpdatedAt.textContent = "API indisponível";
    showToast("Falha ao consultar a API oficial do INMET.");
    showLocationMessage(
      "Não foi possível carregar a API agora. Verifique o backend no Render ou o valor de ALERTABR_CONFIG.apiBase.",
      "var(--red-d)"
    );

    if (!state.alerts.length) {
      renderEmptyState("Aguardando dados reais do backend.");
    }
  } finally {
    state.loading = false;
  }
}

function renderSummary() {
  const summary = state.summary || {
    byLevel: { verm: 0, lar: 0, ama: 0 },
    byPhase: { upcoming: 0 }
  };

  elements.summaryDanger.textContent = summary.byLevel && summary.byLevel.verm ? summary.byLevel.verm : 0;
  elements.summaryOrange.textContent = summary.byLevel && summary.byLevel.lar ? summary.byLevel.lar : 0;
  elements.summaryYellow.textContent = summary.byLevel && summary.byLevel.ama ? summary.byLevel.ama : 0;
  elements.summaryUpcoming.textContent = summary.byPhase && summary.byPhase.upcoming ? summary.byPhase.upcoming : 0;
}

function renderList() {
  const alerts = getVisibleAlerts();
  elements.count.textContent = String(alerts.length);

  if (!alerts.length) {
    renderEmptyState("Nenhum alerta corresponde ao filtro atual.");
    return;
  }

  elements.list.innerHTML = alerts.map((alert) => (
    "<article class=\"aitem" + (state.selectedId === alert.id ? " sel" : "") + "\" data-alert-id=\"" + escapeHtml(alert.id) + "\" tabindex=\"0\" role=\"button\" aria-pressed=\"" + String(state.selectedId === alert.id) + "\">" +
      "<div class=\"adot " + dotClass(alert.level) + "\"></div>" +
      "<div class=\"abody\">" +
        "<div class=\"aname\">" + escapeHtml(alert.headline) + "</div>" +
        "<div class=\"ameta\">" +
          "<span class=\"atag " + nivelClass(alert.level) + "\">" + escapeHtml(nivelLabel(alert.level)) + "</span>" +
          "<span class=\"aloc\">" + escapeHtml(formatListLocation(alert)) + "</span>" +
        "</div>" +
        "<div class=\"ameta\" style=\"margin-top:2px\">" +
          "<span class=\"ahora\">" + escapeHtml(formatPhaseLine(alert)) + "</span>" +
          "<span class=\"asrc\">INMET · " + escapeHtml(alert.event) + "</span>" +
        "</div>" +
      "</div>" +
    "</article>"
  )).join("");
}

function renderEmptyState(message) {
  elements.list.innerHTML = "<div class=\"empty\">" + escapeHtml(message) + "</div>";
}

function renderMapLayers() {
  state.layerGroups.markers.clearLayers();
  state.layerGroups.polygons.clearLayers();

  state.alerts.forEach((alert) => {
    if (alert.area && alert.area.geometry) {
      const polygon = L.geoJSON(alert.area.geometry, {
        style: {
          color: COR[alert.level] || COR.ama,
          fillColor: COR[alert.level] || COR.ama,
          fillOpacity: 0.1,
          weight: state.selectedId === alert.id ? 2.4 : 1.2,
          opacity: state.selectedId === alert.id ? 0.95 : 0.45
        }
      });

      polygon.on("click", () => selectAlert(alert.id, true));
      state.layerGroups.polygons.addLayer(polygon);
    }

    if (alert.area && alert.area.centroid) {
      const marker = L.marker(
        [alert.area.centroid.lat, alert.area.centroid.lng],
        { icon: mkIcon(alert.level) }
      );

      marker.on("click", () => selectAlert(alert.id, true));
      state.layerGroups.markers.addLayer(marker);
    }
  });

  if (state.userContext) {
    renderUserLayers();
  }
}

function renderUserLayers() {
  state.layerGroups.user.clearLayers();
  if (!state.userContext) {
    return;
  }

  const userMarker = L.circleMarker(
    [state.userContext.position.lat, state.userContext.position.lng],
    {
      radius: 6,
      color: "#0c447c",
      fillColor: COR.user,
      fillOpacity: 1,
      weight: 2
    }
  );

  const userHalo = L.circle(
    [state.userContext.position.lat, state.userContext.position.lng],
    {
      radius: 35000,
      color: COR.user,
      fillColor: COR.user,
      fillOpacity: 0.08,
      weight: 1
    }
  );

  state.layerGroups.user.addLayer(userHalo);
  state.layerGroups.user.addLayer(userMarker);

  if (state.userContext.observation && state.userContext.observation.station) {
    const station = state.userContext.observation.station;
    const stationMarker = L.circleMarker(
      [station.position.lat, station.position.lng],
      {
        radius: 5,
        color: "#1f5d10",
        fillColor: COR.station,
        fillOpacity: 1,
        weight: 2
      }
    );

    stationMarker.bindTooltip("Estação INMET: " + station.name, { direction: "top" });
    state.layerGroups.user.addLayer(stationMarker);
  }

  if (!LAYER_CONFIG.user.enabled && state.map.hasLayer(state.layerGroups.user)) {
    state.map.removeLayer(state.layerGroups.user);
  }
}

function selectAlert(id, moveMap) {
  const alert = state.alerts.find((item) => item.id === id);
  if (!alert) {
    return;
  }

  state.selectedId = alert.id;
  renderList();
  renderPopup(alert);
  renderMapLayers();

  if (!moveMap) {
    return;
  }

  if (alert.area && alert.area.bbox) {
    const bbox = alert.area.bbox;
    state.map.fitBounds([
      [bbox[1], bbox[0]],
      [bbox[3], bbox[2]]
    ], {
      padding: [24, 24],
      maxZoom: 7
    });
    return;
  }

  if (alert.area && alert.area.centroid) {
    state.map.flyTo([alert.area.centroid.lat, alert.area.centroid.lng], 7, { duration: 1.1 });
  }
}

function renderPopup(alert) {
  elements.popupTag.innerHTML =
    "<span class=\"atag " + nivelClass(alert.level) + "\">" + escapeHtml(nivelLabel(alert.level)) + "</span>" +
    " <span style=\"font-size:10px;color:var(--text2);margin-left:5px\">" + escapeHtml(formatPhaseLine(alert)) + "</span>";

  elements.popupTitle.textContent = alert.headline;
  elements.popupLocation.innerHTML =
    "<span class=\"icon\" aria-hidden=\"true\">" + iconSvg("pin", 12) + "</span>" +
    escapeHtml(formatPopupLocation(alert));
  elements.popupDescription.textContent = alert.description || "Sem descrição detalhada.";
  elements.popupStats.innerHTML = buildPopupStats(alert).map((stat) => (
    "<div class=\"pstat\">" +
      "<div class=\"psl\">" + escapeHtml(stat.label) + "</div>" +
      "<div class=\"psv\">" + escapeHtml(stat.value) + "</div>" +
    "</div>"
  )).join("");

  const links = [];
  if (alert.webUrl) {
    links.push("<a href=\"" + escapeHtml(alert.webUrl) + "\" target=\"_blank\" rel=\"noopener noreferrer\">aviso público</a>");
  }
  if (alert.sourceUrls && alert.sourceUrls.cap) {
    links.push("<a href=\"" + escapeHtml(alert.sourceUrls.cap) + "\" target=\"_blank\" rel=\"noopener noreferrer\">CAP XML</a>");
  }

  elements.popupSource.innerHTML =
    "Fonte: INMET" + (links.length ? " · " + links.join(" · ") : "");
  elements.popup.classList.add("show");
}

function buildPopupStats(alert) {
  return [
    {
      label: "Evento",
      value: alert.event || "Aviso"
    },
    {
      label: "Municípios",
      value: alert.area && alert.area.municipalityCount ? String(alert.area.municipalityCount) : "n/d"
    },
    {
      label: "Início",
      value: formatDateShort(alert.onset)
    },
    {
      label: "Expira",
      value: formatDateShort(alert.expires)
    }
  ];
}

function closePopup() {
  state.selectedId = null;
  elements.popup.classList.remove("show");
  renderList();
  renderMapLayers();
}

function getVisibleAlerts() {
  if (!state.filter || state.filter === "todos") {
    return state.alerts;
  }

  if (state.filter === "upcoming") {
    return state.alerts.filter((alert) => alert.phase === "upcoming");
  }

  return state.alerts.filter((alert) => alert.level === state.filter);
}

function toggleLayer(layerKey) {
  const config = LAYER_CONFIG[layerKey];
  const layer = state.layerGroups[layerKey];

  if (!config || !layer) {
    return;
  }

  config.enabled = !config.enabled;

  if (config.enabled) {
    state.map.addLayer(layer);
  } else {
    state.map.removeLayer(layer);
  }

  syncLayerButtons();
  showToast((config.enabled ? "Camada ativada: " : "Camada desativada: ") + config.label);
}

function syncLayerButtons() {
  Object.keys(LAYER_CONFIG).forEach((key) => {
    const button = document.querySelector("[data-layer=\"" + key + "\"]");
    if (!button) {
      return;
    }

    button.classList.toggle("on", LAYER_CONFIG[key].enabled);
    button.setAttribute("aria-pressed", String(LAYER_CONFIG[key].enabled));
  });
}

async function handleLocationAction() {
  const query = elements.locationInput.value.trim();
  if (query) {
    searchAlertsByQuery(query);
    return;
  }

  if (!navigator.geolocation) {
    showLocationMessage("Seu navegador não oferece geolocalização. Faça uma busca manual por cidade, estado ou evento.", "var(--red-d)");
    return;
  }

  elements.locationButton.disabled = true;
  elements.locationButtonLabel.textContent = "Detectando...";
  elements.locationInput.placeholder = "Detectando localização...";

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      await handleGeolocationSuccess(position);
    },
    handleGeolocationError,
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 300000
    }
  );
}

async function searchAlertsByQuery(query) {
  const normalizedQuery = normalizeText(query);
  const localMatches = state.alerts.filter((alert) => buildAlertSearchText(alert).includes(normalizedQuery));

  try {
    const response = await fetch(apiUrl("/api/alerts?limit=20&search=" + encodeURIComponent(query)));
    if (!response.ok) {
      throw new Error("A API falhou ao processar a busca.");
    }

    const payload = await response.json();
    const matches = Array.isArray(payload.alerts) ? payload.alerts : [];

    if (!matches.length) {
      showLocationMessage("Nenhum alerta oficial corresponde a \"" + query.trim() + "\".", "var(--text2)");
      showToast("Nenhum alerta encontrado para a busca.");
      return;
    }

    mergeAlerts(matches);
    selectAlert(matches[0].id, true);
    showLocationMessage(
      matches.length + " alerta(s) oficial(is) encontrado(s). Exibindo o mais relevante: " + matches[0].headline + ".",
      "var(--blue-d)"
    );
  } catch (error) {
    console.error(error);

    if (!localMatches.length) {
      showLocationMessage("A API não respondeu à busca e não há correspondência no cache atual.", "var(--red-d)");
      showToast("Busca indisponível no momento.");
      return;
    }

    selectAlert(localMatches[0].id, true);
    showLocationMessage(
      "Busca usando o conjunto já carregado. Exibindo o alerta mais próximo da consulta.",
      "var(--blue-d)"
    );
  }
}

async function handleGeolocationSuccess(position) {
  const lat = position.coords.latitude;
  const lng = position.coords.longitude;

  elements.locationButton.disabled = false;
  elements.locationButtonLabel.textContent = "Buscar / Detectar";
  elements.locationInput.placeholder = "Ex: São Paulo, SP";
  elements.locationInput.value = lat.toFixed(2) + ", " + lng.toFixed(2);

  try {
    const response = await fetch(apiUrl("/api/observations/nearest?lat=" + lat + "&lng=" + lng));
    if (!response.ok) {
      throw new Error("A API falhou ao consultar a estação oficial mais próxima.");
    }

    const payload = await response.json();
    state.userContext = {
      position: { lat, lng },
      observation: payload
    };
    renderUserLayers();

    const nearestAlert = findNearestAlert(lat, lng);
    if (nearestAlert) {
      selectAlert(nearestAlert.id, false);
    }

    const stationName = payload.station ? payload.station.name : "estação oficial";
    const temperature = payload.observation && payload.observation.metrics && payload.observation.metrics.airTemperature
      ? payload.observation.metrics.airTemperature.value + " " + payload.observation.metrics.airTemperature.units
      : "n/d";

    showLocationMessage(
      "Posição detectada. Estação INMET mais próxima: " + stationName + " (" + payload.distanceKm + " km), temperatura observada: " + temperature + ".",
      "var(--green-d)"
    );

    state.map.flyTo([lat, lng], 7, { duration: 1.2 });
  } catch (error) {
    console.error(error);
    showLocationMessage(
      "A posição foi detectada, mas a API não conseguiu devolver a estação oficial mais próxima agora.",
      "var(--red-d)"
    );
  }
}

function handleGeolocationError(error) {
  elements.locationButton.disabled = false;
  elements.locationButtonLabel.textContent = "Buscar / Detectar";
  elements.locationInput.placeholder = "Ex: São Paulo, SP";

  const messages = {
    1: "Permissão de localização negada. Digite uma cidade, estado ou evento para buscar alertas oficiais.",
    2: "Não foi possível obter sua localização agora. Tente novamente ou faça uma busca manual.",
    3: "A localização expirou antes de responder. Tente novamente ou faça uma busca manual."
  };

  showLocationMessage(messages[error.code] || "Falha ao detectar localização. Faça uma busca manual.", "var(--red-d)");
}

function findNearestAlert(lat, lng) {
  if (!state.alerts.length) {
    return null;
  }

  return state.alerts.reduce((closest, alert) => {
    if (!alert.area || !alert.area.centroid) {
      return closest;
    }

    const distance = distanceKm(lat, lng, alert.area.centroid.lat, alert.area.centroid.lng);
    if (!closest || distance < closest.distance) {
      return { alert, distance };
    }

    return closest;
  }, null)?.alert || null;
}

function openModal() {
  elements.modal.classList.add("open");
  if (!elements.cityInput.value && elements.locationInput.value.trim()) {
    elements.cityInput.value = elements.locationInput.value.trim();
  }
  elements.emailInput.focus();
}

function closeModal() {
  elements.modal.classList.remove("open");
}

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) {
      return;
    }

    elements.emailInput.value = saved.email || "";
    elements.cityInput.value = saved.city || "";

    if (Array.isArray(saved.topics)) {
      const selected = new Set(saved.topics);
      document.querySelectorAll("input[name=\"alert_topics\"]").forEach((checkbox) => {
        checkbox.checked = selected.has(checkbox.value);
      });
    }
  } catch (error) {
    console.warn("Não foi possível carregar preferências locais.", error);
  }
}

function savePreferences(event) {
  event.preventDefault();

  const email = elements.emailInput.value.trim();
  const city = elements.cityInput.value.trim();
  const topics = Array.from(document.querySelectorAll("input[name=\"alert_topics\"]:checked"))
    .map((item) => item.value);

  if (!isValidEmail(email)) {
    showToast("Informe um e-mail válido.");
    elements.emailInput.focus();
    return;
  }

  if (!city) {
    showToast("Informe uma cidade ou estado.");
    elements.cityInput.focus();
    return;
  }

  const payload = {
    email,
    city,
    topics,
    savedAt: new Date().toISOString()
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("Falha ao persistir preferências locais.", error);
  }

  closeModal();
  showToast("Preferências salvas neste navegador.");
  showLocationMessage("Preferências locais salvas para " + city + ".", "var(--green-d)");
}

function updateFeedStatus(payload) {
  if (payload.stale) {
    setFeedStatus("Feed oficial em cache", "stale");
  } else {
    setFeedStatus("Feed oficial INMET online", "ok");
  }

  const latest = payload.summary && payload.summary.latestPublication
    ? payload.summary.latestPublication
    : payload.sourceHealth && payload.sourceHealth.cachedAt;

  elements.feedUpdatedAt.textContent = latest
    ? "Atualizado " + formatDateTime(latest)
    : "Atualização indisponível";
}

function setFeedStatus(label, status) {
  elements.feedStatus.dataset.state = status;
  const indicator = elements.feedStatus.querySelector(".dot");
  if (indicator) {
    if (status === "stale") {
      indicator.style.background = "#ffcf4a";
    } else if (status === "error") {
      indicator.style.background = "#ff7b7b";
    } else {
      indicator.style.background = "#6ee79b";
    }
  }

  elements.feedStatusLabel.textContent = label;
}

function showLocationMessage(message, color) {
  elements.locationInfo.textContent = message;
  elements.locationInfo.style.color = color;
  elements.locationInfo.classList.add("show");
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 3200);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function apiUrl(pathname) {
  return API_BASE + pathname;
}

function buildAlertSearchText(alert) {
  return normalizeText([
    alert.headline,
    alert.event,
    alert.description,
    alert.area && alert.area.description,
    alert.area && alert.area.stateNames ? alert.area.stateNames.join(" ") : "",
    alert.area && alert.area.states ? alert.area.states.join(" ") : "",
    alert.area && alert.area.municipalitiesPreview
      ? alert.area.municipalitiesPreview.map((item) => item.name + " " + item.state).join(" ")
      : ""
  ].join(" "));
}

function mergeAlerts(alerts) {
  const byId = new Map(state.alerts.map((alert) => [alert.id, alert]));
  alerts.forEach((alert) => {
    byId.set(alert.id, alert);
  });

  state.alerts = Array.from(byId.values()).sort((left, right) => {
    return new Date(right.publishedAt || 0) - new Date(left.publishedAt || 0);
  });
  renderList();
  renderMapLayers();
}

function formatListLocation(alert) {
  if (alert.area && alert.area.stateNames && alert.area.stateNames.length) {
    return alert.area.stateNames.slice(0, 2).join(" · ");
  }

  if (alert.area && alert.area.states && alert.area.states.length) {
    return alert.area.states.join(" · ");
  }

  return "Brasil";
}

function formatPopupLocation(alert) {
  const parts = [];
  if (alert.area && alert.area.description) {
    parts.push(alert.area.description);
  }

  if (alert.area && alert.area.stateNames && alert.area.stateNames.length) {
    parts.push(alert.area.stateNames.join(", "));
  }

  return parts.join(" — ") || "Área oficial do aviso";
}

function formatPhaseLine(alert) {
  const phaseLabel = alert.phase === "upcoming" ? "Começa em" : "Válido até";
  const target = alert.phase === "upcoming" ? alert.onset : alert.expires;
  return phaseLabel + " " + formatDateShort(target);
}

function formatDateShort(value) {
  if (!value) {
    return "n/d";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "n/d";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "n/d";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function nivelLabel(level) {
  if (level === "verm") return "PERIGO MÁXIMO";
  if (level === "lar") return "LARANJA — PERIGO";
  if (level === "ama") return "AMARELO — ATENÇÃO";
  return "AVISO OFICIAL";
}

function nivelClass(level) {
  if (level === "verm" || level === "lar" || level === "ama") {
    return "t-" + level;
  }

  return "t-ama";
}

function dotClass(level) {
  if (level === "verm" || level === "lar" || level === "ama") {
    return "d-" + level;
  }

  return "d-ama";
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => (
    {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[char]
  ));
}

function iconSvg(name, size = 14) {
  const icons = {
    verm: "<path d=\"M12 7v5\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\"/><circle cx=\"12\" cy=\"16.2\" r=\"1.1\" fill=\"currentColor\"/><path d=\"M10.3 3.8 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linejoin=\"round\" fill=\"none\"/>",
    lar: "<path d=\"M7 15.5a4.5 4.5 0 1 1 2-8.5 5.5 5.5 0 0 1 10 2.5A3.5 3.5 0 1 1 18 16H7.5\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"m10 15 1.4 2.4M14 15l1.4 2.4\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\"/>",
    ama: "<path d=\"M7 15.5a4.5 4.5 0 1 1 2-8.5 5.5 5.5 0 0 1 10 2.5A3.5 3.5 0 1 1 18 16H7.5\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"m12 15.5-1.2 3M15.5 15.5l-1.2 3\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\"/>",
    pin: "<path d=\"M12 20s6-5.4 6-10a6 6 0 1 0-12 0c0 4.6 6 10 6 10Z\" stroke=\"currentColor\" stroke-width=\"1.7\" fill=\"none\"/><circle cx=\"12\" cy=\"10\" r=\"2\" fill=\"currentColor\"/>"
  };

  const markup = icons[name] || icons.ama;
  return "<svg width=\"" + size + "\" height=\"" + size + "\" viewBox=\"0 0 24 24\" fill=\"none\" aria-hidden=\"true\">" + markup + "</svg>";
}

function markerHtml(level, size) {
  return (
    "<div class=\"map-marker\" style=\"width:" + size + "px;height:" + size + "px;background:" + (COR[level] || COR.ama) + ";color:#fff;\">" +
    iconSvg(level, level === "verm" ? 15 : 13) +
    "</div>"
  );
}

function mkIcon(level) {
  const size = level === "verm" ? 34 : 28;
  return L.divIcon({
    className: "",
    html: markerHtml(level, size),
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}
