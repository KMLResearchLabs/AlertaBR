const path = require("node:path");

const { loadEnv } = require("../../../shared/load-env");

const ROOT_DIR = path.resolve(__dirname, "../..");

loadEnv({ cwd: ROOT_DIR });

const config = {
  rootDir: ROOT_DIR,
  serviceName: process.env.API_SERVICE_NAME || "alertabr-render-api",
  port: clampInteger(process.env.PORT || process.env.API_PORT, 3001, 1, 65535),
  supabaseUrl: (process.env.API_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/+$/, ""),
  supabaseServiceRoleKey: process.env.API_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  reportKey: process.env.API_REPORT_KEY || process.env.REPORT_KEY || "brazil-latest",
  apiKeysTable: process.env.API_KEYS_TABLE || "api_keys",
  apiKeyHeaderName: String(process.env.API_KEY_HEADER_NAME || "x-api-key").toLowerCase(),
  corsOrigins: parseList(process.env.API_CORS_ORIGINS || "")
};

function validateApiConfig() {
  const missing = [];

  if (!config.supabaseUrl) {
    missing.push("API_SUPABASE_URL ou SUPABASE_URL");
  }

  if (!config.supabaseServiceRoleKey) {
    missing.push("API_SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_SERVICE_ROLE_KEY");
  }

  return {
    ok: missing.length === 0,
    missing
  };
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

module.exports = {
  config,
  validateApiConfig
};
