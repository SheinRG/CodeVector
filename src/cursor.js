// -----------------------------------------------------------------------------
// Cursor encoding / decoding.
//
// A "cursor" is just a pointer to the LAST item the client has already seen.
// Instead of saying "skip 40 rows" (OFFSET, which is slow and breaks when data
// changes), the client sends back the sort key of the last row it received:
//   { t: created_at, id: id }
//
// The next request then asks for "everything that sorts after this row", which
// is a fast, stable lookup. We base64url-encode the JSON so it's a single
// opaque string that's safe to put in a URL query parameter.
// -----------------------------------------------------------------------------

export function encodeCursor(row) {
  // row.created_at is a JS Date from pg; toISOString() keeps full precision.
  const payload = JSON.stringify({
    t: row.created_at.toISOString(),
    id: String(row.id),
  });
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function decodeCursor(cursor) {
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    const { t, id } = JSON.parse(json);
    if (!t || id === undefined) return null;
    // Validate the pieces so a malformed cursor can't break the SQL.
    if (Number.isNaN(Date.parse(t))) return null;
    if (!/^\d+$/.test(String(id))) return null;
    return { t, id: String(id) };
  } catch {
    return null; // any garbage cursor -> treat as "no cursor"
  }
}
