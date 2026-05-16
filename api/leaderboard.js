const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const raw = await redis.zrange('leaderboard', 0, 19, { rev: true, withScores: true });
    // @upstash/redis returns [{member, score}, ...] with withScores
    const entries = raw.map(e => ({ username: e.member, score: e.score }));
    res.json(entries);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
};
