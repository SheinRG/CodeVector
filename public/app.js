// -----------------------------------------------------------------------------
// Front-end logic.
//
// It calls GET /api/products and keeps appending pages using the `nextCursor`
// the server returns — the same keyset/cursor pagination the backend is built
// around. The UI also surfaces a few backend signals (approx total, DB query
// time, the active cursor) so you can *see* how the pagination works.
// -----------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const grid = $("grid");
const statusEl = $("status");
const spinner = $("spinner");
const endMsg = $("endMsg");
const emptyMsg = $("emptyMsg");
const categorySel = $("category");
const limitSel = $("limit");
const totalStat = $("totalStat");
const latencyPill = $("latencyPill");
const latencyEl = $("latency");
const pagePill = $("pagePill");
const pageNumEl = $("pageNum");
const cursorBar = $("cursorBar");
const cursorVal = $("cursorVal");
const sentinel = $("sentinel");

let cursor = null; // the nextCursor from the last response
let loading = false;
let total = 0; // how many rows we've loaded so far (for the active filter)
let page = 0; // how many pages we've fetched
let approxTotal = null; // whole-table estimate from /api/stats

const fmtPrice = (p) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(p);

// Human-friendly relative date, e.g. "3d ago".
function relativeDate(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// Escape user-ish text before putting it in HTML (defensive; names are seeded).
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );

// Each category gets a soft, consistent tinted badge. We derive a stable hue
// from the category name (so the same category always looks the same) and let
// oklch produce a muted background + a darker, readable ink at that hue.
const toneCache = new Map();
function categoryTone(category) {
  if (toneCache.has(category)) return toneCache.get(category);
  let hue = 0;
  for (let i = 0; i < category.length; i++) {
    hue = (hue * 31 + category.charCodeAt(i)) % 360;
  }
  const tone = {
    bg: `oklch(0.95 0.015 ${hue})`,
    ink: `oklch(0.5 0.052 ${hue})`,
  };
  toneCache.set(category, tone);
  return tone;
}

function cardHtml(p) {
  const tone = categoryTone(p.category);
  return `
    <article class="card">
      <div class="card-top">
        <span class="badge" style="color:${tone.ink};background:${tone.bg}">${esc(
    p.category
  )}</span>
        <span class="card-id">#${p.id}</span>
      </div>
      <h3 class="card-name">${esc(p.name)}</h3>
      <div class="card-bottom">
        <span class="price">${fmtPrice(p.price)}</span>
        <span class="date">${relativeDate(p.created_at)}</span>
      </div>
    </article>`;
}

const skeletonHtml = () => `
  <div class="skeleton skeleton-cell">
    <div class="sk-line short"></div>
    <div class="sk-line"></div>
    <div class="sk-line tall"></div>
  </div>`;

// Skeleton cards flow inline as grid cells, right after the real ones.
function showSkeletons(n) {
  grid.insertAdjacentHTML(
    "beforeend",
    Array.from({ length: n }, skeletonHtml).join("")
  );
}
function clearSkeletons() {
  grid.querySelectorAll(".skeleton-cell").forEach((el) => el.remove());
}

function updateStatus() {
  if (total === 0) {
    statusEl.textContent = "";
    return;
  }
  if (categorySel.value) {
    statusEl.textContent = `Showing ${total.toLocaleString()} product${
      total === 1 ? "" : "s"
    } in ${categorySel.value}`;
  } else {
    const ofTotal = approxTotal ? ` of ~${approxTotal.toLocaleString()}` : "";
    statusEl.textContent = `Showing ${total.toLocaleString()}${ofTotal} products`;
  }
}

async function loadPage() {
  if (loading || (page > 0 && !cursor)) return;
  loading = true;
  spinner.hidden = page === 0; // first load shows skeletons, not the spinner
  showSkeletons(Math.min(parseInt(limitSel.value, 10), 4));

  const params = new URLSearchParams();
  params.set("limit", limitSel.value);
  if (categorySel.value) params.set("category", categorySel.value);
  if (cursor) params.set("cursor", cursor);

  try {
    const res = await fetch(`/api/products?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    clearSkeletons();
    grid.insertAdjacentHTML("beforeend", data.items.map(cardHtml).join(""));
    total += data.items.length;
    page += 1;
    cursor = data.nextCursor;

    // Surface backend signals.
    if (data.meta && typeof data.meta.queryMs === "number") {
      latencyEl.textContent = data.meta.queryMs.toFixed(1);
      latencyPill.hidden = false;
    }
    pageNumEl.textContent = page;
    pagePill.hidden = false;

    if (cursor) {
      cursorVal.textContent = cursor;
      cursorBar.hidden = false;
      endMsg.hidden = true;
    } else {
      cursorBar.hidden = true;
      endMsg.hidden = total === 0;
    }
    emptyMsg.hidden = total !== 0;
    updateStatus();
  } catch (err) {
    clearSkeletons();
    statusEl.textContent = "Couldn't load products. Is the database seeded?";
    console.error(err);
  } finally {
    spinner.hidden = true;
    loading = false;
    // The page may not have filled the viewport — keep loading if the sentinel
    // is still on screen.
    maybeLoadMore();
  }
}

// Reset everything and load the first page (used on filter / page-size change).
function reset() {
  cursor = null;
  total = 0;
  page = 0;
  grid.innerHTML = "";
  endMsg.hidden = true;
  emptyMsg.hidden = true;
  cursorBar.hidden = true;
  pagePill.hidden = true;
  latencyPill.hidden = true;
  statusEl.textContent = "Loading…";
  loadPage();
}

// Populate the category dropdown.
async function loadCategories() {
  try {
    const res = await fetch("/api/categories");
    const { categories } = await res.json();
    for (const c of categories) {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      categorySel.appendChild(opt);
    }
  } catch {
    /* non-fatal: the "All categories" option still works */
  }
}

// Load the approximate total for the header stat.
async function loadStats() {
  try {
    const res = await fetch("/api/stats");
    const { approxTotal: t } = await res.json();
    approxTotal = t;
    totalStat.textContent = `~${t.toLocaleString()}`;
  } catch {
    totalStat.textContent = "~200,000";
  }
}

// Infinite scroll: load the next page when the sentinel nears the viewport.
let sentinelVisible = false;
const observer = new IntersectionObserver(
  (entries) => {
    sentinelVisible = entries[0].isIntersecting;
    if (sentinelVisible) loadPage();
  },
  { rootMargin: "700px" }
);
observer.observe(sentinel);

function maybeLoadMore() {
  if (sentinelVisible && cursor && !loading) loadPage();
}

categorySel.addEventListener("change", reset);
limitSel.addEventListener("change", reset);

// Kick things off.
loadStats();
loadCategories();
reset();
