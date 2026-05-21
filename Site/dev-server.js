const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const { loadEnv } = require("../shared/load-env");

const rootDir = path.resolve(__dirname, "..");
const siteDir = __dirname;

loadEnv({ cwd: rootDir });

const port = Number(process.env.SITE_PORT || 4173);

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", "http://localhost");

  if (url.pathname === "/config.js") {
    response.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
    response.end("window.HAPPY_NATION_CONFIG = " + JSON.stringify(getRuntimeConfig(), null, 2) + ";\n");
    return;
  }

  const filename = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const filePath = path.join(siteDir, filename);

  if (!filePath.startsWith(siteDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Arquivo nao encontrado.");
    return;
  }

  response.writeHead(200, { "content-type": contentTypeFor(filename) });
  response.end(fs.readFileSync(filePath));
});

server.listen(port, () => {
  console.log("Site ativo em http://localhost:" + port);
});

function getRuntimeConfig() {
  return {
    siteName: process.env.SITE_API_NAME || "Happy Nation Climate Center",
    supabaseUrl: process.env.SITE_SUPABASE_URL || "",
    supabaseAnonKey: process.env.SITE_SUPABASE_ANON_KEY || "",
    reportKey: process.env.SITE_REPORT_KEY || process.env.REPORT_KEY || "brazil-latest"
  };
}

function contentTypeFor(filename) {
  if (filename.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }

  if (filename.endsWith(".js")) {
    return "application/javascript; charset=utf-8";
  }

  return "text/html; charset=utf-8";
}
