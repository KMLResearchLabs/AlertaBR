const path = require("node:path");

const { loadEnv } = require("../../shared/load-env");

const ROOT_DIR = path.resolve(__dirname, "../..");

loadEnv({ cwd: ROOT_DIR });

const config = {
  rootDir: ROOT_DIR,
  port: clampInteger(process.env.PORT, 3000, 1, 65535),
  reportKey: process.env.REPORT_KEY || "brazil-latest",
  reportCadenceMinutes: clampInteger(process.env.REPORT_CADENCE_MINUTES, 30, 5, 1440),
  manualRunSecret: process.env.MANUAL_RUN_SECRET || "",
  supabaseUrl: (process.env.SUPABASE_URL || "").replace(/\/+$/, ""),
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  vapidSubject: process.env.VAPID_SUBJECT || "",
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || process.env.SITE_PUSH_PUBLIC_KEY || "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || "",
  siteBaseUrl: (process.env.SITE_BASE_URL || process.env.SITE_API_BASE_URL || "").replace(/\/+$/, ""),
  notificationSubscriptionsTable: process.env.NOTIFICATION_SUBSCRIPTIONS_TABLE || "notification_subscriptions",
  notificationDeliveriesTable: process.env.NOTIFICATION_DELIVERIES_TABLE || "notification_deliveries",
  alertLimit: clampInteger(process.env.INMET_ALERT_OUTPUT_LIMIT, 80, 1, 120),
  stationSamples: [
    { key: "belem", label: "Belem, PA", region: "Norte", lat: -1.4558, lng: -48.5039 },
    { key: "manaus", label: "Manaus, AM", region: "Norte", lat: -3.119, lng: -60.0217 },
    { key: "fortaleza", label: "Fortaleza, CE", region: "Nordeste", lat: -3.7319, lng: -38.5267 },
    { key: "salvador", label: "Salvador, BA", region: "Nordeste", lat: -12.9777, lng: -38.5016 },
    { key: "brasilia", label: "Brasilia, DF", region: "Centro-Oeste", lat: -15.7939, lng: -47.8828 },
    { key: "sao-paulo", label: "Sao Paulo, SP", region: "Sudeste", lat: -23.5505, lng: -46.6333 },
    { key: "porto-alegre", label: "Porto Alegre, RS", region: "Sul", lat: -30.0346, lng: -51.2177 }
  ]
};

function validateStorageConfig() {
  const missing = [];

  if (!config.supabaseUrl) {
    missing.push("SUPABASE_URL");
  }

  if (!config.supabaseServiceRoleKey) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }

  return {
    ok: missing.length === 0,
    missing
  };
}

function validateNotificationConfig() {
  const validation = validateStorageConfig();
  const missing = [...validation.missing];

  if (!config.vapidSubject) {
    missing.push("VAPID_SUBJECT");
  }

  if (!config.vapidPublicKey) {
    missing.push("VAPID_PUBLIC_KEY ou SITE_PUSH_PUBLIC_KEY");
  }

  if (!config.vapidPrivateKey) {
    missing.push("VAPID_PRIVATE_KEY");
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

module.exports = {
  config,
  validateStorageConfig,
  validateNotificationConfig
};
