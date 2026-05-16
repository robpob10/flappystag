const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

module.exports = async function handler(req, res) {
  const raw = await redis.zrange('leaderboard', 0, -1, { withScores: true });
  const toRemove = [];
  for (let i = 0; i < raw.length; i += 2) {
    const member = raw[i];
    const score = Number(raw[i + 1]);
    if (!member || member === 'undefined' || !isFinite(score)) {
      toRemove.push(member);
    }
  }
  if (toRemove.length) await redis.zrem('leaderboard', ...toRemove);
  res.json({ removed: toRemove.length, members: toRemove });
};
