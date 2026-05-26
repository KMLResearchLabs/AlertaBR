const DEFAULT_JSON_LIMIT_BYTES = 32 * 1024;

async function readJson(request, options = {}) {
  const limitBytes = Number(options.limitBytes) || DEFAULT_JSON_LIMIT_BYTES;

  if (request.body && typeof request.body === "object") {
    return request.body;
  }

  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > limitBytes) {
      const error = new Error("JSON_BODY_TOO_LARGE");
      error.statusCode = 413;
      throw error;
    }

    chunks.push(buffer);
  }

  if (!chunks.length) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (_error) {
    const error = new Error("INVALID_JSON");
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.end(JSON.stringify(payload));
}

module.exports = {
  readJson,
  sendJson
};
