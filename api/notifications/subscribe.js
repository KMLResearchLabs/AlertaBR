const { sendJson, readJson } = require("../_lib/http");
const { checkRateLimit } = require("../_lib/rate-limit");
const { config, validateStorageConfig } = require("../../Servidor/src/config");
const { createNotificationStore } = require("../../Servidor/src/notification-store");

const SUBSCRIBE_BODY_LIMIT_BYTES = 16 * 1024;
const MAX_DEVICE_ID_LENGTH = 128;
const MAX_ENDPOINT_LENGTH = 2048;
const MAX_P256DH_LENGTH = 256;
const MAX_AUTH_LENGTH = 128;
const MAX_USER_AGENT_LENGTH = 300;

module.exports = async (request, response) => {
  if (request.method !== "POST") {
    response.setHeader("allow", "POST");
    return sendJson(response, 405, {
      ok: false,
      error: "Metodo nao permitido."
    });
  }

  try {
    checkRateLimit(request, {
      windowMs: 60 * 1000,
      maxRequests: 10
    });

    const validation = validateStorageConfig();
    if (!validation.ok) {
      console.error("Configuracao de armazenamento ausente para notificacoes", {
        missing: validation.missing
      });
      return sendJson(response, 500, {
        ok: false,
        error: "Servico temporariamente indisponivel."
      });
    }

    const body = await readJson(request, {
      limitBytes: SUBSCRIBE_BODY_LIMIT_BYTES
    });
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
    console.error("Falha ao registrar assinatura push", {
      statusCode: error && error.statusCode ? error.statusCode : 400,
      message: error && error.message ? error.message : String(error)
    });

    const statusCode = error && error.statusCode ? error.statusCode : 400;
    return sendJson(response, statusCode, {
      ok: false,
      error: publicSubscribeError(statusCode)
    });
  }
};

function normalizePayload(body, userAgent) {
  const deviceId = body && body.deviceId ? String(body.deviceId).trim() : "";
  const subscription = body && body.subscription ? body.subscription : null;
  const endpoint = subscription && subscription.endpoint ? String(subscription.endpoint).trim() : "";
  const lat = Number(body && body.lat);
  const lng = Number(body && body.lng);
  const p256dh = subscription && subscription.keys ? String(subscription.keys.p256dh || "").trim() : "";
  const auth = subscription && subscription.keys ? String(subscription.keys.auth || "").trim() : "";
  const minLevel = body && body.minLevel === "lar"
    ? "lar"
    : body && body.minLevel === "verm"
      ? "verm"
      : "ama";

  if (!deviceId || deviceId.length > MAX_DEVICE_ID_LENGTH) {
    const error = new Error("deviceId obrigatorio.");
    error.statusCode = 400;
    throw error;
  }

  if (!isValidEndpoint(endpoint) || !p256dh || p256dh.length > MAX_P256DH_LENGTH || !auth || auth.length > MAX_AUTH_LENGTH) {
    const error = new Error("Assinatura push invalida.");
    error.statusCode = 400;
    throw error;
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    const error = new Error("Latitude e longitude validas sao obrigatorias.");
    error.statusCode = 400;
    throw error;
  }

  return {
    deviceId,
    subscription: {
      endpoint,
      expirationTime: subscription.expirationTime || null,
      keys: {
        p256dh,
        auth
      }
    },
    lat: roundCoordinate(lat),
    lng: roundCoordinate(lng),
    minLevel,
    userAgent: userAgent ? String(userAgent).slice(0, MAX_USER_AGENT_LENGTH) : ""
  };
}

function isValidEndpoint(value) {
  if (!value || value.length > MAX_ENDPOINT_LENGTH) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function roundCoordinate(value) {
  return Math.round(Number(value) * 100) / 100;
}

function publicSubscribeError(statusCode) {
  if (statusCode === 413) {
    return "Requisicao muito grande.";
  }

  if (statusCode === 429) {
    return "Muitas tentativas. Tente novamente em alguns instantes.";
  }

  if (statusCode >= 500) {
    return "Servico temporariamente indisponivel.";
  }

  return "Nao foi possivel ativar as notificacoes.";
}
