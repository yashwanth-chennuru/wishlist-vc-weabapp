const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT || 8080);
const ROOT_DIR = __dirname;
const PUBLIC_FILES = new Set(["/index.html", "/styles.css", "/script.js"]);
const DATA_DIR = path.join(ROOT_DIR, "data");
const ITEMS_FILE = path.join(DATA_DIR, "wishlist-items.json");
const MAX_BODY_BYTES = 1024 * 1024;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, error, fallback = "Request failed.") {
  if (error instanceof HttpError) {
    sendJson(res, error.statusCode, { error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : fallback;
  sendJson(res, 500, { error: message || fallback });
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

function sanitizeHttpUrl(urlString) {
  if (typeof urlString !== "string") {
    return "";
  }
  const trimmed = urlString.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch (error) {
    return "";
  }

  return "";
}

function sanitizeImageValue(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("data:image/")) {
    return trimmed.length <= 15000 ? trimmed : "";
  }

  return sanitizeHttpUrl(trimmed);
}

function inferSource(link) {
  if (!link) {
    return "Manual item";
  }
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch (error) {
    return "Manual item";
  }
}

function ensureStoreReady() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(ITEMS_FILE)) {
    fs.writeFileSync(ITEMS_FILE, "[]", "utf8");
  }
}

function normalizeStoredItem(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 220) : "";
  if (!name) {
    return null;
  }

  const link = sanitizeHttpUrl(raw.link);
  const image = sanitizeImageValue(raw.image);
  const sourceRaw =
    typeof raw.source === "string" ? raw.source.trim().slice(0, 120) : "";
  const source = sourceRaw || inferSource(link);

  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : randomUUID(),
    name,
    image,
    source,
    link,
    dark: Boolean(raw.dark),
    createdAt: Number.isFinite(Number(raw.createdAt))
      ? Number(raw.createdAt)
      : Date.now(),
    updatedAt: Number.isFinite(Number(raw.updatedAt))
      ? Number(raw.updatedAt)
      : Date.now(),
  };
}

function readItemsFromStore() {
  ensureStoreReady();

  try {
    const rawText = fs.readFileSync(ITEMS_FILE, "utf8");
    const parsed = JSON.parse(rawText);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((entry) => normalizeStoredItem(entry)).filter(Boolean);
  } catch (error) {
    return [];
  }
}

function writeItemsToStore(items) {
  ensureStoreReady();
  fs.writeFileSync(ITEMS_FILE, JSON.stringify(items, null, 2), "utf8");
}

function normalizeIncomingItem(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new HttpError(400, "Body must be a JSON object.");
  }

  const name =
    typeof payload.name === "string" ? payload.name.trim().slice(0, 220) : "";
  if (!name) {
    throw new HttpError(400, "Field 'name' is required.");
  }

  const link = sanitizeHttpUrl(payload.link);
  const image = sanitizeImageValue(payload.image);
  const sourceRaw =
    typeof payload.source === "string" ? payload.source.trim().slice(0, 120) : "";
  const source = sourceRaw || inferSource(link);

  return {
    id: randomUUID(),
    name,
    image,
    source,
    link,
    dark: Boolean(payload.dark),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function parseItemIdFromPath(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 3 && parts[0] === "api" && parts[1] === "items") {
    return decodeURIComponent(parts[2]);
  }
  return "";
}

function readRequestBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let done = false;
    let total = 0;
    const chunks = [];

    function finish(fn, value) {
      if (done) {
        return;
      }
      done = true;
      fn(value);
    }

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        finish(reject, new HttpError(413, "Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      finish(resolve, Buffer.concat(chunks).toString("utf8"));
    });

    req.on("error", (error) => {
      finish(reject, error);
    });
  });
}

async function parseJsonBody(req) {
  const raw = await readRequestBody(req);
  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new HttpError(400, "Invalid JSON body.");
  }
}

let itemsMutationQueue = Promise.resolve();
function mutateItems(mutator) {
  const next = itemsMutationQueue.then(() => {
    const items = readItemsFromStore();
    const result = mutator(items);
    writeItemsToStore(items);
    return result;
  });
  itemsMutationQueue = next.catch(() => {});
  return next;
}

async function fetchMetadata(targetUrl) {
  const url = new URL(targetUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError(400, "Only HTTP(S) links are supported.");
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
    throw new HttpError(502, `Upstream page responded with ${response.status}.`);
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

ensureStoreReady();

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 400, { error: "Invalid request." });
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (requestUrl.pathname === "/healthz" && req.method === "GET") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (requestUrl.pathname === "/api/metadata" && req.method === "GET") {
    const target = requestUrl.searchParams.get("url");
    if (!target) {
      sendJson(res, 400, { error: "Query param 'url' is required." });
      return;
    }

    try {
      const metadata = await fetchMetadata(target);
      sendJson(res, 200, metadata);
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 502;
      sendJson(res, statusCode, {
        error: "Failed to fetch metadata for this URL.",
        details: error instanceof Error ? error.message : "Unknown error.",
      });
    }
    return;
  }

  if (requestUrl.pathname === "/api/items" && req.method === "GET") {
    const items = readItemsFromStore();
    sendJson(res, 200, { items });
    return;
  }

  if (requestUrl.pathname === "/api/items" && req.method === "POST") {
    try {
      const body = await parseJsonBody(req);
      const newItem = normalizeIncomingItem(body);
      const storedItem = await mutateItems((items) => {
        items.unshift(newItem);
        return newItem;
      });
      sendJson(res, 201, { item: storedItem });
    } catch (error) {
      sendError(res, error, "Failed to create item.");
    }
    return;
  }

  const itemId = parseItemIdFromPath(requestUrl.pathname);
  if (itemId && req.method === "PATCH") {
    try {
      const body = await parseJsonBody(req);
      if (typeof body.dark !== "boolean") {
        throw new HttpError(400, "Field 'dark' must be boolean.");
      }

      const updatedItem = await mutateItems((items) => {
        const index = items.findIndex((item) => item.id === itemId);
        if (index === -1) {
          throw new HttpError(404, "Item not found.");
        }
        items[index].dark = body.dark;
        items[index].updatedAt = Date.now();
        return items[index];
      });

      sendJson(res, 200, { item: updatedItem });
    } catch (error) {
      sendError(res, error, "Failed to update item.");
    }
    return;
  }

  if (itemId && req.method === "DELETE") {
    try {
      const deletedItem = await mutateItems((items) => {
        const index = items.findIndex((item) => item.id === itemId);
        if (index === -1) {
          throw new HttpError(404, "Item not found.");
        }
        const [removed] = items.splice(index, 1);
        return removed;
      });

      sendJson(res, 200, { deletedId: deletedItem.id });
    } catch (error) {
      sendError(res, error, "Failed to delete item.");
    }
    return;
  }

  if (requestUrl.pathname.startsWith("/api/")) {
    sendJson(res, 405, { error: "Method not allowed for this API route." });
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
