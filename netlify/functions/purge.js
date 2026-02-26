import { getDeployStore } from "@netlify/blobs";

const TTL_MS = 15 * 60 * 1000;

export const handler = async () => {
  const store = getDeployStore("upd8-sessions");
  const now = Date.now();
  let deleted = 0;
  let errors  = 0;

  try {
    const { blobs } = await store.list();

    for (const blob of blobs) {
      try {
        const raw = await store.get(blob.key);
        if (!raw) continue;

        const data = JSON.parse(raw);

        const uploadedAt = data.uploaded_at
          ? new Date(data.uploaded_at).getTime()
          : null;

        const isExpired = uploadedAt
          ? now - uploadedAt > TTL_MS
          : data.expires_at
            ? now > new Date(data.expires_at).getTime()
            : false;

        if (isExpired) {
          await store.delete(blob.key);
          deleted++;
        }

      } catch (itemErr) {
        errors++;
        try {
          await store.delete(blob.key);
          deleted++;
        } catch (_) {}
      }
    }

    console.log(`[purge] deleted: ${deleted}, errors: ${errors}, checked: ${blobs.length}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ deleted, errors, checked: blobs.length }),
    };

  } catch (err) {
    console.error("[purge] Fatal error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
