const crypto = require('crypto');

// The ballot: every pillar in the game is one of these destinations with one
// of these weekends attached. Keep the ids in sync with COUNTRIES / WEEKENDS in
// public/game.js (which holds the shapes, colours and labels).
const COUNTRIES = ['tunisia', 'morocco'];

// Every weekend in March and April 2027, keyed by the Saturday.
const WEEKENDS = [
  '2027-03-06', '2027-03-13', '2027-03-20', '2027-03-27',
  '2027-04-03', '2027-04-10', '2027-04-17', '2027-04-24',
];

// hash: vote id -> { username, country, weekend, at }. Votes are unlimited, so
// each one gets its own id; entries from the one-vote-each days are keyed by
// username instead and still count.
const VOTES_KEY = 'holiday:votes';
const LEGACY_KEYS = ['leaderboard'];  // the old Flappy Stag high scores

// Validates a ballot posted by the game; returns a clean vote or null.
function parseVote(body) {
  const { username, country, weekend } = body || {};
  if (typeof username !== 'string') return null;
  const name = username.trim().slice(0, 20);
  if (!name || !COUNTRIES.includes(country) || !WEEKENDS.includes(weekend)) return null;
  return { username: name, country, weekend };
}

// A fresh hash field for each vote.
function newVoteId() {
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

// Turns the stored vote map into a list, oldest first, dropping anything that
// isn't a current ballot option (e.g. Spain, which has been removed).
function toVoteList(map) {
  const votes = [];
  for (const [field, raw] of Object.entries(map || {})) {
    let v = raw;
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch { continue; }
    }
    if (v && COUNTRIES.includes(v.country) && WEEKENDS.includes(v.weekend)) {
      const username = typeof v.username === 'string' ? v.username : field;
      votes.push({ username, country: v.country, weekend: v.weekend, at: v.at || null });
    }
  }
  return votes.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

module.exports = { COUNTRIES, WEEKENDS, VOTES_KEY, LEGACY_KEYS, parseVote, newVoteId, toVoteList };
