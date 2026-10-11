// The ballot: every pillar in the game is one of these destinations with one
// of these weekends attached. Keep the ids in sync with COUNTRIES / WEEKENDS in
// public/game.js (which holds the shapes, colours and labels).
const COUNTRIES = ['tunisia', 'morocco'];

// Long weekends (Fri–Mon) in March and April 2027, keyed by the Saturday.
// 12–15 Mar is out: the organiser can't make it.
const WEEKENDS = [
  '2027-03-06', '2027-03-20', '2027-03-27',
  '2027-04-03', '2027-04-10', '2027-04-17', '2027-04-24',
];

// Each person gets one vote per option (country + weekend), up or down; voting
// again switches it. Votes live in a hash: "country|weekend|up|username" -> 1,
// and casting one removes that person's opposite field for the option.
// (A fresh key: all results were reset to 0 on 11 Oct 2026.)
const TALLY_KEY = 'holiday:tally2';
const DIRS = ['up', 'down'];

// Keys nothing uses any more, deleted by /api/votes: the old Flappy Stag high
// scores and every earlier version's votes, cleared by the reset.
const LEGACY_KEYS = ['leaderboard', 'holiday:votes', 'holiday:scores', 'holiday:tally'];

// Validates a vote posted by the game; returns a clean vote or null.
function parseVote(body) {
  const { username, country, weekend, dir } = body || {};
  if (typeof username !== 'string') return null;
  const name = username.trim().slice(0, 20);
  if (!name || !COUNTRIES.includes(country) || !WEEKENDS.includes(weekend)) return null;
  if (!DIRS.includes(dir)) return null;
  return { username: name, country, weekend, dir };
}

// Hash field for one person's up (or down) vote on one trip. Country, weekend
// and direction never contain "|", so everything after them is the username.
function tallyField({ country, weekend, dir, username }) {
  return `${country}|${weekend}|${dir}|${username}`;
}

const opposite = dir => (dir === 'up' ? 'down' : 'up');

const isOption = v => v && typeof v.username === 'string'
  && COUNTRIES.includes(v.country) && WEEKENDS.includes(v.weekend);

// One row per person per trip, { username, country, weekend, up, down },
// dropping anything that isn't a current ballot option.
function toVoteList(tally) {
  const rows = new Map();
  const row = v => {
    const key = `${v.country}|${v.weekend}|${v.username}`;
    if (!rows.has(key)) rows.set(key, { username: v.username, country: v.country, weekend: v.weekend, up: 0, down: 0 });
    return rows.get(key);
  };

  for (const [field, n] of Object.entries(tally || {})) {
    const [country, weekend, dir, ...rest] = String(field).split('|');
    const v = { country, weekend, username: rest.join('|') };
    const count = Number(n);
    if (isOption(v) && DIRS.includes(dir) && count > 0) row(v)[dir] = 1;  // one vote each
  }

  return [...rows.values()];
}

module.exports = {
  COUNTRIES, WEEKENDS, TALLY_KEY, LEGACY_KEYS,
  parseVote, tallyField, opposite, toVoteList,
};
