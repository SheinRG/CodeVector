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
    const { rows } = await query(sql, params);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? encodeCursor(items[items.length - 1]) : null;

    res.json({ items, nextCursor });
  } catch (err) {
    next(err);
  }
});

// Small helper endpoint so the UI can populate its category dropdown.
productsRouter.get("/categories", async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT DISTINCT category FROM products ORDER BY category`
    );
    res.json({ categories: rows.map((r) => r.category) });
  } catch (err) {
    next(err);
  }
});
