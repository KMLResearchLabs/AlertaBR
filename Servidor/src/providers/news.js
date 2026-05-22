const { XMLParser } = require("fast-xml-parser");

const REQUEST_TIMEOUT_MS = 12_000;
const INMET_PORTAL_URL = "https://portal.inmet.gov.br/";
const FALLBACK_RSS_FEEDS = [
  {
    label: "Google News RSS",
    url: "https://news.google.com/rss/search?q=meteorologia+Brasil+OR+clima+Brasil&hl=pt-BR&gl=BR&ceid=BR:pt-419"
  }
];

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true
});

async function getClimateNews(options = {}) {
  const limit = clampInteger(options.limit, 6, 1, 12);
  const items = [];
  const sources = [];

  try {
    const portalItems = await fetchInmetPortalNews(limit);
    items.push(...portalItems);
    sources.push({
      id: "inmet-portal",
      label: "Portal INMET",
      status: portalItems.length ? "ok" : "empty",
      detail: portalItems.length
        ? portalItems.length + " notícia(s) extraída(s) do portal oficial."
        : "Portal acessível, mas sem notícias identificadas."
    });
  } catch (error) {
    sources.push({
      id: "inmet-portal",
      label: "Portal INMET",
      status: "error",
      detail: error.message
    });
  }

  if (items.length < limit) {
    for (const feed of FALLBACK_RSS_FEEDS) {
      try {
        const rssItems = await fetchRssFeed(feed.url, feed.label, limit);
        items.push(...rssItems);
        sources.push({
          id: slugify(feed.label),
          label: feed.label,
          status: rssItems.length ? "ok" : "empty",
          detail: rssItems.length
            ? rssItems.length + " item(ns) via RSS."
            : "RSS acessível, mas sem itens."
        });
      } catch (error) {
        sources.push({
          id: slugify(feed.label),
          label: feed.label,
          status: "error",
          detail: error.message
        });
      }
    }
  } else {
    sources.push({
      id: "rss-fallback",
      label: "RSS de fallback",
      status: "skipped",
      detail: "Dispensado porque o portal oficial já devolveu notícias suficientes."
    });
  }

  return {
    items: dedupeNews(items)
      .sort((left, right) => new Date(right.publishedAt || 0) - new Date(left.publishedAt || 0))
      .slice(0, limit),
    sources
  };
}

async function fetchInmetPortalNews(limit) {
  const html = await fetchText(INMET_PORTAL_URL, "text/html");
  const matches = [];
  const anchorPattern = /<a\b[^>]*href="([^"]*\/noticias\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(html)) !== null) {
    const href = toAbsoluteUrl(match[1], INMET_PORTAL_URL);
    const title = cleanupHtmlText(match[2]);

    if (!href || !title || title.length < 12) {
      continue;
    }

    matches.push({
      title,
      url: href,
      source: "Portal INMET",
      publishedAt: null,
      summary: "Notícia capturada do portal oficial do INMET."
    });
  }

  return dedupeNews(matches).slice(0, limit);
}

async function fetchRssFeed(url, sourceLabel, limit) {
  const xml = await fetchText(url, "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8");
  const parsed = xmlParser.parse(xml);
  const channel = parsed && parsed.rss && parsed.rss.channel;
  const rawItems = arrayify(channel && channel.item);

  return rawItems
    .map((item) => ({
      title: cleanupHtmlText(item && item.title),
      url: normalizeExternalUrl(item && (item.link || item.guid || "")),
      source: sourceLabel,
      publishedAt: item && (item.pubDate || item.published || null),
      summary: cleanupHtmlText(item && (item.description || item.content || ""))
    }))
    .filter((item) => item.title && item.url)
    .slice(0, limit);
}

async function fetchText(url, acceptHeader) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        accept: acceptHeader,
        "user-agent": "HappyNationBot/1.0 (+climate-report)"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error("Fonte indisponível: " + response.status + " em " + url);
    }

    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function dedupeNews(items) {
  const byKey = new Map();

  for (const item of items) {
    const key = item.url || item.title;
    if (!key || byKey.has(key)) {
      continue;
    }

    byKey.set(key, item);
  }

  return Array.from(byKey.values());
}

function cleanupHtmlText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function toAbsoluteUrl(value, baseUrl) {
  if (!value) {
    return "";
  }

  try {
    return normalizeExternalUrl(new URL(value, baseUrl).toString());
  } catch (_error) {
    return "";
  }
}

function normalizeExternalUrl(value) {
  if (!value) {
    return "";
  }

  try {
    const parsed = new URL(String(value));
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "";
    }

    return parsed.toString();
  } catch (_error) {
    return "";
  }
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function arrayify(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null) {
    return [];
  }

  return [value];
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

module.exports = {
  getClimateNews
};
