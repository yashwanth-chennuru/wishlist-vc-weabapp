const http = require("http");
const fs = require("fs");
const path = require("path");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 8080);
const ROOT_DIR = __dirname;
const PUBLIC_FILES = new Set(["/index.html", "/styles.css", "/script.js"]);

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function getFilePath(urlPath) {
  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  if (!PUBLIC_FILES.has(safePath)) {
    return null;
  }
  return path.join(ROOT_DIR, safePath);
}

function parseTagAttributes(tag) {
  const attrs = {};
  const attrRegex = /([a-zA-Z_:-][a-zA-Z0-9_:.-]*)\s*=\s*["']([^"']*)["']/g;
  let match;

  while ((match = attrRegex.exec(tag)) !== null) {
    attrs[match[1].toLowerCase()] = match[2];
  }

  return attrs;
}

function readMetaTag(html, propOrName) {
  const target = propOrName.toLowerCase();
  const metaTagRegex = /<meta\s+[^>]*>/gi;
  let match;

  while ((match = metaTagRegex.exec(html)) !== null) {
    const attrs = parseTagAttributes(match[0]);
    const key = (attrs.property || attrs.name || "").toLowerCase();
    if (key === target && typeof attrs.content === "string") {
      return attrs.content.trim();
    }
  }

  return "";
}

function readTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (!titleMatch) {
    return "";
  }
  return titleMatch[1].replace(/\s+/g, " ").trim();
}

function readImageFromLinkTag(html) {
  const linkTagRegex = /<link\s+[^>]*>/gi;
  let match;

  while ((match = linkTagRegex.exec(html)) !== null) {
    const attrs = parseTagAttributes(match[0]);
    const rel = (attrs.rel || "").toLowerCase();
    if (rel === "image_src" && typeof attrs.href === "string") {
      return attrs.href.trim();
    }
  }

  return "";
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function firstImageFromNode(node) {
  if (!node) {
    return "";
  }

  if (typeof node === "string") {
    return node;
  }

  if (Array.isArray(node)) {
    for (const value of node) {
      const image = firstImageFromNode(value);
      if (image) {
        return image;
      }
    }
    return "";
  }

  if (typeof node !== "object") {
    return "";
  }

  if (typeof node.image === "string" && node.image.trim()) {
    return node.image.trim();
  }

  if (node.image && typeof node.image === "object") {
    if (typeof node.image.url === "string" && node.image.url.trim()) {
      return node.image.url.trim();
    }
    const nestedImage = firstImageFromNode(node.image);
    if (nestedImage) {
      return nestedImage;
    }
  }

  if (node["@graph"]) {
    const graphImage = firstImageFromNode(node["@graph"]);
    if (graphImage) {
      return graphImage;
    }
  }

  for (const value of Object.values(node)) {
    const image = firstImageFromNode(value);
    if (image) {
      return image;
    }
  }

  return "";
}

function firstNameFromNode(node) {
  if (!node) {
    return "";
  }

  if (Array.isArray(node)) {
    for (const value of node) {
      const name = firstNameFromNode(value);
      if (name) {
        return name;
      }
    }
    return "";
  }

  if (typeof node !== "object") {
    return "";
  }

  if (typeof node.name === "string" && node.name.trim()) {
    return node.name.trim();
  }

  if (node["@graph"]) {
    const graphName = firstNameFromNode(node["@graph"]);
    if (graphName) {
      return graphName;
    }
  }

  for (const value of Object.values(node)) {
    const name = firstNameFromNode(value);
    if (name) {
      return name;
    }
  }

  return "";
}

function readJsonLdMetadata(html) {
  const jsonLdRegex =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let title = "";
  let image = "";

  while ((match = jsonLdRegex.exec(html)) !== null) {
    const payload = safeJsonParse(match[1].trim());
    if (!payload) {
      continue;
    }

    if (!title) {
      title = firstNameFromNode(payload);
    }
    if (!image) {
      image = firstImageFromNode(payload);
    }
    if (title && image) {
      break;
    }
  }

  return { title, image };
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function firstValidValue(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function tryResolveUrl(maybeRelative, baseUrl) {
  if (!maybeRelative) {
    return "";
  }
  try {
    return new URL(maybeRelative, baseUrl).toString();
  } catch (error) {
    return "";
  }
}

async function fetchMetadata(targetUrl) {
  const url = new URL(targetUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP(S) links are supported.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  let response;

  try {
    response = await fetch(url.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) WishlistBot/1.0",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Upstream page responded with ${response.status}.`);
  }

  const html = await response.text();
  const jsonLd = readJsonLdMetadata(html);
  const rawTitle = firstValidValue([
    readMetaTag(html, "og:title"),
    readMetaTag(html, "twitter:title"),
    jsonLd.title,
    readTitle(html),
  ]);

  const rawImage = firstValidValue([
    readMetaTag(html, "og:image"),
    readMetaTag(html, "og:image:url"),
    readMetaTag(html, "twitter:image"),
    jsonLd.image,
    readImageFromLinkTag(html),
  ]);

  const cleanTitle = decodeHtmlEntities(rawTitle);
  const cleanImage = decodeHtmlEntities(rawImage);
  const imageUrl = tryResolveUrl(cleanImage, response.url || targetUrl);

  return {
    name: cleanTitle,
    image: imageUrl,
    resolvedUrl: response.url || targetUrl,
  };
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 400, { error: "Invalid request." });
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (requestUrl.pathname === "/api/metadata") {
    const target = requestUrl.searchParams.get("url");
    if (!target) {
      sendJson(res, 400, { error: "Query param 'url' is required." });
      return;
    }

    try {
      const metadata = await fetchMetadata(target);
      sendJson(res, 200, metadata);
    } catch (error) {
      sendJson(res, 502, {
        error: "Failed to fetch metadata for this URL.",
        details: error.message,
      });
    }
    return;
  }

  const filePath = getFilePath(requestUrl.pathname);
  if (!filePath) {
    sendJson(res, 404, { error: "Not found." });
    return;
  }

  const ext = path.extname(filePath);
  const contentType =
    ext === ".css"
      ? "text/css; charset=utf-8"
      : ext === ".js"
        ? "application/javascript; charset=utf-8"
        : "text/html; charset=utf-8";

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 500, { error: "Failed to load file." });
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Wishlist app running on http://localhost:${PORT}`);
});
