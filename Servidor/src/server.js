const crypto = require("node:crypto");
const http = require("node:http");

const { config, validateStorageConfig } = require("./config");
const { generateAndStoreReport } = require("./pipeline");
const { fetchLatestStoredReport } = require("./supabase");

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://localhost");

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      const storageValidation = validateStorageConfig();
      return sendJson(response, 200, {
        ok: true,
        service: "happy-nation-servidor",
        time: new Date().toISOString(),
        storage: {
          ok: storageValidation.ok
        }
      });
    }

    if (request.method === "GET" && url.pathname === "/api/report") {
      if (!isAuthorized(request)) {
        return sendUnauthorized(response);
      }

      const stored = await fetchLatestStoredReport();
      return sendJson(response, 200, {
        ok: true,
        time: new Date().toISOString(),
        stored
      });
    }

    if (request.method === "POST" && url.pathname === "/api/preview") {
      if (!isAuthorized(request)) {
        return sendUnauthorized(response);
      }

      const result = await generateAndStoreReport({ store: false });
      return sendJson(response, 200, {
        ok: true,
        mode: "preview",
        generatedAt: result.report.generatedAt,
        report: result.report
      });
    }

    if (request.method === "POST" && url.pathname === "/api/run") {
      if (!isAuthorized(request)) {
        return sendUnauthorized(response);
      }

      const result = await generateAndStoreReport();
      return sendJson(response, 200, {
        ok: true,
        mode: "store",
        generatedAt: result.report.generatedAt,
        stored: result.stored
      });
    }

    return sendJson(response, 404, {
      ok: false,
      error: "Rota nao encontrada."
    });
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, {
      ok: false,
      error: "Falha interna do servidor.",
      time: new Date().toISOString()
    });
  }
});

server.listen(config.port, () => {
  console.log("Servidor ativo em http://localhost:" + config.port);
});

function isAuthorized(request) {
  if (!config.manualRunSecret) {
    return false;
  }

  const headerValue = request.headers.authorization || request.headers["x-manual-run-secret"] || "";
  const bearerValue = String(headerValue).startsWith("Bearer ")
    ? String(headerValue).slice("Bearer ".length)
    : String(headerValue);

  const provided = Buffer.from(bearerValue);
  const expected = Buffer.from(config.manualRunSecret);

  if (provided.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(provided, expected);
}

function sendUnauthorized(response) {
  return sendJson(response, 401, {
    ok: false,
    error: "Nao autorizado."
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  });
  response.end(JSON.stringify(payload));
}
