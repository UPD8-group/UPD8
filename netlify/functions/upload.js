import { getDeployStore } from "@netlify/blobs";
import { randomBytes } from "crypto";

const DOMAIN_REGISTRY = {
  [process.env.LISTINGLENS_API_KEY]:  { domain: "listinglens.app",  category: "real_estate" },
  [process.env.VEHICLEVIBE_API_KEY]:  { domain: "vehiclevibe.app",  category: "vehicle"     },
  [process.env.TRAVELLING_API_KEY]:   { domain: "travelling.app",   category: "travel"      },
  [process.env.MENUMELT_API_KEY]:     { domain: "menumelt.app",     category: "food"        },
};

const TTL_MINUTES = 15;

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return corsResponse(200, {});
  if (event.httpMethod !== "POST") return corsResponse(405, { error: "Method not allowed" });

  try {
    const apiKey = event.headers["x-upd8-key"];
    if (!apiKey || !DOMAIN_REGISTRY[apiKey]) {
      return corsResponse(401, { error: "Unauthorised" });
    }
    const { domain, category } = DOMAIN_REGISTRY[apiKey];

    const body = JSON.parse(event.body);
    const { image_base64, mime_type } = body;

    if (!image_base64 || !mime_type) {
      return corsResponse(400, { error: "image_base64 and mime_type are required" });
    }

    const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];
    if (!ALLOWED_TYPES.includes(mime_type)) {
      return corsResponse(400, { error: "Unsupported image type" });
    }

    if (image_base64.length > 13_600_000) {
      return corsResponse(400, { error: "Image too large. Max 10MB." });
    }

    const session_id  = randomBytes(16).toString("hex");
    const blob_id     = randomBytes(16).toString("hex");
    const uploaded_at = new Date().toISOString();
    const expires_at  = new Date(Date.now() + TTL_MINUTES * 60 * 1000).toISOString();

    const store = getDeployStore({
      name: "upd8-sessions",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN,
    });

    await store.set(`img/${blob_id}`, JSON.stringify({
      image_base64,
      mime_type,
      uploaded_at,
      expires_at,
      domain,
      category,
    }));

    await store.set(`session/${session_id}`, JSON.stringify({
      blob_id,
      domain,
      category,
      uploaded_at,
      expires_at,
      status: "uploaded",
    }));

    return corsResponse(200, {
      session_id,
      blob_id,
      domain,
      category,
      expires_at,
    });

  } catch (err) {
    console.error("upload.js error:", err.message);
    return corsResponse(500, { error: err.message });
  }
};

function corsResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, x-upd8-key",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify(body),
  };
}
