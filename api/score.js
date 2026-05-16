const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { username, score } = req.body;
  if (!username || typeof score !== 'number') {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  try {
    // Only store if it's a personal best
    const current = await kv.zscore('leaderboard', username);
    if (current === null || score > current) {
      await kv.zadd('leaderboard', { score, member: username });
    }

    const rank = await kv.zrevrank('leaderboard', username);
    res.json({ rank: rank + 1 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save score' });
  }
};
