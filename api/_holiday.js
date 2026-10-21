// The ballot: every pillar in the game is one of these destinations. Keep the
// ids in sync with COUNTRIES in public/game.js (which holds the shapes, colours
// and labels).
const COUNTRIES = ['france', 'tunisia', 'morocco'];

// Each person gets one vote per country, up or down; voting again switches it.
// Votes live in a hash: "country|up|username" -> 1, and casting one removes
// that person's opposite field for the country.
// (A fresh key: all results were reset to 0 on 21 Oct 2026.)
const TALLY_KEY = 'holiday:tally3';
const DIRS = ['up', 'down'];

// Keys nothing uses any more, deleted by /api/votes: the old Flappy Stag high
// scores and every earlier version's votes, cleared by the resets.
const LEGACY_KEYS = ['leaderboard', 'holiday:votes', 'holiday:scores', 'holiday:tally', 'holiday:tally2'];

// Validates a vote posted by the game; returns a clean vote or null.
function parseVote(body) {
  const { username, country, dir } = body || {};
  if (typeof username !== 'string') return null;
  const name = username.trim().slice(0, 20);
  if (!name || !COUNTRIES.includes(country)) return null;
  if (!DIRS.includes(dir)) return null;
  return { username: name, country, dir };
}

// Hash field for one person's up (or down) vote on one country. Country and
// direction never contain "|", so everything after them is the username.
function tallyField({ country, dir, username }) {
  return `${country}|${dir}|${username}`;
}

const opposite = dir => (dir === 'up' ? 'down' : 'up');

const isOption = v => v && typeof v.username === 'string' && COUNTRIES.includes(v.country);

// One row per person per country, { username, country, up, down }, dropping
// anything that isn't a current ballot option.
function toVoteList(tally) {
  const rows = new Map();
  const row = v => {
    const key = `${v.country}|${v.username}`;
    if (!rows.has(key)) rows.set(key, { username: v.username, country: v.country, up: 0, down: 0 });
    return rows.get(key);
  };

  for (const [field, n] of Object.entries(tally || {})) {
    const [country, dir, ...rest] = String(field).split('|');
    const v = { country, username: rest.join('|') };
    const count = Number(n);
    if (isOption(v) && DIRS.includes(dir) && count > 0) row(v)[dir] = 1;  // one vote each
  }

  return [...rows.values()];
}

module.exports = {
  COUNTRIES, TALLY_KEY, LEGACY_KEYS,
  parseVote, tallyField, opposite, toVoteList,
};
