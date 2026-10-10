const { Redis } = require('@upstash/redis');
const { VOTES_KEY, LEGACY_KEYS, toVoteList } = require('./_holiday');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// The old Flappy Stag leaderboard isn't needed now the game is a holiday vote:
// wipe it once per cold start (deleting an already-gone key is a no-op).
let legacyCleared = false;
async function clearLegacy() {
  if (legacyCleared) return;
  try {
    await redis.del(...LEGACY_KEYS);
    legacyCleared = true;
  } catch (err) {
    console.error(err);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  await clearLegacy();
  try {
    const map = await redis.hgetall(VOTES_KEY);
    res.setHeader('Cache-Control', 'no-store');
    res.json(toVoteList(map));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load votes' });
  }
};
