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
    const deviceId = body && body.deviceId ? String(body.deviceId).trim() : "";
    const endpoint = body && body.endpoint ? String(body.endpoint).trim() : "";

    if (!deviceId && !endpoint) {
      return sendJson(response, 400, {
        ok: false,
        error: "deviceId ou endpoint obrigatorio."
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
    return sendJson(response, 400, {
      ok: false,
      error: error && error.message ? error.message : "Falha ao remover a assinatura anonima."
    });
  }
};
