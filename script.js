const DEFAULT_LINK =
  "https://www.nike.in/nike-air-force-1-07-nn/p/25135848?q=unmistakable&searchRedirection=1";

const modeLinkBtn = document.getElementById("modeLinkBtn");
const modeManualBtn = document.getElementById("modeManualBtn");
const linkForm = document.getElementById("linkForm");
const manualForm = document.getElementById("manualForm");
const productLinkInput = document.getElementById("productLink");
const addLinkBtn = document.getElementById("addLinkBtn");
const manualNameInput = document.getElementById("manualName");
const manualImageInput = document.getElementById("manualImage");
const manualLinkInput = document.getElementById("manualLink");
const statusText = document.getElementById("status");
const itemCount = document.getElementById("itemCount");
const wishlistGrid = document.getElementById("wishlistGrid");
const emptyState = document.getElementById("emptyState");
const wishCardTemplate = document.getElementById("wishCardTemplate");

const state = {
  mode: "link",
  items: [],
};

let latestRequestId = 0;

function setStatus(message, type = "neutral") {
  statusText.textContent = message;
  statusText.classList.remove("is-error", "is-ok");
  if (type === "error") {
    statusText.classList.add("is-error");
  }
  if (type === "ok") {
    statusText.classList.add("is-ok");
  }
}

function pickNameFromUrl(url) {
  const parts = url.pathname
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  const usefulPart = parts.find((part) => part !== "p" && !/^\d+$/.test(part));
  if (!usefulPart) {
    return "Wishlist Item";
  }

  return usefulPart
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function createPlaceholderSvg(label) {
  const safeLabel = label.replace(/[<>]/g, "").slice(0, 32);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="#f6dac0" />
          <stop offset="100%" stop-color="#efb992" />
        </linearGradient>
      </defs>
      <rect width="800" height="1000" fill="url(#g)" />
      <circle cx="110" cy="130" r="84" fill="#f7ecdf" opacity="0.7" />
      <circle cx="690" cy="880" r="120" fill="#f7ecdf" opacity="0.54" />
      <text x="400" y="510" text-anchor="middle" fill="#412518"
        font-size="58" font-family="Verdana, Arial, sans-serif" font-weight="700">
        ${safeLabel}
      </text>
    </svg>
  `;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function toHostLabel(urlString) {
  try {
    return new URL(urlString).hostname.replace(/^www\./, "");
  } catch (error) {
    return "Manual item";
  }
}

function sanitizeHttpUrl(urlString) {
  if (!urlString) {
    return "";
  }
  try {
    const parsed = new URL(String(urlString).trim());
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
    return trimmed;
  }
  return sanitizeHttpUrl(trimmed);
}

function normalizeItem(raw) {
  const name =
    typeof raw?.name === "string" && raw.name.trim()
      ? raw.name.trim()
      : "Wishlist Item";
  const link = sanitizeHttpUrl(raw?.link);
  const sourceRaw =
    typeof raw?.source === "string" ? raw.source.trim() : "";
  const source = sourceRaw || (link ? toHostLabel(link) : "Manual item");
  const image = sanitizeImageValue(raw?.image) || createPlaceholderSvg(name);

  return {
    id: typeof raw?.id === "string" ? raw.id : "",
    name,
    image,
    source,
    link,
    dark: Boolean(raw?.dark),
  };
}

function updateCounts() {
  const count = state.items.length;
  itemCount.textContent = `${count} ${count === 1 ? "item" : "items"}`;
  emptyState.classList.toggle("is-hidden", count > 0);
}

function applyDarkClass(imageShell, isDark) {
  imageShell.classList.toggle("is-dark", isDark);
}

function renderItems() {
  wishlistGrid.innerHTML = "";
  const fragment = document.createDocumentFragment();

  state.items.forEach((item) => {
    const card = wishCardTemplate.content.firstElementChild.cloneNode(true);
    card.dataset.id = item.id;

    const imageShell = card.querySelector(".wish-card__image-shell");
    const image = card.querySelector(".wish-card__image");
    const title = card.querySelector(".wish-card__title");
    const source = card.querySelector(".wish-card__source");
    const darkInput = card.querySelector(".dark-toggle__input");
    const openLinkBtn = card.querySelector(".open-link-btn");

    image.src = item.image;
    image.alt = item.name;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      image.src = createPlaceholderSvg(item.name);
    });

    title.textContent = item.name;
    source.textContent = item.link ? `Source: ${item.source}` : "Source: Manual item";
    darkInput.checked = item.dark;
    applyDarkClass(imageShell, item.dark);

    if (item.link) {
      openLinkBtn.disabled = false;
      openLinkBtn.dataset.link = item.link;
    } else {
      openLinkBtn.disabled = true;
      delete openLinkBtn.dataset.link;
    }

    fragment.appendChild(card);
  });

  wishlistGrid.appendChild(fragment);
  updateCounts();
}

function setMode(mode) {
  state.mode = mode;
  const isLink = mode === "link";
  modeLinkBtn.classList.toggle("is-active", isLink);
  modeManualBtn.classList.toggle("is-active", !isLink);
  modeLinkBtn.setAttribute("aria-selected", String(isLink));
  modeManualBtn.setAttribute("aria-selected", String(!isLink));
  linkForm.classList.toggle("is-hidden", !isLink);
  manualForm.classList.toggle("is-hidden", isLink);
  setStatus("");
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || payload.details || "Request failed.");
  }
  return payload;
}

async function fetchItemsFromServer() {
  const payload = await requestJson("/api/items");
  return Array.isArray(payload.items) ? payload.items : [];
}

async function createItemOnServer(itemPayload) {
  const payload = await requestJson("/api/items", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(itemPayload),
  });
  return normalizeItem(payload.item || {});
}

async function deleteItemOnServer(itemId) {
  await requestJson(`/api/items/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  });
}

async function updateItemDarkOnServer(itemId, dark) {
  const payload = await requestJson(`/api/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ dark }),
  });
  return normalizeItem(payload.item || {});
}

async function getMetadata(productUrl) {
  const payload = await requestJson(
    `/api/metadata?url=${encodeURIComponent(productUrl)}`,
    { method: "GET" }
  );
  return payload;
}

function addItemToState(item) {
  state.items.unshift(item);
  renderItems();
}

function removeItemFromState(itemId) {
  state.items = state.items.filter((item) => item.id !== itemId);
  renderItems();
}

function replaceItemInState(nextItem) {
  const idx = state.items.findIndex((item) => item.id === nextItem.id);
  if (idx === -1) {
    return;
  }
  state.items[idx] = nextItem;
  renderItems();
}

modeLinkBtn.addEventListener("click", () => setMode("link"));
modeManualBtn.addEventListener("click", () => setMode("manual"));

linkForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const requestId = ++latestRequestId;
  let parsed;

  try {
    parsed = new URL(productLinkInput.value.trim());
  } catch (error) {
    setStatus("Enter a valid product URL.", "error");
    return;
  }

  addLinkBtn.disabled = true;
  setStatus("Fetching product metadata...");

  let itemPayload;
  let usedPlaceholder = false;

  try {
    const metadata = await getMetadata(parsed.toString());
    if (requestId !== latestRequestId) {
      return;
    }

    const name = (metadata.name || pickNameFromUrl(parsed)).trim();
    itemPayload = {
      name,
      image: sanitizeImageValue(metadata.image) || createPlaceholderSvg(name),
      source: toHostLabel(metadata.resolvedUrl || parsed.toString()),
      link: sanitizeHttpUrl(parsed.toString()),
      dark: false,
    };
    usedPlaceholder = !sanitizeImageValue(metadata.image);
  } catch (error) {
    if (requestId !== latestRequestId) {
      return;
    }

    const name = pickNameFromUrl(parsed);
    itemPayload = {
      name,
      image: createPlaceholderSvg(name),
      source: toHostLabel(parsed.toString()),
      link: sanitizeHttpUrl(parsed.toString()),
      dark: false,
    };
    usedPlaceholder = true;
  }

  try {
    const created = await createItemOnServer(itemPayload);
    if (requestId !== latestRequestId) {
      return;
    }
    addItemToState(created);
    productLinkInput.value = "";
    setStatus(
      usedPlaceholder
        ? "Item added. Metadata was limited, so placeholder image is used."
        : "Item added from link.",
      "ok"
    );
  } catch (error) {
    if (requestId !== latestRequestId) {
      return;
    }
    setStatus(`Could not save item: ${error.message}`, "error");
  } finally {
    addLinkBtn.disabled = false;
  }
});

manualForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = manualNameInput.value.trim();
  const imageInput = manualImageInput.value.trim();
  const manualLinkValue = manualLinkInput.value.trim();

  if (!name) {
    setStatus("Item name is required for manual entry.", "error");
    return;
  }

  if (imageInput && !sanitizeHttpUrl(imageInput)) {
    setStatus("Manual image URL should start with http:// or https://", "error");
    return;
  }

  if (manualLinkValue && !sanitizeHttpUrl(manualLinkValue)) {
    setStatus("Product URL should start with http:// or https://", "error");
    return;
  }

  const cleanManualLink = sanitizeHttpUrl(manualLinkValue);
  const payload = {
    name,
    image: sanitizeImageValue(imageInput) || createPlaceholderSvg(name),
    source: cleanManualLink ? toHostLabel(cleanManualLink) : "Manual item",
    link: cleanManualLink,
    dark: false,
  };

  try {
    const created = await createItemOnServer(payload);
    addItemToState(created);
    manualNameInput.value = "";
    manualImageInput.value = "";
    manualLinkInput.value = "";
    setStatus("Manual item added.", "ok");
  } catch (error) {
    setStatus(`Could not save item: ${error.message}`, "error");
  }
});

wishlistGrid.addEventListener("click", async (event) => {
  const openLinkBtn = event.target.closest(".open-link-btn");
  if (openLinkBtn) {
    const link = openLinkBtn.dataset.link || "";
    if (!link) {
      setStatus("No link is saved for this item.", "error");
      return;
    }
    const newTab = window.open(link, "_blank", "noopener,noreferrer");
    if (!newTab) {
      setStatus("Your browser blocked the new tab popup.", "error");
      return;
    }
    newTab.opener = null;
    setStatus("Opened product link in a new tab.", "ok");
    return;
  }

  const deleteBtn = event.target.closest(".delete-btn");
  if (!deleteBtn) {
    return;
  }

  const card = deleteBtn.closest(".wish-card");
  if (!card || !card.dataset.id) {
    return;
  }

  const itemId = card.dataset.id;
  deleteBtn.disabled = true;
  try {
    await deleteItemOnServer(itemId);
    removeItemFromState(itemId);
    setStatus("Item deleted.", "ok");
  } catch (error) {
    setStatus(`Could not delete item: ${error.message}`, "error");
    deleteBtn.disabled = false;
  }
});

wishlistGrid.addEventListener("change", async (event) => {
  const toggle = event.target.closest(".dark-toggle__input");
  if (!toggle) {
    return;
  }

  const card = toggle.closest(".wish-card");
  if (!card || !card.dataset.id) {
    return;
  }

  const itemId = card.dataset.id;
  const item = state.items.find((entry) => entry.id === itemId);
  if (!item) {
    return;
  }

  const nextDark = toggle.checked;
  const previousDark = item.dark;
  item.dark = nextDark;

  const imageShell = card.querySelector(".wish-card__image-shell");
  applyDarkClass(imageShell, nextDark);

  try {
    const updatedItem = await updateItemDarkOnServer(itemId, nextDark);
    replaceItemInState(updatedItem);
  } catch (error) {
    item.dark = previousDark;
    toggle.checked = previousDark;
    applyDarkClass(imageShell, previousDark);
    setStatus(`Could not update preview setting: ${error.message}`, "error");
  }
});

async function initialize() {
  productLinkInput.value = DEFAULT_LINK;
  setMode("link");
  setStatus("Loading shared wishlist...");

  try {
    const items = await fetchItemsFromServer();
    state.items = items.map((item) => normalizeItem(item));
    renderItems();
    if (state.items.length === 0) {
      setStatus("No items yet. Add your first product.");
    } else {
      setStatus("Shared wishlist loaded.", "ok");
    }
  } catch (error) {
    state.items = [];
    renderItems();
    setStatus(`Could not load shared wishlist: ${error.message}`, "error");
  }
}

initialize();
