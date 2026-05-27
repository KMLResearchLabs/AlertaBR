const webpush = require("web-push");

const { config, validateNotificationConfig } = require("./config");
const { pointInBbox, pointInGeometry } = require("./lib/geo");
const { createNotificationStore, buildDeliveryKey } = require("./notification-store");
const { getDashboardData } = require("./providers/inmet");

const DELIVERY_REASON = "region-match";

async function sendRegionNotifications(options = {}) {
  const validation = validateNotificationConfig();
  if (!validation.ok) {
    throw new Error("Configura as notificações antes de enviar push: " + validation.missing.join(", "));
  }

  const forceSend = options.forceSend === true || process.env.NOTIFICATION_FORCE_SEND === "true";

  const store = createNotificationStore({
    supabaseUrl: config.supabaseUrl,
    serviceRoleKey: config.supabaseServiceRoleKey,
    subscriptionsTable: config.notificationSubscriptionsTable,
    deliveriesTable: config.notificationDeliveriesTable
  });

  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);

  const dashboard = options.dashboard || await getDashboardData({ limit: config.alertLimit });
  const alerts = Array.isArray(dashboard && dashboard.alerts)
    ? dashboard.alerts.filter(isPushEligibleAlert)
    : [];

  if (!alerts.length) {
    return {
      ok: true,
      alertsConsidered: 0,
      subscriptionsConsidered: 0,
      matched: 0,
      sent: 0,
      duplicates: 0,
      revoked: 0,
      failed: 0
    };
  }

  const subscriptions = await store.fetchActiveSubscriptions();
  if (!subscriptions.length) {
    return {
      ok: true,
      alertsConsidered: alerts.length,
      subscriptionsConsidered: 0,
      matched: 0,
      sent: 0,
      duplicates: 0,
      revoked: 0,
      failed: 0
    };
  }

  const existingDeliveries = await store.fetchDeliveryKeysForAlertIds(alerts.map((alert) => alert.id));
  const summary = {
    ok: true,
    alertsConsidered: alerts.length,
    subscriptionsConsidered: subscriptions.length,
    matched: 0,
    sent: 0,
    duplicates: 0,
    revoked: 0,
    failed: 0
  };

  for (const subscription of subscriptions) {
    for (const alert of alerts) {
      if (!matchesSubscription(alert, subscription)) {
        continue;
      }

      const deliveryKey = buildDeliveryKey(subscription.device_id, alert.id, DELIVERY_REASON);
      const knownDelivery = existingDeliveries.has(deliveryKey);
      if (knownDelivery && !forceSend) {
        summary.duplicates += 1;
        continue;
      }

      summary.matched += 1;

      const payload = buildPushPayload(alert);

      try {
        await webpush.sendNotification(subscription.subscription, JSON.stringify(payload), {
          TTL: 300,
          urgency: urgencyForLevel(alert.level),
          topic: "alertabr-" + String(alert.id)
        });

        const inserted = await store.recordDelivery({
          deviceId: subscription.device_id,
          endpoint: subscription.endpoint,
          alertId: alert.id,
          alertLevel: alert.level,
          reason: DELIVERY_REASON,
          payload
        });

        if (inserted || forceSend) {
          existingDeliveries.add(deliveryKey);
          summary.sent += 1;
        } else {
          summary.duplicates += 1;
        }
      } catch (error) {
        if (isExpiredSubscriptionError(error)) {
          await store.revokeSubscriptionByEndpoint(subscription.endpoint);
          summary.revoked += 1;
          continue;
        }

        summary.failed += 1;
        console.error("Falha ao enviar push regional", {
          alertId: alert.id,
          endpoint: subscription.endpoint,
          error: error && error.message ? error.message : String(error)
        });
      }
    }
  }

  return summary;
}

function isPushEligibleAlert(alert) {
  return Boolean(
    alert &&
    alert.id &&
    (alert.phase === "ongoing" || alert.phase === "upcoming") &&
    alert.level &&
    alert.area &&
    alert.area.geometry
  );
}

function matchesSubscription(alert, subscription) {
  if (!alert || !subscription) {
    return false;
  }

  if (levelRank(alert.level) < levelRank(subscription.min_level)) {
    return false;
  }

  const lat = Number(subscription.lat);
  const lng = Number(subscription.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }

  if (Array.isArray(alert.area && alert.area.bbox) && alert.area.bbox.length === 4 && !pointInBbox(lng, lat, alert.area.bbox)) {
    return false;
  }

  return pointInGeometry(alert.area && alert.area.geometry, lat, lng);
}

function levelRank(level) {
  if (level === "verm") {
    return 3;
  }

  if (level === "lar") {
    return 2;
  }

  return 1;
}

function urgencyForLevel(level) {
  if (level === "verm") {
    return "high";
  }

  if (level === "lar") {
    return "normal";
  }

  return "low";
}

function buildPushPayload(alert) {
  const states = Array.isArray(alert.area && alert.area.states) && alert.area.states.length
    ? alert.area.states.join(", ")
    : "sua região";
  const timing = buildTimingCopy(alert);

  return {
    title: buildPayloadTitle(alert.level),
    body: (alert.event || alert.headline || "Novo alerta") + " em " + states + ". " + timing,
    tag: "alertabr-" + String(alert.id),
    url: "/?alert=" + encodeURIComponent(alert.id) + "#home",
    alertId: alert.id
  };
}

function buildPayloadTitle(level) {
  if (level === "verm") {
    return "Perigo extremo na sua região";
  }

  if (level === "lar") {
    return "Alerta laranja na sua região";
  }

  return "Alerta climático na sua região";
}

function buildTimingCopy(alert) {
  if (!alert) {
    return "Confira o aviso oficial no AlertaBR.";
  }

  if (alert.phase === "upcoming" && alert.onset) {
    return "Começa em " + formatNotificationDate(alert.onset) + ".";
  }

  if (alert.expires) {
    return "Válido até " + formatNotificationDate(alert.expires) + ".";
  }

  return "Confira o aviso oficial no AlertaBR.";
}

function formatNotificationDate(value) {
  if (!value) {
    return "horário não informado";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "horário não informado";
  }

  return parsed.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function isExpiredSubscriptionError(error) {
  return Boolean(error && (error.statusCode === 404 || error.statusCode === 410));
}

module.exports = {
  sendRegionNotifications
};
