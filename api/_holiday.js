// The ballot: every pillar in the game is one of these destinations with one
// of these weekends attached. Keep the ids in sync with COUNTRIES / WEEKENDS in
// public/game.js (which holds the shapes, colours and labels).
const COUNTRIES = ['tunisia', 'morocco'];

// Every weekend in March and April 2027, keyed by the Saturday.
const WEEKENDS = [
  '2027-03-06', '2027-03-13', '2027-03-20', '2027-03-27',
  '2027-04-03', '2027-04-10', '2027-04-17', '2027-04-24',
];

// Every crash is one vote, up or down, on the pillar you hit, and you can
// vote as often as you like. Counts live in a hash:
// "country|weekend|up|username" -> number of votes.
const TALLY_KEY = 'holiday:tally';
const DIRS = ['up', 'down'];

// Votes from earlier versions (single votes, then best scores per trip). Each
// person's vote on a trip there still counts as one upvote.
const OLD_VOTES_KEY = 'holiday:votes';    // hash of { username, country, weekend }
const OLD_SCORES_KEY = 'holiday:scores';  // sorted set of "country|weekend|username"
const LEGACY_KEYS = ['leaderboard'];      // the old Flappy Stag high scores

// Validates a vote posted by the game; returns a clean vote or null.
function parseVote(body) {
  const { username, country, weekend, dir } = body || {};
  if (typeof username !== 'string') return null;
  const name = username.trim().slice(0, 20);
  if (!name || !COUNTRIES.includes(country) || !WEEKENDS.includes(weekend)) return null;
  if (!DIRS.includes(dir)) return null;
  return { username: name, country, weekend, dir };
}

// Hash field for one person's up (or down) votes on one trip. Country, weekend
// and direction never contain "|", so everything after them is the username.
function tallyField({ country, weekend, dir, username }) {
  return `${country}|${weekend}|${dir}|${username}`;
}

const isOption = v => v && typeof v.username === 'string'
  && COUNTRIES.includes(v.country) && WEEKENDS.includes(v.weekend);

// One row per person per trip, { username, country, weekend, up, down },
// dropping anything that isn't a current ballot option.
function toVoteList(tally, oldScoreMembers, oldVotes) {
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
    if (isOption(v) && DIRS.includes(dir) && count > 0) row(v)[dir] += count;
  }

  // Older votes: one upvote per person per trip, however they were stored.
  const old = new Map();
  for (const member of oldScoreMembers || []) {
    const [country, weekend, ...rest] = String(member).split('|');
    const v = { country, weekend, username: rest.join('|') };
    if (isOption(v)) old.set(`${country}|${weekend}|${v.username}`, v);
  }
  for (const [field, raw] of Object.entries(oldVotes || {})) {
    let v = raw;
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch { continue; }
    }
    if (v && typeof v.username !== 'string') v = { ...v, username: field };  // keyed by name
    if (isOption(v)) old.set(`${v.country}|${v.weekend}|${v.username}`, v);
  }
  for (const v of old.values()) row(v).up += 1;

  return [...rows.values()];
}

module.exports = {
  COUNTRIES, WEEKENDS, TALLY_KEY, OLD_VOTES_KEY, OLD_SCORES_KEY, LEGACY_KEYS,
  parseVote, tallyField, toVoteList,
};
