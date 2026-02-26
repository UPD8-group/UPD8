/**
 * UPD8.GROUP — Purge Function (scheduled, runs every 5 min)
 * Deletes blobs older than 15 minutes.
 */

const { getStore } = require("@netlify/blobs");

const TTL_MS = 15 * 60 * 1000;

function blobStore() {
  return getStore({
    name:   "upd8-sessions",
    siteID: process.env.NETLIFY_SITE_ID,
    token:  process.env.NETLIFY_TOKEN,
  });
}

exports.handler = async () => {
  const store = blobStore();
  const now   = Date.now();
  let deleted = 0;
  let errors  = 0;

  try {
    const { blobs } = await store.list();

    for (const blob of blobs) {
      try {
        const raw = await store.get(blob.key);
        if (!raw) continue;

        let data;
        try { data = JSON.parse(raw); } catch { await store.delete(blob.key); deleted++; continue; }

        const uploadedAt = data.uploaded_at  ? new Date(data.uploaded_at).getTime()  : null;
        const startedAt  = data.startedAt    ? new Date(data.startedAt).getTime()    : null;
        const refTime    = uploadedAt || startedAt || null;

        const isExpired = refTime
          ? now - refTime > TTL_MS
          : data.expires_at
            ? now > new Date(data.expires_at).getTime()
            : false;

        if (isExpired) { await store.delete(blob.key); deleted++; }

      } catch (itemErr) {
        errors++;
        try { await store.delete(blob.key); deleted++; } catch (_) {}
      }
    }

    console.log(`[purge] deleted: ${deleted}, errors: ${errors}, checked: ${blobs.length}`);
    return { statusCode: 200, body: JSON.stringify({ deleted, errors, checked: blobs.length }) };

  } catch (err) {
    console.error("[purge] Fatal error:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
