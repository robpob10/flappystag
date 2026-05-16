const { kv } = require('@vercel/kv');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const raw = await kv.zrange('leaderboard', 0, 19, { rev: true, withScores: true });
    // raw is a flat array: [member, score, member, score, ...]
    const entries = [];
    for (let i = 0; i < raw.length; i += 2) {
      entries.push({ username: raw[i], score: Number(raw[i + 1]) });
    }
    res.json(entries);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
};
