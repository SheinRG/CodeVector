# Product Browser — CodeVector take-home

A small backend that lets you browse ~200,000 products **newest first**, **filter
by category**, and **paginate** — quickly, and *correctly even while the data is
changing underneath you*.

- **Live URL:** _(add your Render URL here after deploying)_
- **Stack:** Node.js + Express, Supabase (Postgres), plain `pg` driver (no ORM).
- **UI:** a small static page served by the same server (`/`).

---

## The one idea that matters: keyset (cursor) pagination

The task has two requirements that pull in the same direction:

1. **Pagination should be fast.**
2. **Stay correct while data changes** — if products are added/updated mid-browse,
   you must never see the same product twice or skip one.

The naive approach, `LIMIT 20 OFFSET 40`, **fails both**:

- **Slow:** `OFFSET 100000` makes Postgres walk and throw away 100,000 rows before
  it returns anything. It gets slower the deeper you page.
- **Incorrect under writes:** offsets count *positions*. If 50 new products are
  inserted at the top while you're on page 3, every row shifts down by 50. Page 4
  now repeats rows you already saw (duplicates), and a delete would skip rows.

**Keyset pagination fixes both.** Instead of "skip N rows", the client remembers
the **sort key of the last row it saw** (a *cursor*) and asks for "the rows that
come after this one":

```sql
SELECT id, name, category, price, created_at, updated_at
FROM products
WHERE (created_at, id) < ($cursor_created_at, $cursor_id)   -- the cursor
ORDER BY created_at DESC, id DESC
LIMIT $limit;
```

- It's **fast at any depth** — backed by the index `(created_at DESC, id DESC)`,
  Postgres *seeks* straight to the cursor position instead of counting rows. Page
  10,000 is as fast as page 1.
- It's **correct under writes** because the cursor points at a *value*, not a
  *position*. `created_at` is immutable for existing rows, so inserts/deletes
  elsewhere don't change which rows come "after" your cursor. New products appear
  at the top (which you've already passed) — so no duplicates, no skips.

### Why `(created_at, id)` and not just `created_at`?

The task says many products may share column values, including `created_at`. If
two rows have the same timestamp and we paginate on `created_at` alone, a cursor
sitting on that timestamp can't tell which of those rows we already returned —
risking a duplicate or a skip. Adding the unique `id` as a tie-breaker makes the
sort a **total order**, so every cursor points at exactly one boundary. The
`(created_at, id) < (...)` row-value comparison expresses exactly that and maps
cleanly onto the composite index.

---

## API

### `GET /api/products`

| Param      | Default | Notes                                              |
| ---------- | ------- | -------------------------------------------------- |
| `limit`    | 20      | clamped to 1..100                                  |
| `category` | —       | optional exact-match filter                        |
| `cursor`   | —       | opaque string; pass back the `nextCursor` you got  |

**Response**

```json
{
  "items": [
    { "id": "199987", "name": "Smart Speaker", "category": "Electronics",
      "price": "249.99", "created_at": "2025-...", "updated_at": "2025-..." }
  ],
  "nextCursor": "eyJ0IjoiMjAyNS0..."   // null when you've reached the end
}
```

The cursor is just `{ created_at, id }` of the last row, base64url-encoded so it's
a single opaque URL-safe string. To get the next page, send it back as `?cursor=`.

> **How "is there a next page?" is answered without `COUNT(*)`:** we ask for
> `limit + 1` rows. If the extra row comes back, there's more, and we use it to
> build `nextCursor`; otherwise `nextCursor` is `null`. This avoids a second,
> expensive counting query.

### `GET /api/categories`

Returns the distinct category list (used to populate the UI filter).

### `GET /health`

`{ "status": "ok" }` — used by Render's health check.

---

## Running it locally

```bash
npm install
cp .env.example .env          # then paste your Supabase connection string
npm run seed                  # creates the table + 200,000 products
npm start                     # http://localhost:3000
```

### The seed script (`scripts/seed.js`)

It creates the table and indexes (`db/schema.sql`), then inserts 200,000 rows.
The task warns *"don't do a slow approach in a loop"* — so instead of one INSERT
per row (200k network round-trips), it uses **batched multi-row INSERTs**: 2,000
rows per statement, ~100 round-trips total. `created_at` is spread across the last
~2 years so "newest first" is actually meaningful.

---

## Deploying (Supabase + Render, both free)

1. **Supabase** → New project → copy the **connection string** (the *Transaction
   pooler*, port 6543, is best for a web service). Replace `[YOUR-PASSWORD]`.
2. Seed the data: set `DATABASE_URL` in your local `.env`, run `npm run seed`.
   (Seeding once locally is enough — Render and your laptop talk to the same DB.)
3. **Render** → New Web Service → connect this repo. Build `npm install`, start
   `npm start`. Add the `DATABASE_URL` env var. Deploy. (`render.yaml` is
   included as a Blueprint too.)

---

## Short note (what the task asks for)

**What I chose and why.** Node + Express + Postgres (Supabase) with the plain `pg`
driver — no ORM, so the exact SQL is visible and easy to reason about. The whole
design centers on **keyset pagination** over an immutable `(created_at, id)` sort
key, which is what makes paging both fast and correct under concurrent writes (the
real point of the task). A single composite index serves both the unfiltered and
the newest-first ordering; a second `(category, created_at, id)` index serves the
filtered case.

**What I'd improve with more time.**
- Seed even faster with Postgres `COPY` (streamed) instead of multi-row INSERTs.
- Add automated tests, especially a concurrency test that inserts rows mid-pagination
  and asserts no duplicates/skips.
- Validate/normalize the `category` param against the known set and add request
  rate limiting.
- Optionally support both directions (older/newer) and a "jump to top / live"
  affordance in the UI.

**How I used AI.** _(fill in honestly for your submission)_ — e.g. used it to
scaffold the Express boilerplate, the seed generator, and the UI, and to sanity-
check the row-value comparison against the composite index. Things to double-check
that AI commonly gets wrong here: using plain `created_at DESC` without the `id`
tie-breaker (breaks on duplicate timestamps), and reaching for `OFFSET` pagination
(which fails the "correct under writes" requirement).
```
