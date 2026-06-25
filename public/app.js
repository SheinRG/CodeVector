// -----------------------------------------------------------------------------
// Front-end logic.
//
// It calls GET /api/products and keeps appending pages using the `nextCursor`
// the server returns — the same cursor pagination the backend is built around.
// -----------------------------------------------------------------------------

const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");
const loadMoreBtn = document.getElementById("loadMore");
const endMsg = document.getElementById("endMsg");
const spinner = document.getElementById("spinner");
const categorySel = document.getElementById("category");
const limitSel = document.getElementById("limit");

let cursor = null; // the nextCursor from the last response
let loading = false;
let total = 0; // how many we've loaded so far (this filter)

const fmtPrice = (p) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(p);

// Human-friendly relative date, e.g. "3 days ago".
function relativeDate(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function cardHtml(p) {
  return `
    <article class="card">
      <div class="card-top">
        <span class="badge">${p.category}</span>
        <span class="card-id">#${p.id}</span>
      </div>
      <h3 class="card-name">${p.name}</h3>
      <div class="card-bottom">
        <span class="price">${fmtPrice(p.price)}</span>
        <span class="date">${relativeDate(p.created_at)}</span>
      </div>
    </article>`;
}

async function loadPage() {
  if (loading) return;
  loading = true;
  spinner.hidden = false;
  loadMoreBtn.hidden = true;

  const params = new URLSearchParams();
  params.set("limit", limitSel.value);
  if (categorySel.value) params.set("category", categorySel.value);
  if (cursor) params.set("cursor", cursor);

  try {
    const res = await fetch(`/api/products?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    grid.insertAdjacentHTML(
      "beforeend",
      data.items.map(cardHtml).join("")
    );
    total += data.items.length;
    cursor = data.nextCursor;

    statusEl.textContent = `Showing ${total.toLocaleString()} product${total === 1 ? "" : "s"}`;

    if (cursor) {
      loadMoreBtn.hidden = false;
      endMsg.hidden = true;
    } else {
      loadMoreBtn.hidden = true;
      endMsg.hidden = total === 0;
      statusEl.textContent = total === 0 ? "No products found." : statusEl.textContent;
    }
  } catch (err) {
    statusEl.textContent = "Couldn't load products. Is the database seeded?";
    console.error(err);
  } finally {
    spinner.hidden = true;
    loading = false;
  }
}

// Reset everything and load the first page (used on filter / page-size change).
function reset() {
  cursor = null;
  total = 0;
  grid.innerHTML = "";
  endMsg.hidden = true;
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

// Infinite scroll: load the next page when the Load-more button scrolls into view.
const observer = new IntersectionObserver(
  (entries) => {
    if (entries[0].isIntersecting && !loadMoreBtn.hidden) loadPage();
  },
  { rootMargin: "200px" }
);
observer.observe(loadMoreBtn);

loadMoreBtn.addEventListener("click", loadPage);
categorySel.addEventListener("change", reset);
limitSel.addEventListener("change", reset);

// Kick things off.
loadCategories();
reset();
