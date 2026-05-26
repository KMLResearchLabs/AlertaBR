const buckets = new Map();

function checkRateLimit(request, options = {}) {
  const key = buildClientKey(request);
  const now = Date.now();
  const windowMs = Number(options.windowMs) || 60 * 1000;
  const maxRequests = Number(options.maxRequests) || 20;
  const current = buckets.get(key);

  pruneBuckets(now, windowMs);

  if (!current || current.resetAt <= now) {
    buckets.set(key, {
      count: 1,
      resetAt: now + windowMs
    });
    return;
  }

  current.count += 1;

  if (current.count > maxRequests) {
    const error = new Error("RATE_LIMITED");
    error.statusCode = 429;
    throw error;
  }
}

function buildClientKey(request) {
  const headers = request && request.headers ? request.headers : {};
  const forwardedFor = getHeader(headers, "x-forwarded-for");
  const realIp = getHeader(headers, "x-real-ip");
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : realIp;
  return ip || "unknown";
}

function getHeader(headers, name) {
  if (!headers) {
    return "";
  }

  if (typeof headers.get === "function") {
    return headers.get(name) || "";
  }

  return headers[name] || headers[name.toLowerCase()] || "";
}

function pruneBuckets(now, windowMs) {
  if (buckets.size < 1000) {
    return;
  }

  for (const [key, bucket] of buckets) {
    if (!bucket || bucket.resetAt <= now - windowMs) {
      buckets.delete(key);
    }
  }
}

module.exports = {
  checkRateLimit
};
