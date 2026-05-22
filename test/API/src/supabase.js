const crypto = require("node:crypto");

const { config, validateApiConfig } = require("./config");

async function findApiKey(apiKey) {
  const validation = validateApiConfig();
  if (!validation.ok) {
    throw new Error("Configure a Supabase da API antes de validar chaves: " + validation.missing.join(", "));
  }

  if (!apiKey) {
    return null;
  }

  const url = new URL(config.supabaseUrl + "/rest/v1/" + config.apiKeysTable);
  url.searchParams.set("select", "id,name,scopes,is_active,expires_at,last_used_at,revoked_at");
  url.searchParams.set("key_hash", "eq." + hashApiKey(apiKey));
  url.searchParams.set("is_active", "eq.true");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: buildSupabaseHeaders(config.supabaseServiceRoleKey)
  });

  if (!response.ok) {
    const detail = await safeText(response);
    throw new Error("Falha ao consultar API key na Supabase: " + response.status + " " + detail);
  }

  const payload = await response.json();
  const record = Array.isArray(payload) && payload[0] ? payload[0] : null;
  if (!record) {
    return null;
  }

  if (record.revoked_at) {
    return null;
  }

  if (record.expires_at && Date.parse(record.expires_at) <= Date.now()) {
    return null;
  }

  return {
    id: record.id,
    name: record.name || "API key",
    scopes: normalizeScopes(record.scopes),
    expiresAt: record.expires_at || null,
    lastUsedAt: record.last_used_at || null
  };
}

async function touchApiKeyUsage(apiKeyId, requestMeta = {}) {
  const validation = validateApiConfig();
  if (!validation.ok || !apiKeyId) {
    return;
  }

  const url = new URL(config.supabaseUrl + "/rest/v1/" + config.apiKeysTable);
  url.searchParams.set("id", "eq." + apiKeyId);

  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: buildSupabaseHeaders(config.supabaseServiceRoleKey, {
      Prefer: "return=minimal"
    }),
    body: JSON.stringify({
      last_used_at: new Date().toISOString(),
      last_used_ip: requestMeta.ip || null,
      last_user_agent: requestMeta.userAgent || null
    })
  });

  if (!response.ok) {
    const detail = await safeText(response);
    throw new Error("Falha ao atualizar uso da API key: " + response.status + " " + detail);
  }
}

async function fetchLatestReport() {
  const validation = validateApiConfig();
  if (!validation.ok) {
    throw new Error("Configure a Supabase da API antes de consultar o relatório: " + validation.missing.join(", "));
  }

  const url = new URL(config.supabaseUrl + "/rest/v1/climate_reports");
  url.searchParams.set("select", "report_key,generated_at,report,alert_count,news_count,updated_at,is_public");
  url.searchParams.set("report_key", "eq." + config.reportKey);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: buildSupabaseHeaders(config.supabaseServiceRoleKey)
  });

  if (!response.ok) {
    const detail = await safeText(response);
    throw new Error("Falha ao ler relatório salvo na Supabase: " + response.status + " " + detail);
  }

  const payload = await response.json();
  return Array.isArray(payload) && payload[0] ? payload[0] : null;
}

function hashApiKey(apiKey) {
  return crypto.createHash("sha256").update(String(apiKey)).digest("hex");
}

function normalizeScopes(scopes) {
  if (Array.isArray(scopes)) {
    return scopes.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof scopes === "string") {
    return scopes.split(",").map((item) => item.trim()).filter(Boolean);
  }

  return [];
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
  fetchLatestReport,
  findApiKey,
  touchApiKeyUsage
};
