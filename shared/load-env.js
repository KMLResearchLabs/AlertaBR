const fs = require("node:fs");
const path = require("node:path");

function loadEnv(options = {}) {
  const cwd = options.cwd || process.cwd();
  const filenames = Array.isArray(options.files) && options.files.length
    ? options.files
    : [".env", ".env.local"];

  for (const filename of filenames) {
    const filePath = path.resolve(cwd, filename);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const content = fs.readFileSync(filePath, "utf8");
    applyEnvFile(content);
  }
}

function applyEnvFile(content) {
  const lines = String(content || "").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = stripQuotes(value);
  }
}

function stripQuotes(value) {
  if (!value) {
    return "";
  }

  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

module.exports = {
  loadEnv
};
