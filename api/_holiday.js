// The ballot: every pillar in the game is one of these destinations with one
// of these weekends attached. Keep the ids in sync with COUNTRIES / WEEKENDS in
// public/game.js (which holds the shapes, colours and labels).
const COUNTRIES = ['tunisia', 'morocco'];

// Every weekend in March and April 2027, keyed by the Saturday.
const WEEKENDS = [
  '2027-03-06', '2027-03-13', '2027-03-20', '2027-03-27',
  '2027-04-03', '2027-04-10', '2027-04-17', '2027-04-24',
];

// Your score when you crash into a pillar is how many votes you give it. Each
// person's best score per combo is what counts, kept in a sorted set:
// member "country|weekend|username" -> best score.
const SCORES_KEY = 'holiday:scores';
// Votes from before scores counted (a hash of { username, country, weekend }).
// Each still counts as 1 vote unless that person has since scored higher.
const OLD_VOTES_KEY = 'holiday:votes';
const LEGACY_KEYS = ['leaderboard'];  // the old Flappy Stag high scores

const MAX_SCORE = 999;  // sanity cap on what a single run can give

// Validates a vote posted by the game; returns a clean vote or null.
function parseVote(body) {
  const { username, country, weekend, score } = body || {};
  if (typeof username !== 'string') return null;
  const name = username.trim().slice(0, 20);
  if (!name || !COUNTRIES.includes(country) || !WEEKENDS.includes(weekend)) return null;
  if (!Number.isInteger(score) || score < 1 || score > MAX_SCORE) return null;
  return { username: name, country, weekend, score };
}

// Sorted-set member for one person's votes on one combo. Country and weekend
// never contain "|", so splitting on the first two recovers the username.
function voteMember({ username, country, weekend }) {
  return `${country}|${weekend}|${username}`;
}

function parseMember(member) {
  const [country, weekend, ...rest] = String(member).split('|');
  return { country, weekend, username: rest.join('|') };
}

// Builds the list of { username, country, weekend, score } (one per person
// per combo, their best score) from [member, score] pairs plus any old-style
// votes, dropping anything that isn't a current ballot option.
function toScoreList(pairs, oldVotes) {
  const best = new Map();
  const add = (v, score) => {
    if (!v || typeof v.username !== 'string' || !COUNTRIES.includes(v.country) || !WEEKENDS.includes(v.weekend)) return;
    if (!(score > 0)) return;
    const key = voteMember(v);
    const prev = best.get(key);
    if (!prev || score > prev.score) {
      best.set(key, { username: v.username, country: v.country, weekend: v.weekend, score });
    }
  };
  for (const [member, score] of pairs) add(parseMember(member), Number(score));
  for (const [field, raw] of Object.entries(oldVotes || {})) {
    let v = raw;
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch { continue; }
    }
    // the very first version keyed votes by username
    if (v && typeof v.username !== 'string') v = { ...v, username: field };
    add(v, 1);
  }
  return [...best.values()];
}

module.exports = {
  COUNTRIES, WEEKENDS, SCORES_KEY, OLD_VOTES_KEY, LEGACY_KEYS,
  parseVote, voteMember, toScoreList,
};
