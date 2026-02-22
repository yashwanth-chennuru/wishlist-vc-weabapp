const DEFAULT_LINK =
  "https://www.nike.in/nike-air-force-1-07-nn/p/25135848?q=unmistakable&searchRedirection=1";
const STORAGE_KEY = "wishlist-items-v2";

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
  items: loadItems(),
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

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `wish-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
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
    const parsed = new URL(urlString);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
    return "";
  } catch (error) {
    return "";
  }
}

function sanitizeImageUrl(urlString) {
  return sanitizeHttpUrl(urlString);
}

function sanitizeProductUrl(urlString) {
  return sanitizeHttpUrl(urlString);
}

function loadItems() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : createId(),
        name: typeof item.name === "string" ? item.name.trim() : "",
        image: sanitizeImageUrl(item.image),
        source: typeof item.source === "string" ? item.source : "Manual item",
        link: sanitizeProductUrl(typeof item.link === "string" ? item.link : ""),
        dark: Boolean(item.dark),
      }))
      .filter((item) => item.name.length > 0)
      .map((item) => ({
        ...item,
        image: item.image || createPlaceholderSvg(item.name),
      }));
  } catch (error) {
    return [];
  }
}

function persistItems() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items));
  } catch (error) {
    setStatus("Could not save to local storage in this browser mode.", "error");
  }
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

function addItem(item) {
  state.items.unshift(item);
  persistItems();
  renderItems();
}

function removeItem(itemId) {
  const next = state.items.filter((item) => item.id !== itemId);
  if (next.length === state.items.length) {
    return;
  }
  state.items = next;
  persistItems();
  renderItems();
}

function updateItemDark(itemId, dark) {
  const item = state.items.find((entry) => entry.id === itemId);
  if (!item) {
    return;
  }
  item.dark = dark;
  persistItems();
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

async function getMetadata(productUrl) {
  const response = await fetch(
    `/api/metadata?url=${encodeURIComponent(productUrl)}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.details || payload.error || "Metadata request failed.");
  }
  return payload;
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

  try {
    const metadata = await getMetadata(parsed.toString());
    if (requestId !== latestRequestId) {
      return;
    }

    const name = (metadata.name || pickNameFromUrl(parsed)).trim();
    const image = sanitizeImageUrl(metadata.image) || createPlaceholderSvg(name);

    addItem({
      id: createId(),
      name,
      image,
      source: toHostLabel(metadata.resolvedUrl || parsed.toString()),
      link: sanitizeProductUrl(parsed.toString()),
      dark: false,
    });

    productLinkInput.value = "";
    setStatus("Item added from link.", "ok");
  } catch (error) {
    if (requestId !== latestRequestId) {
      return;
    }

    const name = pickNameFromUrl(parsed);
    addItem({
      id: createId(),
      name,
      image: createPlaceholderSvg(name),
      source: toHostLabel(parsed.toString()),
      link: sanitizeProductUrl(parsed.toString()),
      dark: false,
    });

    setStatus(
      "Site metadata was blocked for this URL. Added with placeholder image.",
      "error"
    );
  } finally {
    addLinkBtn.disabled = false;
  }
});

manualForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = manualNameInput.value.trim();
  const imageInput = manualImageInput.value.trim();
  const manualLinkValue = manualLinkInput.value.trim();

  if (!name) {
    setStatus("Item name is required for manual entry.", "error");
    return;
  }

  if (imageInput && !sanitizeImageUrl(imageInput)) {
    setStatus("Manual image URL should start with http:// or https://", "error");
    return;
  }

  if (manualLinkValue && !sanitizeProductUrl(manualLinkValue)) {
    setStatus("Product URL should start with http:// or https://", "error");
    return;
  }

  const cleanManualLink = sanitizeProductUrl(manualLinkValue);
  addItem({
    id: createId(),
    name,
    image: sanitizeImageUrl(imageInput) || createPlaceholderSvg(name),
    source: cleanManualLink ? toHostLabel(cleanManualLink) : "Manual item",
    link: cleanManualLink,
    dark: false,
  });

  manualNameInput.value = "";
  manualImageInput.value = "";
  manualLinkInput.value = "";
  setStatus("Manual item added.", "ok");
});

wishlistGrid.addEventListener("click", (event) => {
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

  removeItem(card.dataset.id);
  setStatus("Item deleted.", "ok");
});

wishlistGrid.addEventListener("change", (event) => {
  const toggle = event.target.closest(".dark-toggle__input");
  if (!toggle) {
    return;
  }

  const card = toggle.closest(".wish-card");
  if (!card || !card.dataset.id) {
    return;
  }

  const imageShell = card.querySelector(".wish-card__image-shell");
  applyDarkClass(imageShell, toggle.checked);
  updateItemDark(card.dataset.id, toggle.checked);
});

productLinkInput.value = DEFAULT_LINK;
setMode("link");
renderItems();
