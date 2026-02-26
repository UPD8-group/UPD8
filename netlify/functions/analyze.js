import { getStore } from "@netlify/blobs";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DOMAIN_REGISTRY = {
  [process.env.LISTINGLENS_API_KEY]: { domain: "listinglens.app",  category: "real_estate" },
  [process.env.VEHICLEVIBE_API_KEY]: { domain: "vehiclevibe.app",  category: "vehicle"     },
  [process.env.TRAVELLING_API_KEY]:  { domain: "travelling.app",   category: "travel"      },
  [process.env.MENUMELT_API_KEY]:    { domain: "menumelt.app",     category: "food"        },
};

const SYSTEM_PROMPTS = {
  real_estate: `You are a senior Australian buyer's advocate and property analyst.
Your job is to protect the buyer — not the agent, not the vendor.
Extract every detail visible in the listing screenshot, then provide a forensic analysis.

RULES:
- Be clinical and direct. No marketing language.
- Flag what is MISSING from the listing as aggressively as what is present.
- Calculate NSW stamp duty if state is NSW, VIC if Victoria, etc.
- Identify building era risks (1960-1990 = asbestos risk, post-2010 multi-storey = cladding risk).
- Note auction-specific risks (no cooling-off period in NSW/VIC auctions).
- Return ONLY valid JSON. No preamble. No markdown fences.`,

  vehicle: `You are a master mechanic and consumer advocate.
Your job is to protect the buyer from lemons, odometer fraud, and hidden damage.
Extract every detail visible in the vehicle listing screenshot.

RULES:
- Be clinical and direct. Flag what photos are missing (undercarriage, engine bay, interior).
- Cross-reference the listed price against typical market value for this make/model/year/km.
- Flag known reliability issues for this specific model year.
- Note if the odometer reading seems inconsistent with the vehicle's apparent condition.
- Return ONLY valid JSON. No preamble. No markdown fences.`,

  travel: `You are a travel intelligence analyst and consumer advocate.
Your job is to protect the traveller from misleading listings, hidden fees, and location misrepresentation.
Extract every detail visible in the accommodation or travel listing screenshot.

RULES:
- Be clinical and direct. Flag "beachfront" vs actual distance to water.
- Calculate true total cost including all fees, taxes, cleaning fees, resort fees.
- Flag what photos are missing (bathroom, street view, noise sources).
- Note cancellation policy risks clearly.
- Return ONLY valid JSON. No preamble. No markdown fences.`,

  food: `You are a food economist and nutrition researcher.
Your job is to give diners the truth behind menu pricing, nutrition, and sourcing claims.
Extract every detail visible in the menu screenshot.

RULES:
- Be clinical and direct. Flag price-per-gram value, inflated markups.
- Identify allergen risks if visible.
- Flag vague claims ("locally sourced", "artisan") that are unverifiable.
- Return ONLY valid JSON. No preamble. No markdown fences.`,
};

const SCHEMA_INSTRUCTION = `
Return this exact JSON structure. Fill every field. Use "Data not found" if unavailable.

{
  "report_metadata": {
    "app_name": "<domain name>",
    "category": "<category>",
    "timestamp": "<ISO 8601>",
    "status": "Verified"
  },
  "extracted_data": {
    "primary_id": "<address / vehicle / listing name>",
    "specs": ["<spec 1>", "<spec 2>"],
    "listed_price": "<price or Auction>",
    "listing_agent": "<agent name if visible>",
    "days_on_market": "<if visible, else Data not found>"
  },
  "disclosure_rating": {
    "badge": "<OPEN | SELECTIVE | GUARDED>",
    "score": <0-100>,
    "reasoning": "<one sentence explaining the badge>"
  },
  "red_flags": [
    { "severity": "<HIGH | MEDIUM | LOW>", "detail": "<specific finding>" }
  ],
  "hidden_positives": [
    "<genuine positive that is not marketing fluff>"
  ],
  "true_cost": {
    "listed_price_num": <number or null>,
    "estimated_purchase_cost": <number or null>,
    "line_items": [
      { "label": "<cost label>", "amount": "<formatted amount>" }
    ],
    "first_year_total": "<formatted total>"
  },
  "comparable_context": {
    "market_position": "<above | at | below market>",
    "reasoning": "<specific comparables if known, else general market context>",
    "negotiation_tip": "<one actionable tip>"
  },
  "missing_information": [
    "<specific thing absent from the listing that a buyer needs>"
  ],
  "closer_script": [
    { "topic": "<topic>", "question": "<exact words to say to the agent>" }
  ],
  "checklist": [
    "<specific action item before committing>"
  ]
}`;

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return corsResponse(200, {});
  if (event.httpMethod !== "POST") return corsResponse(405, { error: "Method not allowed" });

  try {
    const apiKey = event.headers["x-upd8-key"];
    if (!apiKey || !DOMAIN_REGISTRY[apiKey]) {
      return corsResponse(401, { error: "Unauthorised" });
    }
    const { domain, category } = DOMAIN_REGISTRY[apiKey];

    const { session_id, blob_id, tier = "standard" } = JSON.parse(event.body);
    if (!session_id || !blob_id) {
      return corsResponse(400, { error: "session_id and blob_id are required" });
    }

    const store = getStore({
      name: "upd8-sessions",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_TOKEN,
    });

    const imgRaw = await store.get(`img/${blob_id}`);
    if (!imgRaw) {
      return corsResponse(404, { error: "Session expired or not found" });
    }

    const { image_base64, mime_type, expires_at } = JSON.parse(imgRaw);

    if (new Date() > new Date(expires_at)) {
      await store.delete(`img/${blob_id}`);
      await store.delete(`session/${session_id}`);
      return corsResponse(410, { error: "Session expired. Please upload again." });
    }

    const sessionRaw = await store.get(`session/${session_id}`);
    const session = JSON.parse(sessionRaw);
    await store.set(`session/${session_id}`, JSON.stringify({ ...session, status: "analysing" }));

    const systemPrompt = SYSTEM_PROMPTS[category];
    const tierInstruction = tier === "deep_dive"
      ? `This is a DEEP DIVE analysis. Expand every section with maximum detail. Add a final "verdict" field with value "Proceed with Confidence" | "Investigate Before Committing" | "Significant Concerns" and a "verdict_reasoning" field.`
      : `This is a STANDARD analysis. Be thorough but concise.`;

    const userPrompt = `Domain: ${domain}
Category: ${category}
Tier: ${tier}
${tierInstruction}

Analyse this listing screenshot and return the JSON report.

${SCHEMA_INSTRUCTION}`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: tier === "deep_dive" ? 4096 : 2048,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mime_type,
                data: image_base64,
              },
            },
            {
              type: "text",
              text: userPrompt,
            },
          ],
        },
      ],
    });

    const rawText = response.content[0].text.trim();
    let report;
    try {
      const cleaned = rawText.replace(/^```json?\n?/i, "").replace(/\n?```$/i, "").trim();
      report = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("JSON parse failed:", rawText.substring(0, 500));
      return corsResponse(500, { error: "Analysis returned invalid format. Please try again." });
    }

    await store.set(`session/${session_id}`, JSON.stringify({
      ...session,
      status: "complete",
      completed_at: new Date().toISOString(),
    }));

    return corsResponse(200, { report });

  } catch (err) {
    console.error("analyze.js error:", err.message);
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
