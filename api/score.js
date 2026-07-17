const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
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

    // Joint placing: everyone with the same score shares the same rank, so a
    // player's rank is the number of players with a STRICTLY higher score + 1
    // (rather than zrevrank, which breaks ties by member and gives 1,2,3,4).
    const best = await redis.zscore('leaderboard', username);
    const higher = await redis.zcount('leaderboard', `(${best}`, '+inf');
    res.json({ rank: higher + 1 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save score' });
  }
};
