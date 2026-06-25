// -----------------------------------------------------------------------------
// Database connection.
//
// We use the plain `pg` driver (node-postgres) and write SQL ourselves. There's
// no ORM hiding things, so the query you read here is exactly the query that
// runs on Supabase. A connection Pool reuses TCP connections across requests
// instead of opening a new one every time (which would be slow).
// -----------------------------------------------------------------------------
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and paste your " +
      "Supabase connection string."
  );
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase requires SSL. Their certificate isn't in Node's default trust
  // store, so we accept it without strict verification (standard for Supabase).
  ssl: { rejectUnauthorized: false },
  max: 10, // up to 10 connections in the pool
});

// Small helper so callers just write `query(sql, params)`.
export function query(text, params) {
  return pool.query(text, params);
}
