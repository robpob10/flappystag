const { Redis } = require('@upstash/redis');
const { TALLY_KEY, OLD_VOTES_KEY, OLD_SCORES_KEY, LEGACY_KEYS, toVoteList } = require('./_holiday');

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
    const [tally, oldScoreMembers, oldVotes] = await Promise.all([
      redis.hgetall(TALLY_KEY),
      redis.zrange(OLD_SCORES_KEY, 0, -1),
      redis.hgetall(OLD_VOTES_KEY),
    ]);
    res.setHeader('Cache-Control', 'no-store');
    res.json(toVoteList(tally, oldScoreMembers, oldVotes));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load votes' });
  }
};
