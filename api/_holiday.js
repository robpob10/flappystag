// The ballot: every pillar in the game is one of these destinations with one
// of these weekends attached. Keep the ids in sync with COUNTRIES / WEEKENDS in
// public/game.js (which holds the shapes, colours and labels).
const COUNTRIES = ['tunisia', 'morocco'];

// Every weekend in March and April 2027, keyed by the Saturday.
const WEEKENDS = [
  '2027-03-06', '2027-03-13', '2027-03-20', '2027-03-27',
  '2027-04-03', '2027-04-10', '2027-04-17', '2027-04-24',
];

// hash: "country|weekend|username" -> { username, country, weekend, at }.
// Everyone can back as many combos as they like, but each combo only once.
// (Older entries are keyed by username or a random id; toVoteList folds any
// repeats among them into one vote.)
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

// The hash field for a vote: one per person per country + weekend combo.
// Country and weekend never contain "|", so this can't collide.
function voteField({ username, country, weekend }) {
  return `${country}|${weekend}|${username}`;
}

// Turns the stored vote map into a list, oldest first: one vote per person per
// combo, dropping anything that isn't a current ballot option (e.g. Spain,
// which has been removed).
function toVoteList(map) {
  const votes = new Map();
  for (const [field, raw] of Object.entries(map || {})) {
    let v = raw;
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch { continue; }
    }
    if (v && COUNTRIES.includes(v.country) && WEEKENDS.includes(v.weekend)) {
      const vote = {
        username: typeof v.username === 'string' ? v.username : field,
        country: v.country,
        weekend: v.weekend,
        at: v.at || null,
      };
      const key = voteField(vote);
      const seen = votes.get(key);
      if (!seen || String(vote.at) < String(seen.at)) votes.set(key, vote);
    }
  }
  return [...votes.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

module.exports = { COUNTRIES, WEEKENDS, VOTES_KEY, LEGACY_KEYS, parseVote, voteField, toVoteList };
