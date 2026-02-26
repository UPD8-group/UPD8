/**
 * UPD8.GROUP — Upload Function
 * Route: POST /api/upload  (via netlify.toml redirect)
 * Body:  { api_key, image_base64, mime_type }
 *
 * test.html converts the file to base64 client-side and sends JSON.
 */

const { getStore }    = require("@netlify/blobs");
const { randomBytes } = require("crypto");

const TTL_MINUTES  = 15;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic"];

// ⚠️ Validate at CALL TIME — not at module init.
// Using env vars as object keys at cold-start bakes in "undefined"
// keys, causing every valid API key to 401.
function getProductForKey(apiKey) {
  if (!apiKey) return null;
  if (apiKey === process.env.LISTINGLENS_API_KEY) return { domain: "listinglens.app",  category: "real_estate" };
  if (apiKey === process.env.VEHICLEVIBE_API_KEY)  return { domain: "vehiclevibe.app",  category: "vehicle"     };
  if (apiKey === process.env.TRAVELLING_API_KEY)   return { domain: "travelling.app",   category: "travel"      };
  if (apiKey === process.env.MENUMELT_API_KEY)      return { domain: "noforksgiven.app", category: "food"        };
  return null;
}

function blobStore() {
  return getStore({
    name:   "upd8-sessions",
    siteID: process.env.NETLIFY_SITE_ID,
    token:  process.env.NETLIFY_TOKEN,
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return cors(200, {});
  if (event.httpMethod !== "POST")    return cors(405, { error: "Method not allowed" });

  try {
    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch { return cors(400, { error: "Invalid JSON body" }); }

    const { api_key, image_base64, mime_type } = body;

    const product = getProductForKey(api_key);
    if (!product) return cors(401, { error: "Unauthorised" });

    if (!image_base64 || !mime_type)      return cors(400, { error: "image_base64 and mime_type are required" });
    if (!ALLOWED_MIME.includes(mime_type)) return cors(400, { error: "Unsupported image type. Use JPG, PNG, WebP or HEIC." });
    if (image_base64.length > 13_600_000) return cors(400, { error: "Image too large. Max ~10MB." });

    const session_id  = randomBytes(16).toString("hex");
    const blob_id     = randomBytes(16).toString("hex");
    const uploaded_at = new Date().toISOString();
    const expires_at  = new Date(Date.now() + TTL_MINUTES * 60 * 1000).toISOString();

    const store = blobStore();

    // Store image as JSON — analyze-background.js reads it back the same way
    await store.set(`img/${blob_id}`, JSON.stringify({
      image_base64, mime_type, uploaded_at, expires_at,
      domain: product.domain, category: product.category,
    }));

    await store.set(`session/${session_id}`, JSON.stringify({
      blob_id, domain: product.domain, category: product.category,
      uploaded_at, expires_at, status: "uploaded",
    }));

    return cors(200, { session_id, blob_id, domain: product.domain, category: product.category, expires_at });

  } catch (err) {
    console.error("upload.js error:", err.message);
    return cors(500, { error: err.message });
  }
};

function cors(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type":                 "application/json",
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify(body),
  };
}
