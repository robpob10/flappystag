const { Redis } = require('@upstash/redis');
const { SCORES_KEY, OLD_VOTES_KEY, LEGACY_KEYS, toScoreList } = require('./_holiday');

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
    const [flat, oldVotes] = await Promise.all([
      redis.zrange(SCORES_KEY, 0, -1, { withScores: true }),  // [member, score, ...]
      redis.hgetall(OLD_VOTES_KEY),
    ]);
    const pairs = [];
    for (let i = 0; i < flat.length; i += 2) pairs.push([flat[i], flat[i + 1]]);
    res.setHeader('Cache-Control', 'no-store');
    res.json(toScoreList(pairs, oldVotes));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load votes' });
  }
};
