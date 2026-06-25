// -----------------------------------------------------------------------------
// Seed script: create ~200,000 products.
//
// Run with:  npm run seed
//
// Speed note (the task explicitly warns "don't do a slow approach in a loop"):
// inserting one row per round-trip would mean 200,000 network round-trips and
// take forever. Instead we build BATCHED multi-row INSERTs — one statement
// inserts a few thousand rows at once, so we do ~100 round-trips total.
// (Postgres COPY would be even faster, but multi-row INSERT is plenty fast here
//  and much easier to read.)
// -----------------------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOTAL = parseInt(process.env.SEED_COUNT, 10) || 200_000;
const BATCH_SIZE = 2_000; // 2000 rows * 5 columns = 10,000 params per statement

const CATEGORIES = [
  "Electronics", "Books", "Clothing", "Home & Kitchen", "Toys",
  "Sports", "Beauty", "Grocery", "Automotive", "Garden",
  "Office", "Pet Supplies",
];
const ADJECTIVES = [
  "Premium", "Classic", "Eco", "Smart", "Compact", "Deluxe", "Portable",
  "Wireless", "Vintage", "Modern", "Rugged", "Lightweight",
];
const NOUNS = [
  "Speaker", "Notebook", "Jacket", "Blender", "Puzzle", "Racket", "Serum",
  "Bottle", "Charger", "Lamp", "Backpack", "Mug", "Chair", "Camera",
];

const randomOf = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Spread created_at over roughly the last 2 years so "newest first" is
// meaningful. updated_at is >= created_at.
const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const now = Date.now();

function makeRow() {
  const name = `${randomOf(ADJECTIVES)} ${randomOf(NOUNS)}`;
  const category = randomOf(CATEGORIES);
  const price = (Math.random() * 999 + 1).toFixed(2); // 1.00 .. 1000.00
  const createdAt = new Date(now - Math.random() * TWO_YEARS_MS);
  // updated_at sometime between created_at and now.
  const updatedAt = new Date(
    createdAt.getTime() + Math.random() * (now - createdAt.getTime())
  );
  return [name, category, price, createdAt.toISOString(), updatedAt.toISOString()];
}

// Turn a batch of rows into one parameterized INSERT:
//   INSERT INTO products (...) VALUES ($1,$2,$3,$4,$5),($6,$7,...),...
function buildInsert(rows) {
  const cols = 5;
  const valueGroups = [];
  const params = [];
  rows.forEach((row, i) => {
    const base = i * cols;
    valueGroups.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`
    );
    params.push(...row);
  });
  const sql = `
    INSERT INTO products (name, category, price, created_at, updated_at)
    VALUES ${valueGroups.join(", ")}
  `;
  return { sql, params };
}

async function main() {
  console.log(`Seeding ${TOTAL.toLocaleString()} products...`);
  const start = Date.now();

  // 1. Make sure the table + indexes exist (runs db/schema.sql).
  const schema = fs.readFileSync(
    path.join(__dirname, "..", "db", "schema.sql"),
    "utf8"
  );
  await pool.query(schema);

  // 2. Start clean so re-running the script doesn't pile up duplicates.
  await pool.query("TRUNCATE TABLE products RESTART IDENTITY");

  // 3. Insert in batches.
  let inserted = 0;
  while (inserted < TOTAL) {
    const thisBatch = Math.min(BATCH_SIZE, TOTAL - inserted);
    const rows = Array.from({ length: thisBatch }, makeRow);
    const { sql, params } = buildInsert(rows);
    await pool.query(sql, params);
    inserted += thisBatch;
    if (inserted % 20_000 === 0 || inserted === TOTAL) {
      console.log(`  inserted ${inserted.toLocaleString()} / ${TOTAL.toLocaleString()}`);
    }
  }

  // 4. Refresh the planner's table statistics. This keeps query plans optimal
  //    and makes pg_class.reltuples (our fast approximate count) accurate.
  await pool.query("ANALYZE products");

  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Done in ${secs}s.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
