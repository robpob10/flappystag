const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
  res.json({ rank: board.findIndex(e => e.username === username) + 1 });
});

app.listen(PORT, () => console.log(`Flappy Stag running on http://localhost:${PORT}`));
