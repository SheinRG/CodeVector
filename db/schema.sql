-- =============================================================================
-- Schema for the product-browsing backend.
--
-- You can run this in the Supabase dashboard (SQL Editor) OR just run
-- `npm run seed`, which runs this exact DDL automatically before inserting.
-- =============================================================================

CREATE TABLE IF NOT EXISTS products (
    id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT        NOT NULL,
    category    TEXT        NOT NULL,
    price       NUMERIC(10, 2) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- The index that makes everything fast.
--
-- We always sort "newest first": ORDER BY created_at DESC, id DESC.
-- This composite index lets Postgres:
--   1. Return the first page instantly (just walk the top of the index).
--   2. Jump straight to a cursor position with a row comparison
--      (created_at, id) < (:cursor_created_at, :cursor_id)  -- NO offset scan.
--
-- id is included as a tie-breaker so the ordering is a *total* order even when
-- many products share the same created_at (the task says that's allowed).
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_products_created_at_id
    ON products (created_at DESC, id DESC);

-- The same idea, but for "filter by category" queries. Category comes first so
-- Postgres can seek to one category and then walk it newest-first.
CREATE INDEX IF NOT EXISTS idx_products_category_created_at_id
    ON products (category, created_at DESC, id DESC);
