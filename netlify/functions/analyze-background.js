/**
 * UPD8.GROUP — Analyze (Background Function)
 *
 * Called directly by the BROWSER (not by another function).
 * Returns 202 immediately. Netlify keeps it running up to 15 min.
 * Stores result in Blobs. Browser polls /api/status for completion.
 *
 * Route: POST /.netlify/functions/analyze-background
 * Body:  { session_id, blob_id, product, tier, job_id }
 */

const Anthropic    = require('@anthropic-ai/sdk');
const { getStore } = require('@netlify/blobs');

const PRODUCT_KEYS = {
  listinglens: process.env.LISTINGLENS_API_KEY,
  vehiclevibe: process.env.VEHICLEVIBE_API_KEY,
  menumelt:    process.env.MENUMELT_API_KEY,
};

const SYSTEM_PROMPT = `You are an expert marketplace listing analyst for the UPD8.GROUP buyer intelligence platform.

Analyse the listing screenshot(s) and produce a comprehensive buyer intelligence report as a standalone HTML document.

AUTO-DETECT the listing category (vehicle, property, electronics, food/menu, or general item) and jurisdiction from the screenshots.

REPORT SECTIONS (all required):

1. WHAT THIS LISTING IS — category, make/model/year or item name, location, price, seller type, platform

2. DISCLOSURE INTENSITY — OPEN / SELECTIVE / GUARDED rating with 2-3 sentence explanation

3. HOW IT PRESENTS ITSELF — key seller claims, what photos show, marketing language used

4. WHAT THE DATA SHOWS — 3-4 comparable listings/sales with prices; price discrepancy as a dollar figure

5. OMISSION ANALYSIS — what's absent, why it matters, what the buyer can't assess without it

6. WHAT'S IN THE LISTING — documentation, condition claims, what photos confirm

7. WHAT IT COSTS TO OWN — line items with estimates, correct jurisdiction rates, first-year total

8. LEVERAGE CONTEXT — days on market, price history, comparable sold prices, listing language signals

9. THE CLOSER SCRIPT — 3 specific questions written exactly as the buyer would say them

10. LISTING COMPLETENESS SCORE — 5 dimensions × 20 points each, total out of 100

11. BUYER CONTEXT — 2-3 sentences on consumer rights for this type/jurisdiction

DESIGN SYSTEM:
\`\`\`css
--mono: 'JetBrains Mono', monospace;
--sans: 'Inter', -apple-system, sans-serif;
--ink: #0f172a; --ink-secondary: #334155; --ink-muted: #64748b;
--surface: #f8fafc; --white: #ffffff; --border: #e2e8f0;
--amber: #d97706; --amber-bg: #fffbeb;
--green: #16803c; --green-bg: #f0fdf4;
--blue: #2563eb; --blue-bg: #eff6ff;
\`\`\`
Layout: max-width 680px, centred, white cards, 1px border, 10px radius, 12px gap.
Section headers: uppercase mono, small, slate coloured, numbered.
Disclosure badge: OPEN=green, SELECTIVE=amber, GUARDED=red-tinted.
Omission items: amber left-border callout cards.
Closer Script: distinct card, green left border, quote styling.
Score: clean table, total row bold.
Dark masthead header card (#0f172a bg, white text) with Report ID, date, category.
Google Fonts: Inter + JetBrains Mono.
Mobile responsive.

Output ONLY valid HTML starting with <!DOCTYPE html>. No markdown. No code fences. No preamble.`;

function blobStore() {
  return getStore({
    name: 'upd8-sessions',
    siteID: process.env.NETLIFY_SITE_ID,
    token:  process.env.NETLIFY_TOKEN,
  });
}

exports.handler = async (event) => {
  const store = blobStore();
  let jobId = null;

  try {
    const body     = JSON.parse(event.body || '{}');
    jobId          = body.job_id;
    const sessionId = body.session_id;
    const blobId    = body.blob_id;
    const product   = (body.product || 'listinglens').toLowerCase();
    const apiKey    = body.api_key;

    if (!jobId || !sessionId || !blobId) {
      console.error('Missing required fields');
      return { statusCode: 202 };
    }

    // Validate API key
    const expectedKey = PRODUCT_KEYS[product];
    if (!expectedKey || apiKey !== expectedKey) {
      console.error('Invalid API key for product:', product);
      await store.setJSON('job/' + jobId, { status: 'error', error: 'Invalid API key' });
      return { statusCode: 202 };
    }

    console.log('Job', jobId, ': starting');
    await store.setJSON('job/' + jobId, { status: 'processing', startedAt: new Date().toISOString() });

    // Retrieve image from Blobs
    let imageBuffer, imageMimeType;
    try {
      const imgBlob = await store.get('img/' + blobId, { type: 'arrayBuffer' });
      const imgMeta = await store.getMetadata('img/' + blobId);
      imageBuffer   = Buffer.from(imgBlob);
      imageMimeType = (imgMeta && imgMeta.metadata && imgMeta.metadata.mimeType) || 'image/jpeg';
    } catch (e) {
      console.error('Job', jobId, ': image retrieval failed:', e.message);
      await store.setJSON('job/' + jobId, { status: 'error', error: 'Image expired or not found. Please re-upload.' });
      return { statusCode: 202 };
    }

    const imageBase64 = imageBuffer.toString('base64');
    const reportId    = 'UPD8-' + Math.random().toString(36).substring(2, 7).toUpperCase();
    const today       = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    const systemPrompt = SYSTEM_PROMPT + '\n\nReport ID: ' + reportId + '\nDate: ' + today + '\nProduct: ' + product;

    console.log('Job', jobId, ': calling Claude');

    const client   = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 6000,
      system:     systemPrompt,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: imageMimeType, data: imageBase64 }
          },
          {
            type: 'text',
            text: 'Analyse this listing and generate the complete buyer intelligence report as standalone HTML.'
          }
        ]
      }]
    });

    let html = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    // Strip markdown fences if Claude added them
    html = html.replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();
    const start = html.indexOf('<!DOCTYPE html>') !== -1 ? html.indexOf('<!DOCTYPE html>') : html.indexOf('<html');
    const end   = html.lastIndexOf('</html>');
    if (start !== -1 && end !== -1) html = html.substring(start, end + 7);

    console.log('Job', jobId, ': storing report (' + html.length + ' chars)');
    await store.setJSON('job/' + jobId, {
      status:      'complete',
      reportId,
      html,
      completedAt: new Date().toISOString()
    });

    // Cleanup image and session
    try {
      await Promise.all([
        store.delete('img/' + blobId),
        store.delete('session/' + sessionId),
      ]);
    } catch (_) {}

    console.log('Job', jobId, ': complete ✓');

  } catch (err) {
    console.error('Job', jobId || '?', 'error:', err.message);
    try {
      if (jobId) await store.setJSON('job/' + jobId, { status: 'error', error: err.message || 'Unknown error' });
    } catch (_) {}
  }

  return { statusCode: 202 };
};
