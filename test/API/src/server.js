const cors = require("cors");
const express = require("express");

const { generateAndStoreReport } = require("../../Servidor/src/pipeline");
const { config, validateApiConfig } = require("./config");
const { fetchLatestReport, findApiKey, touchApiKeyUsage } = require("./supabase");

const app = express();

app.set("trust proxy", true);
app.use(express.json({ limit: "1mb" }));
app.use(buildCorsMiddleware());

app.get("/health", (_request, response) => {
  const validation = validateApiConfig();

  response.status(200).json({
    ok: true,
    service: config.serviceName,
    time: new Date().toISOString(),
    storage: {
      ok: validation.ok,
      missing: validation.ok ? [] : validation.missing
    }
  });
});

app.get("/v1/auth/check", requireApiKey(), (request, response) => {
  response.status(200).json({
    ok: true,
    key: sanitizeApiKeyRecord(request.apiKeyRecord)
  });
});

app.get("/v1/report/latest", requireApiKey("climate_reports:read"), async (_request, response, next) => {
  try {
    const stored = await fetchLatestReport();

    response.status(200).json({
      ok: true,
      time: new Date().toISOString(),
      stored
    });
  } catch (error) {
    next(error);
  }
});

app.post("/v1/report/preview", requireApiKey("climate_reports:preview"), async (_request, response, next) => {
  try {
    const result = await generateAndStoreReport({ store: false });

    response.status(200).json({
      ok: true,
      mode: "preview",
      generatedAt: result.report.generatedAt,
      report: result.report
    });
  } catch (error) {
    next(error);
  }
});

app.post("/v1/report/refresh", requireApiKey("climate_reports:write"), async (_request, response, next) => {
  try {
    const result = await generateAndStoreReport();

    response.status(200).json({
      ok: true,
      mode: "store",
      generatedAt: result.report.generatedAt,
      stored: result.stored
    });
  } catch (error) {
    next(error);
  }
});

app.use((request, response) => {
  response.status(404).json({
    ok: false,
    error: "Rota não encontrada."
  });
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({
    ok: false,
    error: "Falha interna da API.",
    time: new Date().toISOString()
  });
});

app.listen(config.port, () => {
  console.log("API ativa em http://localhost:" + config.port);
});

function buildCorsMiddleware() {
  if (!config.corsOrigins.length) {
    return cors({ origin: false });
  }

  return cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origem não permitida por CORS."));
    }
  });
}

function requireApiKey(requiredScope) {
  return async (request, response, next) => {
    try {
      const rawApiKey = extractApiKey(request);
      if (!rawApiKey) {
        response.status(401).json({
          ok: false,
          error: "API key ausente."
        });
        return;
      }

      const record = await findApiKey(rawApiKey);
      if (!record) {
        response.status(401).json({
          ok: false,
          error: "API key inválida ou expirada."
        });
        return;
      }

      if (requiredScope && record.scopes.length > 0 && !record.scopes.includes(requiredScope)) {
        response.status(403).json({
          ok: false,
          error: "API key sem permissão para este endpoint.",
          requiredScope
        });
        return;
      }

      request.apiKeyRecord = record;
      await touchApiKeyUsage(record.id, {
        ip: resolveClientIp(request),
        userAgent: request.get("user-agent") || ""
      });

      next();
    } catch (error) {
      next(error);
    }
  };
}

function extractApiKey(request) {
  const directHeader = request.get(config.apiKeyHeaderName);
  if (directHeader) {
    return String(directHeader).trim();
  }

  const authorization = request.get("authorization") || "";
  if (authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return "";
}

function resolveClientIp(request) {
  const forwarded = request.get("x-forwarded-for");
  if (forwarded) {
    return String(forwarded).split(",")[0].trim();
  }

  return request.ip || request.socket?.remoteAddress || "";
}

function sanitizeApiKeyRecord(record) {
  return {
    id: record.id,
    name: record.name,
    scopes: record.scopes,
    expiresAt: record.expiresAt,
    lastUsedAt: record.lastUsedAt
  };
}
