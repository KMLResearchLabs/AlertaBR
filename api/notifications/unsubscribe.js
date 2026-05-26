const { sendJson, readJson } = require("../_lib/http");
const { checkRateLimit } = require("../_lib/rate-limit");
const { config, validateStorageConfig } = require("../../Servidor/src/config");
const { createNotificationStore } = require("../../Servidor/src/notification-store");

const UNSUBSCRIBE_BODY_LIMIT_BYTES = 4 * 1024;
const MAX_DEVICE_ID_LENGTH = 128;
const MAX_ENDPOINT_LENGTH = 2048;

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
      maxRequests: 20
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
      limitBytes: UNSUBSCRIBE_BODY_LIMIT_BYTES
    });
    const deviceId = body && body.deviceId ? String(body.deviceId).trim() : "";
    const endpoint = body && body.endpoint ? String(body.endpoint).trim() : "";

    if ((!deviceId && !endpoint) || deviceId.length > MAX_DEVICE_ID_LENGTH || endpoint.length > MAX_ENDPOINT_LENGTH) {
      return sendJson(response, 400, {
        ok: false,
        error: "Pedido invalido."
      });
    }

    const store = createNotificationStore({
      supabaseUrl: config.supabaseUrl,
      serviceRoleKey: config.supabaseServiceRoleKey,
      subscriptionsTable: config.notificationSubscriptionsTable,
      deliveriesTable: config.notificationDeliveriesTable
    });

    const revoked = await store.revokeSubscriptions({
      deviceId,
      endpoint
    });

    return sendJson(response, 200, {
      ok: true,
      revoked
    });
  } catch (error) {
    console.error("Falha ao remover assinatura push", {
      statusCode: error && error.statusCode ? error.statusCode : 400,
      message: error && error.message ? error.message : String(error)
    });

    const statusCode = error && error.statusCode ? error.statusCode : 400;
    return sendJson(response, statusCode, {
      ok: false,
      error: publicUnsubscribeError(statusCode)
    });
  }
};

function publicUnsubscribeError(statusCode) {
  if (statusCode === 413) {
    return "Requisicao muito grande.";
  }

  if (statusCode === 429) {
    return "Muitas tentativas. Tente novamente em alguns instantes.";
  }

  if (statusCode >= 500) {
    return "Servico temporariamente indisponivel.";
  }

  return "Nao foi possivel desativar as notificacoes.";
}
