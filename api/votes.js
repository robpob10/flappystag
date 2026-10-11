const { Redis } = require('@upstash/redis');
const { TALLY_KEY, LEGACY_KEYS, toVoteList } = require('./_holiday');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Keys nothing writes to any more (the old Flappy Stag leaderboard, votes from
// before the reset): wipe them once per cold start (deleting an already-gone
// key is a no-op).
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

// One-off (11 Oct 2026): clear Rob's votes, as he asked. The marker key means
// only the first request ever does it, so votes he casts afterwards are safe.
let robCleared = false;
async function clearRobOnce() {
  if (robCleared) return;
  try {
    if (await redis.set('holiday:oneoff:clear-rob-2026-10-11', 1, { nx: true })) {
      const tally = await redis.hgetall(TALLY_KEY);
      const fields = Object.keys(tally || {}).filter(f => f.split('|').slice(3).join('|') === 'Rob');
      if (fields.length) await redis.hdel(TALLY_KEY, ...fields);
    }
    robCleared = true;
  } catch (err) {
    console.error(err);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  await clearLegacy();
  await clearRobOnce();
  try {
    const tally = await redis.hgetall(TALLY_KEY);
    res.setHeader('Cache-Control', 'no-store');
    res.json(toVoteList(tally));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load votes' });
  }
};
