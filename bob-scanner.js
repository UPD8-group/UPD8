exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let query;
  try {
    ({ query } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: "Invalid JSON body" };
  }

  if (!query) {
    return { statusCode: 400, body: "Missing query" };
  }

  const SYSTEM_PROMPT = `You are Bob, an ASX investment analyst. When given a search instruction, you must:

1. Use web search to find 3-5 real ASX-listed companies matching the criteria.
2. For each company, gather enough data to score it across these 8 category scores (each scored 1-10):
   - business_quality (revenue growth, margins, cash flow, recurring revenue)
   - balance_sheet (debt, cash runway, dilution history)
   - valuation (EV/Revenue, P/E, discount to peers)
   - management (founder-led, skin in game, track record)
   - moat (switching costs, TAM, mission-critical, disruption risk)
   - momentum (price vs ASX, broker sentiment, short interest)
   - news_flow (recent announcements, media sentiment, guidance reliability)
   - deal_quality (if applicable: underwriter, cornerstones, vendor selldown)

3. Return ONLY a valid JSON object. No preamble. No markdown. No explanation outside the JSON.

JSON format:
{
  "query": "the search query used",
  "scan_date": "today's date",
  "companies": [
    {
      "name": "Company Name",
      "asx_code": "ASX:XXX",
      "sector": "sector name",
      "market_cap": "$XXXm",
      "composite_score": 0-100,
      "category_scores": {
        "business_quality": 0,
        "balance_sheet": 0,
        "valuation": 0,
        "management": 0,
        "moat": 0,
        "momentum": 0,
        "news_flow": 0,
        "deal_quality": 0
      },
      "recommendation": "STRONG INTEREST | WORTH WATCHING | PASS",
      "green_flags": ["flag1", "flag2"],
      "red_flags": ["flag1", "flag2"],
      "one_liner": "One sentence summary of the opportunity"
    }
  ],
  "top_pick": "ASX:XXX",
  "top_pick_reason": "Why this one stands out"
}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "interleaved-thinking-2025-05-14"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search"
          }
        ],
        messages: [
          {
            role: "user",
            content: query
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: data.error?.message || "Claude API error" })
      };
    }

    // Extract the final text block (last text content after tool use)
    const textBlocks = data.content.filter(b => b.type === "text");
    const rawText = textBlocks.map(b => b.text).join("");

    // Strip any accidental markdown fences
    const clean = rawText.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw: clean, parse_error: true })
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed)
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
