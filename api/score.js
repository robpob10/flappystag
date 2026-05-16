const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { username, score } = req.body;
  if (!username || typeof score !== 'number') {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  try {
    const current = await redis.zscore('leaderboard', username);
    if (current === null || score > current) {
      await redis.zadd('leaderboard', { score, member: username });
    }

    const rank = await redis.zrevrank('leaderboard', username);
    res.json({ rank: rank + 1 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save score' });
  }
};
