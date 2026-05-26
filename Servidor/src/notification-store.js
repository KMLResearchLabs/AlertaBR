const { buildSupabaseHeaders, safeText } = require("../../shared/supabase-rest");

function createNotificationStore(options) {
  const supabaseUrl = String(options && options.supabaseUrl ? options.supabaseUrl : "").replace(/\/+$/, "");
  const serviceRoleKey = options && options.serviceRoleKey ? options.serviceRoleKey : "";
  const subscriptionsTable = options && options.subscriptionsTable ? options.subscriptionsTable : "notification_subscriptions";
  const deliveriesTable = options && options.deliveriesTable ? options.deliveriesTable : "notification_deliveries";

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("As credenciais da Supabase são obrigatórias para usar o store de notificações.");
  }

  return {
    replaceSubscription,
    fetchActiveSubscriptions,
    fetchDeliveryKeysForAlertIds,
    recordDelivery,
    revokeSubscriptionByEndpoint,
    revokeSubscriptions
  };

  async function replaceSubscription(input) {
    const now = new Date().toISOString();
    const subscription = input && input.subscription ? input.subscription : null;
    const endpoint = subscription && subscription.endpoint ? String(subscription.endpoint) : "";
    const deviceId = input && input.deviceId ? String(input.deviceId) : "";
    const lat = Number(input && input.lat);
    const lng = Number(input && input.lng);
    const minLevel = normalizeLevel(input && input.minLevel);

    if (!subscription || !endpoint || !deviceId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error("Assinatura inválida para armazenamento.");
    }

    await revokeSubscriptions({
      deviceId,
      exceptEndpoint: endpoint
    });

    const row = {
      device_id: deviceId,
      endpoint,
      subscription,
      lat,
      lng,
      min_level: minLevel,
      user_agent: input && input.userAgent ? String(input.userAgent) : null,
      updated_at: now,
      last_seen_at: now,
      revoked_at: null
    };

    const url = buildTableUrl(subscriptionsTable);
    url.searchParams.set("on_conflict", "endpoint");

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: buildSupabaseHeaders(serviceRoleKey, {
        Prefer: "resolution=merge-duplicates,return=representation"
      }),
      body: JSON.stringify([row])
    });

    if (!response.ok) {
      const detail = await safeText(response);
      throw new Error("Falha ao gravar a assinatura anônima: " + response.status + " " + detail);
    }

    const payload = await response.json();
    return Array.isArray(payload) && payload[0] ? payload[0] : row;
  }

  async function fetchActiveSubscriptions() {
    const url = buildTableUrl(subscriptionsTable);
    url.searchParams.set("select", "device_id,endpoint,subscription,lat,lng,min_level");
    url.searchParams.set("revoked_at", "is.null");
    url.searchParams.set("order", "updated_at.desc");

    const response = await fetch(url.toString(), {
      headers: buildSupabaseHeaders(serviceRoleKey)
    });

    if (!response.ok) {
      const detail = await safeText(response);
      throw new Error("Falha ao carregar assinaturas ativas: " + response.status + " " + detail);
    }

    const rows = await response.json();
    return Array.isArray(rows) ? rows : [];
  }

  async function fetchDeliveryKeysForAlertIds(alertIds) {
    if (!Array.isArray(alertIds) || !alertIds.length) {
      return new Set();
    }

    const sanitizedIds = alertIds
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    if (!sanitizedIds.length) {
      return new Set();
    }

    const url = buildTableUrl(deliveriesTable);
    url.searchParams.set("select", "device_id,alert_id,reason");
    url.searchParams.set("alert_id", "in.(" + sanitizedIds.map(escapeFilterToken).join(",") + ")");

    const response = await fetch(url.toString(), {
      headers: buildSupabaseHeaders(serviceRoleKey)
    });

    if (!response.ok) {
      const detail = await safeText(response);
      throw new Error("Falha ao consultar entregas anteriores: " + response.status + " " + detail);
    }

    const rows = await response.json();
    const keys = new Set();

    if (!Array.isArray(rows)) {
      return keys;
    }

    rows.forEach((row) => {
      keys.add(buildDeliveryKey(row.device_id, row.alert_id, row.reason));
    });

    return keys;
  }

  async function recordDelivery(entry) {
    const row = {
      device_id: String(entry.deviceId),
      endpoint: entry.endpoint ? String(entry.endpoint) : null,
      alert_id: String(entry.alertId),
      alert_level: normalizeLevel(entry.alertLevel),
      reason: entry.reason ? String(entry.reason) : "region-match",
      payload: entry.payload || {},
      sent_at: new Date().toISOString()
    };

    const url = buildTableUrl(deliveriesTable);
    url.searchParams.set("on_conflict", "device_id,alert_id,reason");

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: buildSupabaseHeaders(serviceRoleKey, {
        Prefer: "resolution=ignore-duplicates,return=representation"
      }),
      body: JSON.stringify([row])
    });

    if (!response.ok) {
      const detail = await safeText(response);
      throw new Error("Falha ao registrar entrega: " + response.status + " " + detail);
    }

    const payload = await response.json();
    return Array.isArray(payload) && payload.length > 0;
  }

  async function revokeSubscriptionByEndpoint(endpoint) {
    return revokeSubscriptions({ endpoint });
  }

  async function revokeSubscriptions(filters) {
    const now = new Date().toISOString();
    const url = buildTableUrl(subscriptionsTable);
    let hasFilter = false;

    if (filters && filters.deviceId) {
      url.searchParams.set("device_id", "eq." + String(filters.deviceId));
      hasFilter = true;
    }

    if (filters && filters.endpoint) {
      url.searchParams.set("endpoint", "eq." + String(filters.endpoint));
      hasFilter = true;
    }

    if (filters && filters.exceptEndpoint) {
      url.searchParams.set("endpoint", "neq." + String(filters.exceptEndpoint));
      hasFilter = true;
    }

    url.searchParams.set("revoked_at", "is.null");

    if (!hasFilter) {
      return 0;
    }

    const response = await fetch(url.toString(), {
      method: "PATCH",
      headers: buildSupabaseHeaders(serviceRoleKey, {
        Prefer: "return=representation"
      }),
      body: JSON.stringify({
        revoked_at: now,
        updated_at: now
      })
    });

    if (!response.ok) {
      const detail = await safeText(response);
      throw new Error("Falha ao revogar assinatura: " + response.status + " " + detail);
    }

    const payload = await response.json();
    return Array.isArray(payload) ? payload.length : 0;
  }

  function buildTableUrl(tableName) {
    return new URL(supabaseUrl + "/rest/v1/" + tableName);
  }
}

function normalizeLevel(value) {
  return value === "lar" || value === "verm" ? value : "ama";
}

function buildDeliveryKey(deviceId, alertId, reason) {
  return [String(deviceId || ""), String(alertId || ""), String(reason || "")].join("::");
}

function escapeFilterToken(value) {
  return "\"" + String(value || "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"";
}

module.exports = {
  buildDeliveryKey,
  createNotificationStore
};
