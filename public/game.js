// ── Config ────────────────────────────────────────────────────────────────────
const CFG = {
  width: 400,
  height: 600,
  gravity: 0.5,
  flapForce: -9,
  pipeGap: 170,
  pipeSpeed: 2.8,
  pipeSpawnInterval: 90,  // frames
  minPillarH: 90,         // shortest pillar section, so the countries stay readable
  pillarW: 130,           // widest a country is drawn (also the column width)
  stemW: 26,              // pole joining a short country to the screen edge
  groundHeight: 80,
  birdW: 64,
  birdH: 64,
  birdRadius: 28,  // circular hitbox radius (sprite stays square)
};

// ── Asset paths (swap these to change sprites) ────────────────────────────────
const ASSETS = {
  birdUp:   'assets/bird_up.png',
  birdDown: 'assets/bird_down.png',
};

// ── Holiday ballot ────────────────────────────────────────────────────────────
// Every pillar is one of these countries (outlines in shapes.js) with a random
// weekend attached; the bird votes by crashing into one. Ids must match
// api/_holiday.js.
const COUNTRIES = [
  { id: 'tunisia', name: 'Tunisia', flag: '🇹🇳', fill: '#e4312b', edge: '#8f1712', ink: '#fff' },
  { id: 'morocco', name: 'Morocco', flag: '🇲🇦', fill: '#1f8a4c', edge: '#0f5130', ink: '#fff' },
];
const COUNTRY_BY_ID = Object.fromEntries(COUNTRIES.map(c => [c.id, c]));

// Every weekend in March and April 2027, keyed by the Saturday.
const WEEKENDS = [
  '2027-03-06', '2027-03-13', '2027-03-20', '2027-03-27',
  '2027-04-03', '2027-04-10', '2027-04-17', '2027-04-24',
];
const EASTER_WEEKEND = '2027-03-27';  // Easter Sunday is 28 March 2027

const MONTHS      = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                     'August', 'September', 'October', 'November', 'December'];

function weekendDays(id) {
  const sat = new Date(`${id}T00:00:00Z`);
  return [sat, new Date(sat.getTime() + 86400000)];
}

// "6–7 Mar" (or "31 Jul – 1 Aug" across a month end)
function weekendLabel(id) {
  const [sat, sun] = weekendDays(id);
  const sm = MONTHS[sat.getUTCMonth()], um = MONTHS[sun.getUTCMonth()];
  return sm === um
    ? `${sat.getUTCDate()}–${sun.getUTCDate()} ${um}`
    : `${sat.getUTCDate()} ${sm} – ${sun.getUTCDate()} ${um}`;
}

// "Sat 27 – Sun 28 March 2027 (Easter)"
function weekendLongLabel(id) {
  const [sat, sun] = weekendDays(id);
  const satPart = sat.getUTCMonth() === sun.getUTCMonth()
    ? `Sat ${sat.getUTCDate()}`
    : `Sat ${sat.getUTCDate()} ${MONTHS_LONG[sat.getUTCMonth()]}`;
  const easter = id === EASTER_WEEKEND ? ' (Easter)' : '';
  return `${satPart} – Sun ${sun.getUTCDate()} ${MONTHS_LONG[sun.getUTCMonth()]} ${sun.getUTCFullYear()}${easter}`;
}

function voteLabel(v) {
  const c = COUNTRY_BY_ID[v.country];
  return `${c.flag} ${c.name} · ${weekendLabel(v.weekend)}`;
}

// Area centroid of each outline (normalised units) — where the date label and
// stem go, since it's reliably inside the shape.
for (const shape of Object.values(COUNTRY_SHAPES)) {
  const p = shape.pts;
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const cross = p[j] * p[i + 1] - p[i] * p[j + 1];
    a  += cross;
    cx += (p[j] + p[i]) * cross;
    cy += (p[j + 1] + p[i + 1]) * cross;
  }
  shape.cx = cx / (3 * a);
  shape.cy = cy / (3 * a);
}

// ── Sound effects (swap these to change sounds) ───────────────────────────────
// Provide each clip in AAC (.m4a) and Ogg. iOS Safari cannot decode the Ogg
// container at all, so AAC is listed first; other engines that lack AAC (some
// Firefox / codec-less Chromium builds) fall through to Ogg. We don't trust
// canPlayType — it reports "maybe" and then fails — so the actual decode drives
// the choice: try each source until one decodes.
const SOUND_SOURCES = {
  flap: ['assets/flap.m4a', 'assets/flap.ogg'],  // plays on each flap/click
  die:  ['assets/die.m4a',  'assets/die.ogg'],   // plays on death
};

// Each clip is decoded ONCE into an AudioBuffer; playback then spins up a
// throwaway BufferSource (cheap, no decode, no per-play media element). This
// avoids the main-thread hitch of cloning/decoding an <audio> element on every
// flap. Falls back to a small round-robin <audio> pool if Web Audio is absent.
let audioCtx = null;
const audioBuffers = {};   // name -> AudioBuffer (Web Audio path)
const audioPools   = {};   // name -> { els, i } (fallback path)

// decodeAudioData across engines: modern browsers return a promise; older
// iOS/Safari (webkitAudioContext) only supports the callback form.
function decode(ctx, arrayBuf) {
  return new Promise((resolve, reject) => {
    const ret = ctx.decodeAudioData(arrayBuf, resolve, reject);
    if (ret && typeof ret.then === 'function') ret.then(resolve, reject);
  });
}

// Try each source URL until one both fetches and decodes; store the buffer.
async function loadBuffer(name, urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url);
      const arr = await res.arrayBuffer();
      audioBuffers[name] = await decode(audioCtx, arr.slice(0));
      return;
    } catch { /* format not decodable here — try the next one */ }
  }
}

function initAudio() {
  // Always resume within the user gesture that called us — iOS starts the
  // context suspended and only unlocks it inside a gesture handler.
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  if (audioCtx !== null) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    for (const [name, urls] of Object.entries(SOUND_SOURCES)) {
      loadBuffer(name, urls);
    }
  } else {
    audioCtx = false;  // Web Audio unavailable — build the fallback pools
    for (const [name, urls] of Object.entries(SOUND_SOURCES)) {
      const els = Array.from({ length: 4 }, () => {
        const a = new Audio();
        // let the element negotiate a playable source
        for (const url of urls) {
          const s = document.createElement('source');
          s.src = url;
          s.type = url.endsWith('.m4a') ? 'audio/mp4' : 'audio/ogg';
          a.appendChild(s);
        }
        a.preload = 'auto';
        return a;
      });
      audioPools[name] = { els, i: 0 };
    }
  }
}

function playSound(name) {
  if (muted) return;
  try {
    if (audioCtx && audioBuffers[name]) {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const src = audioCtx.createBufferSource();
      src.buffer = audioBuffers[name];
      src.connect(audioCtx.destination);
      src.start();
      return;
    }
    const pool = audioPools[name];
    if (pool) {
      const a = pool.els[pool.i];
      pool.i = (pool.i + 1) % pool.els.length;
      a.currentTime = 0;
      a.play().catch(() => {});
    }
  } catch { /* audio unsupported — fail silently */ }
}

// ── State ─────────────────────────────────────────────────────────────────────
let username = localStorage.getItem('flappy_username') || '';
let muted = localStorage.getItem('flappy_muted') === '1';
let myVotes = new Set();  // "country|weekend" combos this player has voted for
// Keys from earlier versions (Flappy Stag high scores, single-vote cache).
localStorage.removeItem('flappy_best');
localStorage.removeItem('flappy_best_synced');
localStorage.removeItem('holiday_vote');

let bird, pipes, score, frame, gameState, animFrame;
// gameState: 'waiting' | 'playing' | 'dead'
let crashed = null;  // { country, weekend } of the pillar hit this round, if any

// ── Canvas setup ──────────────────────────────────────────────────────────────
const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');
canvas.width  = CFG.width;
canvas.height = CFG.height;

// ── Image loading ─────────────────────────────────────────────────────────────
const imgBirdUp   = new Image();
const imgBirdDown = new Image();
let birdUpLoaded = false, birdDownLoaded = false;
imgBirdUp.onload    = () => { birdUpLoaded   = true; };
imgBirdUp.onerror   = () => { birdUpLoaded   = false; };
imgBirdDown.onload  = () => { birdDownLoaded = true; };
imgBirdDown.onerror = () => { birdDownLoaded = false; };
imgBirdUp.src   = ASSETS.birdUp;
imgBirdDown.src = ASSETS.birdDown;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const usernameModal    = document.getElementById('username-modal');
const usernameInput    = document.getElementById('username-input');
const usernameBtn      = document.getElementById('username-btn');
const playerNameEl     = document.getElementById('player-name');
const startScreen      = document.getElementById('start-screen');
const myVoteDisplay    = document.getElementById('my-vote-display');
const gameOverScreen   = document.getElementById('game-over-screen');
const crashTitle       = document.getElementById('crash-title');
const crashSub         = document.getElementById('crash-sub');
const crashCard        = document.getElementById('crash-card');
const crashCountry     = document.getElementById('crash-country');
const crashWeekend     = document.getElementById('crash-weekend');
const voteStatus       = document.getElementById('vote-status');
const voteBtn          = document.getElementById('vote-btn');
const restartBtn       = document.getElementById('restart-btn');
const resultsBtn       = document.getElementById('results-btn');
const resultsPanel     = document.getElementById('results-panel');
const resultsLeader    = document.getElementById('results-leader');
const resultsCountries = document.getElementById('results-countries');
const resultsWeekends  = document.getElementById('results-weekends');
const resultsVoters    = document.getElementById('results-voters');
const closeResults     = document.getElementById('close-results');
const showResultsBtn   = document.getElementById('show-results-btn');
const muteBtn          = document.getElementById('mute-btn');

// ── Mute toggle ───────────────────────────────────────────────────────────────
function renderMute() {
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.classList.toggle('muted', muted);
  muteBtn.setAttribute('aria-pressed', String(muted));
  muteBtn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
}

function toggleMute() {
  muted = !muted;
  localStorage.setItem('flappy_muted', muted ? '1' : '0');
  renderMute();
}

muteBtn.addEventListener('click', toggleMute);
renderMute();

// ── Username flow ─────────────────────────────────────────────────────────────
function initUsername() {
  if (username) {
    usernameModal.classList.add('hidden');
    playerNameEl.textContent = username;
  } else {
    usernameModal.classList.remove('hidden');
  }
}

usernameBtn.addEventListener('click', confirmUsername);
usernameInput.addEventListener('keydown', e => { if (e.key === 'Enter') confirmUsername(); });

function confirmUsername() {
  const val = usernameInput.value.trim();
  if (!val) { usernameInput.focus(); return; }
  username = val;
  localStorage.setItem('flappy_username', username);
  playerNameEl.textContent = username;
  usernameModal.classList.add('hidden');
  syncMyVotes();
}

// ── Game init ─────────────────────────────────────────────────────────────────
function initGame() {
  bird = {
    x: 80,
    y: CFG.height / 2 - CFG.birdH / 2,
    vy: 0,
    rotation: 0,
  };
  pipes   = [];
  score   = 0;
  frame   = 0;
  crashed = null;
  deck    = shuffledDeck();
  gameState = 'waiting';

  renderMyVotes();
  startScreen.classList.remove('hidden');
  gameOverScreen.classList.add('hidden');
  resultsPanel.classList.add('hidden');
}

const comboKey = v => `${v.country}|${v.weekend}`;

function renderMyVotes() {
  myVoteDisplay.textContent = myVotes.size
    ? `You've voted for ${myVotes.size} of ${COUNTRIES.length * WEEKENDS.length} trips — crash into more to add them`
    : '';
}

// ── Input ─────────────────────────────────────────────────────────────────────
function flap() {
  initAudio();  // first user gesture: create/resume the audio context
  if (gameState === 'waiting') {
    gameState = 'playing';
    startScreen.classList.add('hidden');
  }
  if (gameState === 'playing') {
    bird.vy = CFG.flapForce;
    playSound('flap');
  }
  if (gameState === 'dead') return;
}

document.addEventListener('keydown', e => {
  if (e.target === usernameInput) return;  // let the name box take spaces
  if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); flap(); }
});
canvas.addEventListener('click',     flap);
canvas.addEventListener('touchstart', e => { e.preventDefault(); flap(); }, { passive: false });

voteBtn.addEventListener('click', castVote);
restartBtn.addEventListener('click', () => { initGame(); startLoop(); });
resultsBtn.addEventListener('click', showResults);
showResultsBtn.addEventListener('click', showResults);
// Back to whatever was underneath (e.g. a crash still waiting to be voted on).
closeResults.addEventListener('click', () => resultsPanel.classList.add('hidden'));

// ── Pillar logic ──────────────────────────────────────────────────────────────
// Every country + weekend combo, shuffled. Pillars are dealt from it two at a
// time, so every combo turns up before any repeats, in a different random
// order each game; it's reshuffled whenever it runs out.
let deck = [];

function shuffledDeck() {
  const d = [];
  for (const country of COUNTRIES) for (const weekend of WEEKENDS) d.push({ country, weekend });
  for (let i = d.length - 1; i > 0; i--) {  // Fisher–Yates
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// Two different combos for one gap's top and bottom pillars.
function dealPair() {
  if (deck.length < 2) deck = shuffledDeck();
  return [deck.pop(), deck.pop()];
}

// Lays out one pillar in its column's local coordinates (x from the column's
// left edge). The country keeps its proportions, is centred in the column and
// hugs the gap; if it's shorter than its section, a stem in the same colour
// joins it to the screen edge.
function makePillar(country, weekend, isTop, sectionY, sectionH) {
  const shape = COUNTRY_SHAPES[country.id];
  const h  = Math.min(sectionH, CFG.pillarW / shape.aspect);
  const w  = h * shape.aspect;
  const x0 = (CFG.pillarW - w) / 2;
  const y0 = isTop ? sectionY + sectionH - h : sectionY;
  const pts = shape.pts.map((v, i) => (i % 2 ? y0 + v * h : x0 + v * w));
  const cx = x0 + shape.cx * w;
  const cy = y0 + shape.cy * h;

  const path = new Path2D();
  path.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1]);
  path.closePath();

  let stem = null;
  if (sectionH - h > 1) {
    const sx = cx - CFG.stemW / 2;
    stem = isTop
      ? { x: sx, y: sectionY, w: CFG.stemW, h: cy - sectionY }
      : { x: sx, y: cy, w: CFG.stemW, h: sectionY + sectionH - cy };
  }

  return { country, weekend, label: weekendLabel(weekend), pts, path, stem, cx, cy };
}

function spawnPipe() {
  const groundTop = CFG.height - CFG.groundHeight;
  const minY = CFG.minPillarH;
  const maxY = groundTop - CFG.pipeGap - CFG.minPillarH;
  const topH = Math.random() * (maxY - minY) + minY;
  const gapBottom = topH + CFG.pipeGap;

  const [top, bottom] = dealPair();

  pipes.push({
    x: CFG.width,
    scored: false,
    top:    makePillar(top.country, top.weekend, true, 0, topH),
    bottom: makePillar(bottom.country, bottom.weekend, false, gapBottom, groundTop - gapBottom),
  });
}

// ── Collision ─────────────────────────────────────────────────────────────────
// Circle vs axis-aligned rectangle: true when the rectangle's closest point to
// the circle centre lies within the radius.
function circleHitsRect(cx, cy, r, rx, ry, rw, rh) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

// Circle vs polygon (flat [x0, y0, x1, y1, …]): the centre is inside, or some
// edge passes within the radius.
function circleHitsPoly(cx, cy, r, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const ax = pts[j], ay = pts[j + 1], bx = pts[i], by = pts[i + 1];
    if ((by > cy) !== (ay > cy) && cx < ((ax - bx) * (cy - by)) / (ay - by) + bx) inside = !inside;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / len2)) : 0;
    const ex = cx - (ax + t * dx), ey = cy - (ay + t * dy);
    if (ex * ex + ey * ey < r * r) return true;
  }
  return inside;
}

function hitsPillar(cx, cy, r, pl) {
  if (pl.stem && circleHitsRect(cx, cy, r, pl.stem.x, pl.stem.y, pl.stem.w, pl.stem.h)) return true;
  return circleHitsPoly(cx, cy, r, pl.pts);
}

// What the bird hit: 'ground', 'sky', a pillar, or null.
function checkCollision() {
  const cx = bird.x + CFG.birdW / 2;   // circle centre
  const cy = bird.y + CFG.birdH / 2;
  const r  = CFG.birdRadius;
  const groundTop = CFG.height - CFG.groundHeight;

  if (cy + r >= groundTop) return 'ground';
  if (cy - r <= 0) return 'sky';

  for (const p of pipes) {
    const lx = cx - p.x;  // bird in the column's local coordinates
    if (lx + r < 0 || lx - r > CFG.pillarW) continue;
    if (hitsPillar(lx, cy, r, p.top)) return p.top;
    if (hitsPillar(lx, cy, r, p.bottom)) return p.bottom;
  }
  return null;
}

// ── Votes ─────────────────────────────────────────────────────────────────────
async function submitVote(vote) {
  try {
    // Fetch a one-time play token, then vote with it. The server rejects
    // votes without a valid token, which blocks manual/curl submissions.
    const tRes = await fetch('/api/token');
    if (!tRes.ok) return null;
    const { token } = await tRes.json();

    const res = await fetch('/api/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-vote-token': token },
      body: JSON.stringify({ username, country: vote.country, weekend: vote.weekend }),
    });
    if (!res.ok) return null;
    return await res.json();  // { ok, already }
  } catch {
    return null;  // offline / network error — nothing was recorded server-side
  }
}

async function fetchVotes() {
  try {
    const res = await fetch('/api/votes', { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function countMyVotes(votes) {
  if (!username) return;
  myVotes = new Set(votes.filter(v => v.username === username).map(comboKey));
  renderMyVotes();
}

async function syncMyVotes() {
  if (!username) return;
  const votes = await fetchVotes();
  if (votes) countMyVotes(votes);
}

async function castVote() {
  if (!crashed) return;
  if (!username) { usernameModal.classList.remove('hidden'); return; }
  const vote = crashed;
  voteBtn.disabled = true;
  voteBtn.textContent = 'Saving…';
  const result = await submitVote(vote);
  voteBtn.disabled = false;
  voteBtn.textContent = 'Vote for this';
  if (result) {
    // You can back as many trips as you like, but each one only once.
    myVotes.add(comboKey(vote));
    renderMyVotes();
    voteBtn.classList.add('hidden');
    voteStatus.textContent = result.already
      ? "You've already voted for this one 👍"
      : 'Vote saved! 🎉 Crash into other trips to vote for them too.';
  } else {
    voteStatus.textContent = "Couldn't save your vote — check your connection and try again.";
  }
}

// ── Results ───────────────────────────────────────────────────────────────────
function barRow(label, count, max) {
  const li = document.createElement('li');
  const name = document.createElement('span');
  name.textContent = label;
  const bar = document.createElement('div');
  bar.className = 'bar';
  const fill = document.createElement('span');
  fill.style.width = max ? `${(count / max) * 100}%` : '0';
  bar.appendChild(fill);
  const num = document.createElement('span');
  num.className = 'count';
  num.textContent = count;
  li.append(name, bar, num);
  return li;
}

function renderResults(votes) {
  const byCountry = {}, byWeekend = {}, byCombo = {};
  for (const v of votes) {
    byCountry[v.country] = (byCountry[v.country] || 0) + 1;
    byWeekend[v.weekend] = (byWeekend[v.weekend] || 0) + 1;
    const key = `${v.country}|${v.weekend}`;
    byCombo[key] = (byCombo[key] || 0) + 1;
  }

  if (!votes.length) {
    resultsLeader.textContent = 'No votes yet — go crash into somewhere!';
  } else {
    const top = Math.max(...Object.values(byCombo));
    const leaders = Object.keys(byCombo).filter(k => byCombo[k] === top).map(k => {
      const [country, weekend] = k.split('|');
      return voteLabel({ country, weekend });
    });
    // Each person can vote for a trip once, so a trip's count is how many
    // people are up for it.
    const people = new Set(votes.map(v => v.username)).size;
    const peopleLabel = n => `${n} ${n === 1 ? 'person' : 'people'}`;
    resultsLeader.textContent = leaders.length === 1
      ? `Leading: ${leaders[0]} (${top} of ${peopleLabel(people)})`
      : `${peopleLabel(people)} voted — no single favourite yet`;
  }

  const maxC = Math.max(0, ...Object.values(byCountry));
  resultsCountries.replaceChildren(...COUNTRIES.map(c =>
    barRow(`${c.flag} ${c.name}`, byCountry[c.id] || 0, maxC)));

  const maxW = Math.max(0, ...Object.values(byWeekend));
  resultsWeekends.replaceChildren(...WEEKENDS.map(w =>
    barRow(weekendLabel(w) + (w === EASTER_WEEKEND ? ' 🐣' : ''), byWeekend[w] || 0, maxW)));

  // Everyone can vote as often as they like: show each person's tally by country.
  const byVoter = {};
  for (const v of votes) {
    const t = byVoter[v.username] || (byVoter[v.username] = { total: 0 });
    t.total++;
    t[v.country] = (t[v.country] || 0) + 1;
  }
  const voters = Object.keys(byVoter).sort((a, b) => byVoter[b].total - byVoter[a].total || a.localeCompare(b));
  resultsVoters.replaceChildren(...voters.map(name => {
    const t = byVoter[name];
    const li = document.createElement('li');
    const who = document.createElement('span');
    who.textContent = `${name} (${t.total})`;
    const what = document.createElement('span');
    what.textContent = COUNTRIES.filter(c => t[c.id]).map(c => `${c.flag} ${t[c.id]}`).join('  ');
    li.append(who, what);
    if (name === username) li.classList.add('me');
    return li;
  }));
  if (!votes.length) {
    const li = document.createElement('li');
    li.textContent = 'Nobody yet';
    resultsVoters.appendChild(li);
  }
}

async function showResults() {
  resultsPanel.classList.remove('hidden');
  resultsLeader.textContent = 'Loading…';
  resultsCountries.replaceChildren();
  resultsWeekends.replaceChildren();
  resultsVoters.replaceChildren();
  const votes = await fetchVotes();
  if (!votes) {
    resultsLeader.textContent = 'Could not load votes.';
    return;
  }
  renderResults(votes);
  countMyVotes(votes);
}

// ── Draw helpers ──────────────────────────────────────────────────────────────
// Sky gradient never changes — build it once instead of every frame.
const skyGradient = ctx.createLinearGradient(0, 0, 0, CFG.height - CFG.groundHeight);
skyGradient.addColorStop(0, '#70c5ce');
skyGradient.addColorStop(1, '#c9eaf5');

function drawSky() {
  ctx.fillStyle = skyGradient;
  ctx.fillRect(0, 0, CFG.width, CFG.height - CFG.groundHeight);
}

function drawGround() {
  ctx.fillStyle = '#ded895';
  ctx.fillRect(0, CFG.height - CFG.groundHeight, CFG.width, CFG.groundHeight);
  ctx.fillStyle = '#4caf50';
  ctx.fillRect(0, CFG.height - CFG.groundHeight, CFG.width, 14);
}

function drawPillar(pl) {
  ctx.fillStyle   = pl.country.fill;
  ctx.strokeStyle = pl.country.edge;
  ctx.lineWidth   = 3;
  ctx.lineJoin    = 'round';
  if (pl.stem) {
    const s = pl.stem;
    ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.strokeRect(s.x, s.y, s.w, s.h);
  }
  ctx.fill(pl.path);
  ctx.stroke(pl.path);

  // country + weekend label at the centroid
  ctx.fillStyle   = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth   = 3;
  ctx.font = 'bold 10px Arial';
  ctx.strokeText(pl.country.name.toUpperCase(), pl.cx, pl.cy - 9);
  ctx.fillText(pl.country.name.toUpperCase(), pl.cx, pl.cy - 9);
  ctx.font = 'bold 15px Arial';
  ctx.strokeText(pl.label, pl.cx, pl.cy + 7);
  ctx.fillText(pl.label, pl.cx, pl.cy + 7);
}

function drawPipe(p) {
  ctx.save();
  ctx.translate(p.x, 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  drawPillar(p.top);
  drawPillar(p.bottom);
  ctx.restore();
}

function drawBird() {
  ctx.save();
  const cx = bird.x + CFG.birdW / 2;
  const cy = bird.y + CFG.birdH / 2;
  ctx.translate(cx, cy);

  // tilt based on velocity
  const tilt = Math.min(Math.max(bird.vy * 3, -30), 70);
  ctx.rotate((tilt * Math.PI) / 180);

  const goingUp = bird.vy < 0;
  const sprite  = goingUp ? (birdUpLoaded ? imgBirdUp : null) : (birdDownLoaded ? imgBirdDown : null);
  if (sprite) {
    // Sprites are drawn birdW wide with their bottom square over the hitbox;
    // anything taller (the fez) pokes out above and never collides.
    const h = CFG.birdW * sprite.naturalHeight / sprite.naturalWidth;
    ctx.drawImage(sprite, -CFG.birdW / 2, CFG.birdH / 2 - h, CFG.birdW, h);
  } else {
    // fallback: yellow circle bird
    ctx.beginPath();
    ctx.arc(0, 0, CFG.birdW / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffe44d';
    ctx.fill();
    ctx.strokeStyle = '#c8960a';
    ctx.lineWidth = 2;
    ctx.stroke();
    // eye
    ctx.beginPath();
    ctx.arc(8, -6, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(9, -6, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
    // beak
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(26, 3);
    ctx.lineTo(18, 6);
    ctx.closePath();
    ctx.fillStyle = '#f5a623';
    ctx.fill();
  }
  ctx.restore();
}

function drawScore() {
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 4;
  ctx.font = 'bold 42px Arial';
  ctx.textAlign = 'center';
  ctx.strokeText(score, CFG.width / 2, 60);
  ctx.fillText(score, CFG.width / 2, 60);
}

// ── Main loop ─────────────────────────────────────────────────────────────────
function update() {
  if (gameState === 'waiting') {
    // gentle bob
    bird.y = CFG.height / 2 - CFG.birdH / 2 + Math.sin(frame * 0.07) * 8;
    return;
  }

  bird.vy += CFG.gravity;
  bird.y  += bird.vy;
  frame++;

  // spawn pipes
  if (frame % CFG.pipeSpawnInterval === 0) spawnPipe();

  // move pipes
  for (const p of pipes) {
    p.x -= CFG.pipeSpeed;
    if (!p.scored && p.x + CFG.pillarW < bird.x) {
      p.scored = true;
      score++;
    }
  }

  // remove off-screen pipes
  pipes = pipes.filter(p => p.x + CFG.pillarW > -10);

  const hit = checkCollision();
  if (hit) die(hit);
}

function die(hit) {
  gameState = 'dead';
  cancelAnimationFrame(animFrame);
  playSound('die');

  voteStatus.textContent = '';
  voteBtn.disabled = false;
  voteBtn.textContent = 'Vote for this';

  if (typeof hit === 'object') {
    // Crashed into a pillar: offer it as this player's vote.
    crashed = { country: hit.country.id, weekend: hit.weekend };
    crashTitle.textContent = 'Crashed!';
    crashSub.textContent = 'You flew straight into';
    crashCountry.textContent = `${hit.country.flag} ${hit.country.name}`;
    crashWeekend.textContent = weekendLongLabel(hit.weekend);
    crashCard.style.background = hit.country.fill;
    crashCard.style.color = hit.country.ink;
    crashCard.classList.remove('hidden');
    const already = myVotes.has(comboKey(crashed));
    voteBtn.classList.toggle('hidden', already);
    if (already) voteStatus.textContent = "You've already voted for this one 👍";
  } else {
    crashed = null;
    crashTitle.textContent = hit === 'ground' ? 'Splat!' : 'Too high!';
    crashSub.textContent = 'No vote — crash into a country to vote for it.';
    crashCard.classList.add('hidden');
    voteBtn.classList.add('hidden');
  }

  gameOverScreen.classList.remove('hidden');
}

function render() {
  drawSky();
  for (const p of pipes) drawPipe(p);
  drawGround();
  drawBird();
  if (gameState === 'playing' || gameState === 'dead') drawScore();
}

// Fixed-timestep loop: the simulation always advances in 1/60s steps, no matter
// how often the display refreshes. Without this, 90/120 Hz screens (common on
// Android) run the physics 1.5–2x faster than a 60 Hz iPhone. rAF drives the
// redraw; an accumulator decides how many logical steps to run per redraw.
const STEP_MS      = 1000 / 60;  // one logical frame (60 Hz baseline tuning)
const MAX_FRAME_MS = 250;        // clamp long gaps (tab switch) to avoid a spiral
let lastTime = 0, accumulator = 0;

function frameLoop(now) {
  if (gameState === 'dead') return;
  if (lastTime === 0) lastTime = now;
  let delta = now - lastTime;
  lastTime = now;
  if (delta < 0) delta = 0;
  if (delta > MAX_FRAME_MS) delta = MAX_FRAME_MS;

  accumulator += delta;
  while (accumulator >= STEP_MS) {
    update();
    if (gameState === 'dead') break;  // die() stops the sim; don't over-step
    accumulator -= STEP_MS;
  }

  render();
  animFrame = requestAnimationFrame(frameLoop);
}

function startLoop() {
  lastTime = 0;
  accumulator = 0;
  animFrame = requestAnimationFrame(frameLoop);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
initUsername();
initGame();
startLoop();
syncMyVotes();  // pick up this player's votes from the server
