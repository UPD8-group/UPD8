export default async (request, context) => {
  const ip = context.ip || request.headers.get("x-forwarded-for") || "unknown";
  const url = new URL(request.url);
  const window = Math.floor(Date.now() / (10 * 60 * 1000));
  const cacheKey = `rate:${ip}:${url.pathname}:${window}`;

  try {
    const store = context.store;
    if (store) {
      const current = parseInt((await store.get(cacheKey)) || "0");
      const limit = 20;

      if (current >= limit) {
        return new Response(
          JSON.stringify({ error: "Too many requests. Please wait a moment." }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "60",
            },
          }
        );
      }

      await store.set(cacheKey, String(current + 1), { ttl: 600 });
    }
  } catch (_) {
    console.warn("Rate limit store unavailable");
  }

  return context.next();
};

export const config = {
  path: ["/netlify/functions/upload", "/netlify/functions/analyze"],
};
