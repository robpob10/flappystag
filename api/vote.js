const crypto = require('crypto');
const { Redis } = require('@upstash/redis');
const { TALLY_KEY, parseVote, tallyField } = require('./_holiday');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const SECRET = process.env.SCORE_SECRET || process.env.KV_REST_API_TOKEN || 'flappy-dev-secret';

function sign(data) {
  return crypto.createHmac('sha256', SECRET).update(data).digest('hex');
}

function safeEq(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// A vote is only accepted with a token from /api/token that is correctly
// signed, unexpired, and not already used. This stops votes being POSTed
// directly (e.g. via curl) without going through the game.
async function tokenOK(token) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [exp, nonce, sig] = parts;
  if (!safeEq(sig, sign(`${exp}.${nonce}`))) return false;      // forged/tampered
  const expNum = Number(exp);
  const now = Date.now();
  if (!Number.isFinite(expNum) || expNum < now || expNum > now + 130000) return false; // expired
  try {
    // single-use: the first submission to claim this nonce wins; replays fail
    const claimed = await redis.set(`usedtok:${nonce}`, 1, { nx: true, ex: 200 });
    return claimed !== null;
  } catch {
    return true; // Redis hiccup: signature + expiry already validated, don't block real voters
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  if (!(await tokenOK(req.headers['x-vote-token']))) {
    return res.status(401).send('fuck off');
  }

  const vote = parseVote(req.body);
  if (!vote) return res.status(400).json({ error: 'Invalid vote' });

  try {
    // One vote per crash, up or down, as many times as you like.
    await redis.hincrby(TALLY_KEY, tallyField(vote), 1);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save vote' });
  }
};
