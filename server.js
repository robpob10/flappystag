const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parseVote, voteMember, toScoreList } = require('./api/_holiday');

const app = express();
const PORT = process.env.PORT || 3000;
const SCORES_FILE = path.join(__dirname, 'scores.json');

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

// member "country|weekend|username" -> best score (mirrors the Redis sorted set)
function readScores() {
  if (!fs.existsSync(SCORES_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8'));
  } catch {
    return {};
  }
}

app.get('/api/votes', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(toScoreList(Object.entries(readScores())));
});

app.post('/api/vote', (req, res) => {
  if (!tokenOK(req.headers['x-vote-token'])) {
    return res.status(401).send('fuck off');
  }

  const vote = parseVote(req.body);
  if (!vote) return res.status(400).json({ error: 'Invalid vote' });

  // Your score is how many votes you give this combo; only your best counts.
  const scores = readScores();
  const member = voteMember(vote);
  const improved = !(scores[member] >= vote.score);
  if (improved) {
    scores[member] = vote.score;
    fs.writeFileSync(SCORES_FILE, JSON.stringify(scores, null, 2));
  }
  res.json({ ok: true, improved, best: scores[member] });
});

app.listen(PORT, () => console.log(`Flappy Holiday running on http://localhost:${PORT}`));
