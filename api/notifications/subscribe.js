const { sendJson, readJson } = require("../_lib/http");
const { config, validateStorageConfig } = require("../../Servidor/src/config");
const { createNotificationStore } = require("../../Servidor/src/notification-store");

module.exports = async (request, response) => {
  if (request.method !== "POST") {
    response.setHeader("allow", "POST");
    return sendJson(response, 405, {
      ok: false,
      error: "Metodo nao permitido."
    });
  }

  try {
    const validation = validateStorageConfig();
    if (!validation.ok) {
      return sendJson(response, 500, {
        ok: false,
        error: "Configuracao da Supabase ausente no ambiente do servidor."
      });
    }

    const body = await readJson(request);
    const payload = normalizePayload(body, request.headers["user-agent"]);
    const store = createNotificationStore({
      supabaseUrl: config.supabaseUrl,
      serviceRoleKey: config.supabaseServiceRoleKey,
      subscriptionsTable: config.notificationSubscriptionsTable,
      deliveriesTable: config.notificationDeliveriesTable
    });

    const stored = await store.replaceSubscription(payload);

    return sendJson(response, 200, {
      ok: true,
      deviceId: stored.device_id || payload.deviceId,
      minLevel: stored.min_level || payload.minLevel
    });
  } catch (error) {
    const statusCode = error && error.statusCode ? error.statusCode : 400;
    return sendJson(response, statusCode, {
      ok: false,
      error: error && error.message ? error.message : "Falha ao registrar a assinatura anonima."
    });
  }
};

function normalizePayload(body, userAgent) {
  const deviceId = body && body.deviceId ? String(body.deviceId).trim() : "";
  const subscription = body && body.subscription ? body.subscription : null;
  const endpoint = subscription && subscription.endpoint ? String(subscription.endpoint).trim() : "";
  const lat = Number(body && body.lat);
  const lng = Number(body && body.lng);
  const minLevel = body && body.minLevel === "lar"
    ? "lar"
    : body && body.minLevel === "verm"
      ? "verm"
      : "ama";

  if (!deviceId) {
    const error = new Error("deviceId obrigatorio.");
    error.statusCode = 400;
    throw error;
  }

  if (!endpoint || !subscription || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
    const error = new Error("Assinatura push invalida.");
    error.statusCode = 400;
    throw error;
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const error = new Error("Latitude e longitude validas sao obrigatorias.");
    error.statusCode = 400;
    throw error;
  }

  return {
    deviceId,
    subscription,
    lat,
    lng,
    minLevel,
    userAgent: userAgent ? String(userAgent) : ""
  };
}
