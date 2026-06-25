// -----------------------------------------------------------------------------
// Express server entry point.
//
// Responsibilities:
//   - serve the JSON API under /api
//   - serve the static browser UI from /public
//   - expose /health for Render's health checks
// -----------------------------------------------------------------------------
import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { productsRouter } from "./routes/products.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

// API routes.
app.use("/api", productsRouter);

// Liveness check (used by Render, and handy to confirm the server is up).
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Static UI. Anything not matched above is served from /public.
app.use(express.static(path.join(__dirname, "..", "public")));

// Centralized error handler: log the real error, return a clean message.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
