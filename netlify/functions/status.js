/**
 * UPD8.GROUP — Status (Polling)
 *
 * Route: GET /api/status?job_id=xxx
 * Returns: { status: 'processing' | 'complete' | 'error', html?, error? }
 */

const { getStore } = require('@netlify/blobs');

function blobStore() {
  return getStore({
    name:   'upd8-sessions',
    siteID: process.env.NETLIFY_SITE_ID,
    token:  process.env.NETLIFY_TOKEN,
  });
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type':                 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const jobId = event.queryStringParameters && event.queryStringParameters.job_id;
  if (!jobId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'job_id required' }) };

  try {
    const store = blobStore();
    let job;
    try {
      job = await store.get('job/' + jobId, { type: 'json' });
    } catch (_) {
      job = null;
    }

    if (!job) {
      // Job not found yet — still processing (background fn hasn't written yet)
      return { statusCode: 200, headers, body: JSON.stringify({ status: 'processing' }) };
    }

    // Clean up job record once terminal
    if (job.status === 'complete' || job.status === 'error') {
      try { await store.delete('job/' + jobId); } catch (_) {}
    }

    return { statusCode: 200, headers, body: JSON.stringify(job) };

  } catch (err) {
    console.error('Status error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ status: 'error', error: err.message }) };
  }
};
