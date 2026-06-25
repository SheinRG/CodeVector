// -----------------------------------------------------------------------------
// GET /api/products
//
// Browse products newest-first, optionally filtered by category, using
// KEYSET (a.k.a. cursor / seek) pagination.
//
// Query params:
//   ?limit=20            how many to return (1..100, default 20)
//   ?category=Books      optional exact-match category filter
//   ?cursor=<opaque>     optional; the `nextCursor` from the previous response
//
// Response:
//   {
//     items: [ { id, name, category, price, created_at, updated_at }, ... ],
//     nextCursor: "<opaque>" | null   // null means you've reached the end
//   }
// -----------------------------------------------------------------------------
import { Router } from "express";
import { query } from "../db.js";
import { encodeCursor, decodeCursor } from "../cursor.js";

export const productsRouter = Router();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

productsRouter.get("/products", async (req, res, next) => {
  try {
    // --- 1. Parse & clamp the limit -----------------------------------------
    let limit = parseInt(req.query.limit, 10);
    if (Number.isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;

    const category = req.query.category?.trim() || null;
    const cursor = req.query.cursor ? decodeCursor(req.query.cursor) : null;

    // --- 2. Build the WHERE clause piece by piece ---------------------------
    // We collect conditions and their parameters so the final SQL is fully
    // parameterized (no string concatenation of user input -> no SQL injection).
    const conditions = [];
    const params = [];

    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }

    if (cursor) {
      // THE KEY LINE. "Give me rows that come AFTER the cursor in our sort
      // order (created_at DESC, id DESC)." A row-value comparison maps directly
      // to that order and uses the composite index, so there's no row-skipping.
      params.push(cursor.t); // $n   = cursor created_at
      params.push(cursor.id); // $n+1 = cursor id
      conditions.push(
        `(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`
      );
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // We fetch limit + 1 rows. If we get the extra one, we know there's a next
    // page (and we use that extra row's keys as the next cursor). Then we drop
    // it from what we return. This avoids a separate COUNT(*) query.
    params.push(limit + 1);
    const limitParam = `$${params.length}`;

    const sql = `
      SELECT id, name, category, price, created_at, updated_at
      FROM products
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limitParam}
    `;

    // --- 3. Run it and shape the response -----------------------------------
    // Time just the DB query so we can report the real backend latency. This is
    // the SQL execution time only (no network to the browser), which is what we
    // actually control and optimize.
    const t0 = process.hrtime.bigint();
    const { rows } = await query(sql, params);
    const queryMs = Math.round(Number(process.hrtime.bigint() - t0) / 1e4) / 100;

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? encodeCursor(items[items.length - 1]) : null;

    res.json({ items, nextCursor, meta: { queryMs } });
  } catch (err) {
    next(err);
  }
});

// Small helper endpoint so the UI can populate its category dropdown.
//
// `SELECT DISTINCT category` scans every row to find a handful of distinct
// values, so running it on each page load is wasteful. Categories change very
// rarely, so we cache the result in memory for a few minutes. (For a single
// instance this is plenty; a multi-instance deploy would use a shared cache.)
let categoriesCache = null;
let categoriesCachedAt = 0;
const CATEGORIES_TTL_MS = 5 * 60 * 1000; // 5 minutes

productsRouter.get("/categories", async (_req, res, next) => {
  try {
    const now = Date.now();
    if (categoriesCache && now - categoriesCachedAt < CATEGORIES_TTL_MS) {
      return res.json({ categories: categoriesCache, cached: true });
    }
    const { rows } = await query(
      `SELECT DISTINCT category FROM products ORDER BY category`
    );
    categoriesCache = rows.map((r) => r.category);
    categoriesCachedAt = now;
    res.json({ categories: categoriesCache, cached: false });
  } catch (err) {
    next(err);
  }
});

// Approximate total product count, for the UI's "~200,000 products" stat.
//
// COUNT(*) on 200k rows is a full scan. Instead we read the row-count ESTIMATE
// the query planner keeps in pg_class.reltuples (kept fresh by ANALYZE /
// autovacuum). It's instant and accurate enough for a "browse" header.
productsRouter.get("/stats", async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT reltuples::bigint AS estimate
         FROM pg_class
        WHERE relname = 'products'`
    );
    res.json({ approxTotal: Number(rows[0]?.estimate ?? 0) });
  } catch (err) {
    next(err);
  }
});
