const crypto = require('crypto');

// Shared secret lives server-side only. Reuse the Upstash token if no dedicated
// SCORE_SECRET is configured, so this works without extra env setup.
const SECRET = process.env.SCORE_SECRET || process.env.KV_REST_API_TOKEN || 'flappy-dev-secret';
const TTL_MS = 120000; // tokens are valid for 2 minutes

function sign(data) {
  return crypto.createHmac('sha256', SECRET).update(data).digest('hex');
}

// Issues a short-lived, signed, single-use token that /api/score requires.
// The game fetches one right before submitting a score; a raw curl to
// /api/score without a valid token is rejected.
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const exp = Date.now() + TTL_MS;
  const nonce = crypto.randomBytes(9).toString('hex');
  const payload = `${exp}.${nonce}`;
  res.setHeader('Cache-Control', 'no-store');
  res.json({ token: `${payload}.${sign(payload)}` });
};
