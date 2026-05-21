const { config, validateStorageConfig } = require("./config");

async function upsertLatestReport(report) {
  const validation = validateStorageConfig();
  if (!validation.ok) {
    throw new Error("Configura a Supabase antes de armazenar o relatorio: " + validation.missing.join(", "));
  }

  const row = {
    report_key: config.reportKey,
    generated_at: report.generatedAt,
    report,
    is_public: true,
    alert_count: Array.isArray(report.alerts) ? report.alerts.length : 0,
    news_count: Array.isArray(report.news) ? report.news.length : 0
  };

  const url = new URL(config.supabaseUrl + "/rest/v1/climate_reports");
  url.searchParams.set("on_conflict", "report_key");

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: buildSupabaseHeaders(config.supabaseServiceRoleKey, {
      Prefer: "resolution=merge-duplicates,return=representation"
    }),
    body: JSON.stringify([row])
  });

  if (!response.ok) {
    const detail = await safeText(response);
    throw new Error("Falha ao gravar relatorio na Supabase: " + response.status + " " + detail);
  }

  const payload = await response.json();
  return Array.isArray(payload) && payload[0] ? payload[0] : row;
}

async function fetchLatestStoredReport() {
  const validation = validateStorageConfig();
  if (!validation.ok) {
    throw new Error("Configura a Supabase antes de consultar o relatorio: " + validation.missing.join(", "));
  }

  const url = new URL(config.supabaseUrl + "/rest/v1/climate_reports");
  url.searchParams.set("select", "report_key,generated_at,report,alert_count,news_count,updated_at");
  url.searchParams.set("report_key", "eq." + config.reportKey);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: buildSupabaseHeaders(config.supabaseServiceRoleKey)
  });

  if (!response.ok) {
    const detail = await safeText(response);
    throw new Error("Falha ao ler relatorio salvo na Supabase: " + response.status + " " + detail);
  }

  const payload = await response.json();
  return Array.isArray(payload) && payload[0] ? payload[0] : null;
}

function buildSupabaseHeaders(token, extraHeaders = {}) {
  return {
    apikey: token,
    authorization: "Bearer " + token,
    "content-type": "application/json",
    accept: "application/json",
    ...extraHeaders
  };
}

async function safeText(response) {
  try {
    return await response.text();
  } catch (_error) {
    return "";
  }
}

module.exports = {
  upsertLatestReport,
  fetchLatestStoredReport
};
