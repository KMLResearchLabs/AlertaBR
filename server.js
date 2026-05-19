const path = require("node:path");
const express = require("express");
const cors = require("cors");

const {
  DEFAULT_ALERT_LIMIT,
  getAlerts,
  getDashboardData,
  getNearestObservation,
  getServiceStatus
} = require("./src/services/inmet");

const app = express();
const rootDir = __dirname;

const port = Number(process.env.PORT || 3000);
const corsOrigin = process.env.ALERTABR_CORS_ORIGIN || "*";

app.disable("x-powered-by");
app.use(express.json());
app.use(cors(buildCorsOptions(corsOrigin)));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "alertabr",
    time: new Date().toISOString()
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "alertabr",
    time: new Date().toISOString(),
    status: getServiceStatus()
  });
});

app.get("/api/dashboard", wrapAsync(async (req, res) => {
  const limit = clampInteger(req.query.limit, DEFAULT_ALERT_LIMIT, 1, 120);
  const payload = await getDashboardData({ limit });

  res.set("Cache-Control", "public, max-age=60");
  res.json(payload);
}));

app.get("/api/alerts", wrapAsync(async (req, res) => {
  const limit = clampInteger(req.query.limit, DEFAULT_ALERT_LIMIT, 1, 120);
  const state = typeof req.query.state === "string" ? req.query.state.trim().toUpperCase() : "";
  const level = typeof req.query.level === "string" ? req.query.level.trim().toLowerCase() : "";
  const phase = typeof req.query.phase === "string" ? req.query.phase.trim().toLowerCase() : "";
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

  const payload = await getAlerts({ limit, state, level, phase, search });

  res.set("Cache-Control", "public, max-age=60");
  res.json(payload);
}));

app.get("/api/observations/nearest", wrapAsync(async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({
      error: "Parâmetros lat e lng são obrigatórios."
    });
    return;
  }

  const payload = await getNearestObservation(lat, lng);

  res.set("Cache-Control", "public, max-age=60");
  res.json(payload);
}));

app.use(express.static(rootDir, {
  extensions: ["html"]
}));

app.get("*", (_req, res) => {
  res.sendFile(path.join(rootDir, "index.html"));
});

app.use((error, _req, res, _next) => {
  const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  const message = status >= 500
    ? "Falha ao consultar os dados oficiais do INMET."
    : error.message;

  if (status >= 500) {
    console.error(error);
  }

  res.status(status).json({
    error: message,
    detail: error.detail || null,
    time: new Date().toISOString()
  });
});

app.listen(port, () => {
  console.log("AlertaBR ativo em http://localhost:" + port);
});

function wrapAsync(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function buildCorsOptions(originSetting) {
  if (originSetting === "*") {
    return { origin: true };
  }

  const allowedOrigins = originSetting
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin não permitida por CORS."));
    }
  };
}
