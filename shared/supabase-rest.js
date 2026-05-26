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
  buildSupabaseHeaders,
  safeText
};
