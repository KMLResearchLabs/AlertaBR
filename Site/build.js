const fs = require("node:fs");
const path = require("node:path");

const { loadEnv } = require("../shared/load-env");

const rootDir = path.resolve(__dirname, "..");
const siteDir = __dirname;
const distDir = path.join(siteDir, "dist");
const imagesDir = path.join(rootDir, "images");

loadEnv({ cwd: rootDir });

build();

function build() {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  copy("index.html");
  copy("style.css");
  copy("app.js");
  copy("notification-worker.js");
  copy("speed-insights.js");
  copy("analytics.js");
  copyImages();

  fs.writeFileSync(
    path.join(distDir, "config.js"),
    "window.HAPPY_NATION_CONFIG = " + JSON.stringify(getRuntimeConfig(), null, 2) + ";\n"
  );

  console.log("Site pronto em " + distDir);
}

function copy(filename) {
  fs.copyFileSync(path.join(siteDir, filename), path.join(distDir, filename));
}

function copyImages() {
  if (!fs.existsSync(imagesDir)) {
    return;
  }

  fs.cpSync(imagesDir, path.join(distDir, "images"), { recursive: true });
}

function getRuntimeConfig() {
  return {
    siteName: process.env.SITE_API_NAME || "Happy Nation Climate Center",
    supabaseUrl: process.env.SITE_SUPABASE_URL || "",
    supabaseAnonKey: process.env.SITE_SUPABASE_ANON_KEY || "",
    reportKey: process.env.SITE_REPORT_KEY || process.env.REPORT_KEY || "brazil-latest",
    pushPublicKey: process.env.SITE_PUSH_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || "",
    apiBaseUrl: process.env.SITE_API_BASE_URL || ""
  };
}
