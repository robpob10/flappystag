const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard.json');

const SECRET = process.env.SCORE_SECRET || process.env.KV_REST_API_TOKEN || 'flappy-dev-secret';
const TTL_MS = 120000;
const usedNonces = new Set(); // single-use tokens (in-memory for local dev)

function sign(data) {
  return crypto.createHmac('sha256', SECRET).update(data).digest('hex');
}

function safeEq(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function tokenOK(token) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [exp, nonce, sig] = parts;
  if (!safeEq(sig, sign(`${exp}.${nonce}`))) return false;
  const expNum = Number(exp);
  const now = Date.now();
  if (!Number.isFinite(expNum) || expNum < now || expNum > now + 130000) return false;
  if (usedNonces.has(nonce)) return false;
  usedNonces.add(nonce);
  setTimeout(() => usedNonces.delete(nonce), 200000).unref?.();
  return true;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/token', (req, res) => {
  const exp = Date.now() + TTL_MS;
  const nonce = crypto.randomBytes(9).toString('hex');
  const payload = `${exp}.${nonce}`;
  res.set('Cache-Control', 'no-store');
  res.json({ token: `${payload}.${sign(payload)}` });
});

function readLeaderboard() {
  if (!fs.existsSync(LEADERBOARD_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeLeaderboard(data) {
  fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(data, null, 2));
}

app.get('/api/leaderboard', (req, res) => {
  const board = readLeaderboard();
  res.json(board.slice(0, 20));
});

app.post('/api/score', (req, res) => {
  if (!tokenOK(req.headers['x-score-token'])) {
    return res.status(401).send('fuck off');
  }

  const { username, score } = req.body;
  if (!username || typeof score !== 'number') {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const board = readLeaderboard();
  const existing = board.find(e => e.username === username);
  if (existing) {
    if (score > existing.score) {
      existing.score = score;
      existing.date = new Date().toISOString();
    }
  } else {
    board.push({ username, score, date: new Date().toISOString() });
  }

  board.sort((a, b) => b.score - a.score);
  writeLeaderboard(board);

  // Joint placing: rank is the number of players with a strictly higher score
  // + 1, so tied players share the same rank.
  const best = board.find(e => e.username === username).score;
  const rank = board.filter(e => e.score > best).length + 1;
  res.json({ rank });
});

app.listen(PORT, () => console.log(`Flappy Stag running on http://localhost:${PORT}`));
