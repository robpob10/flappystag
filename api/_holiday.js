// The ballot: every pillar in the game is one of these destinations with one
// of these weekends attached. Keep the ids in sync with COUNTRIES / WEEKENDS in
// public/game.js (which holds the shapes, colours and labels).
const COUNTRIES = ['tunisia', 'morocco', 'spain'];

// Every weekend in March and April 2027, keyed by the Saturday.
const WEEKENDS = [
  '2027-03-06', '2027-03-13', '2027-03-20', '2027-03-27',
  '2027-04-03', '2027-04-10', '2027-04-17', '2027-04-24',
];

const VOTES_KEY = 'holiday:votes';    // hash: username -> { country, weekend, at }
const LEGACY_KEYS = ['leaderboard'];  // the old Flappy Stag high scores

// Validates a ballot posted by the game; returns a clean vote or null.
function parseVote(body) {
  const { username, country, weekend } = body || {};
  if (typeof username !== 'string') return null;
  const name = username.trim().slice(0, 20);
  if (!name || !COUNTRIES.includes(country) || !WEEKENDS.includes(weekend)) return null;
  return { username: name, country, weekend };
}

// Turns the stored username -> vote map into a list sorted by name, dropping
// anything that isn't a current ballot option.
function toVoteList(map) {
  const votes = [];
  for (const [username, raw] of Object.entries(map || {})) {
    let v = raw;
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch { continue; }
    }
    if (v && COUNTRIES.includes(v.country) && WEEKENDS.includes(v.weekend)) {
      votes.push({ username, country: v.country, weekend: v.weekend, at: v.at || null });
    }
  }
  return votes.sort((a, b) => a.username.localeCompare(b.username));
}

module.exports = { COUNTRIES, WEEKENDS, VOTES_KEY, LEGACY_KEYS, parseVote, toVoteList };
