// ── Config ────────────────────────────────────────────────────────────────────
const CFG = {
  width: 400,
  height: 600,
  gravity: 0.5,
  flapForce: -9,
  pipeWidth: 70,
  pipeGap: 160,
  pipeSpeed: 2.8,
  pipeSpawnInterval: 90,  // frames
  groundHeight: 80,
  birdW: 64,
  birdH: 64,
  birdRadius: 28,  // circular hitbox radius (sprite stays square)
};

// ── Asset paths (swap these to change sprites) ────────────────────────────────
const ASSETS = {
  birdUp:   'assets/bird_up.png',
  birdDown: 'assets/bird_down.png',
  pipe:     'assets/pipe.png',
};

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
let bestScore = parseInt(localStorage.getItem('flappy_best') || '0', 10);
let muted = localStorage.getItem('flappy_muted') === '1';

let bird, pipes, score, frame, gameState, animFrame;
// gameState: 'waiting' | 'playing' | 'dead'

// ── Canvas setup ──────────────────────────────────────────────────────────────
const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');
canvas.width  = CFG.width;
canvas.height = CFG.height;

// ── Image loading ─────────────────────────────────────────────────────────────
const imgBirdUp   = new Image();
const imgBirdDown = new Image();
const imgPipe     = new Image();
let birdUpLoaded = false, birdDownLoaded = false, pipeLoaded = false;
imgBirdUp.onload    = () => { birdUpLoaded   = true; };
imgBirdUp.onerror   = () => { birdUpLoaded   = false; };
imgBirdDown.onload  = () => { birdDownLoaded = true; };
imgBirdDown.onerror = () => { birdDownLoaded = false; };
imgPipe.onload      = () => { pipeLoaded     = true; };
imgPipe.onerror     = () => { pipeLoaded     = false; };
imgBirdUp.src   = ASSETS.birdUp;
imgBirdDown.src = ASSETS.birdDown;
imgPipe.src     = ASSETS.pipe;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const usernameModal    = document.getElementById('username-modal');
const usernameInput    = document.getElementById('username-input');
const usernameBtn      = document.getElementById('username-btn');
const playerNameEl     = document.getElementById('player-name');
const startScreen      = document.getElementById('start-screen');
const gameOverScreen   = document.getElementById('game-over-screen');
const finalScoreEl     = document.getElementById('final-score');
const rankDisplay      = document.getElementById('rank-display');
const restartBtn       = document.getElementById('restart-btn');
const leaderboardBtn   = document.getElementById('leaderboard-btn');
const leaderboardPanel = document.getElementById('leaderboard-panel');
const leaderboardList  = document.getElementById('leaderboard-list');
const closeLeaderboard = document.getElementById('close-leaderboard');
const showLbBtn        = document.getElementById('show-leaderboard-btn');
const bestScoreDisplay = document.getElementById('best-score-display');
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
}

// ── Game init ─────────────────────────────────────────────────────────────────
function initGame() {
  bird = {
    x: 80,
    y: CFG.height / 2 - CFG.birdH / 2,
    vy: 0,
    rotation: 0,
  };
  pipes  = [];
  score  = 0;
  frame  = 0;
  gameState = 'waiting';

  bestScoreDisplay.textContent = bestScore ? `Best: ${bestScore}` : '';
  startScreen.classList.remove('hidden');
  gameOverScreen.classList.add('hidden');
  leaderboardPanel.classList.add('hidden');
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
  if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); flap(); }
});
canvas.addEventListener('click',     flap);
canvas.addEventListener('touchstart', e => { e.preventDefault(); flap(); }, { passive: false });

restartBtn.addEventListener('click',   () => { initGame(); startLoop(); });
leaderboardBtn.addEventListener('click', showLeaderboard);
closeLeaderboard.addEventListener('click', () => {
  leaderboardPanel.classList.add('hidden');
  initGame();
  startLoop();
});
showLbBtn.addEventListener('click', showLeaderboard);

// ── Pipe logic ────────────────────────────────────────────────────────────────
function pipeWidth(sectionH) {
  if (pipeLoaded && imgPipe.naturalHeight > 0) {
    return Math.max(Math.round(sectionH * imgPipe.naturalWidth / imgPipe.naturalHeight), 20);
  }
  return CFG.pipeWidth;
}

function spawnPipe() {
  const minY = 60;
  const maxY = CFG.height - CFG.groundHeight - CFG.pipeGap - 60;
  const topH = Math.random() * (maxY - minY) + minY;
  const botH = CFG.height - CFG.groundHeight - CFG.pipeGap - topH;
  // use the narrower of the two sections for collision fairness
  const w = Math.min(pipeWidth(topH), pipeWidth(botH));
  pipes.push({ x: CFG.width, topH, w, scored: false });
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

function checkCollision() {
  const cx = bird.x + CFG.birdW / 2;   // circle centre
  const cy = bird.y + CFG.birdH / 2;
  const r  = CFG.birdRadius;
  const groundTop = CFG.height - CFG.groundHeight;

  // ground / ceiling
  if (cy + r >= groundTop) return true;
  if (cy - r <= 0) return true;

  for (const p of pipes) {
    const pw = p.w || CFG.pipeWidth;
    const gapBottom = p.topH + CFG.pipeGap;
    // top pipe (0 → topH) and bottom pipe (gapBottom → ground)
    if (circleHitsRect(cx, cy, r, p.x, 0, pw, p.topH)) return true;
    if (circleHitsRect(cx, cy, r, p.x, gapBottom, pw, groundTop - gapBottom)) return true;
  }
  return false;
}

// ── Score submission ──────────────────────────────────────────────────────────
async function submitScore(s) {
  try {
    const res = await fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, score: s }),
    });
    const data = await res.json();
    return typeof data.rank === 'number' ? data.rank : null;
  } catch {
    return null;  // offline / network error — nothing was recorded server-side
  }
}

// Offline safety net: scores earned without a connection never reach the server
// (submitScore fails silently). The best score is still saved locally, so push
// it to the leaderboard whenever we're online — on load and when a connection
// returns. The server keeps the max, so re-sending is harmless/idempotent; a
// synced marker avoids redundant posts.
async function syncBestScore() {
  if (!username || !bestScore) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (localStorage.getItem('flappy_best_synced') === String(bestScore)) return;
  const rank = await submitScore(bestScore);
  if (rank !== null) localStorage.setItem('flappy_best_synced', String(bestScore));
}

window.addEventListener('online', syncBestScore);

async function showLeaderboard() {
  leaderboardPanel.classList.remove('hidden');
  leaderboardList.innerHTML = '<li>Loading…</li>';
  try {
    const res  = await fetch('/api/leaderboard');
    const data = await res.json();
    leaderboardList.innerHTML = '';
    if (data.length === 0) {
      leaderboardList.innerHTML = '<li>No scores yet!</li>';
      return;
    }
    // Joint placing: equal scores share a rank (1, 2, 2, 4, …). data is sorted
    // by score descending, so a rank only advances when the score changes.
    let rank = 0, prevScore = null;
    data.forEach((entry, i) => {
      if (entry.score !== prevScore) { rank = i + 1; prevScore = entry.score; }
      const li = document.createElement('li');
      li.innerHTML = `<span>#${rank} ${entry.username}</span><span>${entry.score}</span>`;
      if (entry.username === username) li.classList.add('me');
      leaderboardList.appendChild(li);
    });
  } catch {
    leaderboardList.innerHTML = '<li>Could not load scores.</li>';
  }
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

function drawPipe(p) {
  const botY = p.topH + CFG.pipeGap;
  const botH = CFG.height - CFG.groundHeight - botY;
  const w    = p.w || CFG.pipeWidth;

  if (pipeLoaded) {
    const topW = pipeWidth(p.topH);
    const botW = pipeWidth(botH);

    // bottom pipe — natural orientation
    ctx.drawImage(imgPipe, p.x, botY, botW, botH);

    // top pipe — flip vertically
    ctx.save();
    ctx.translate(p.x + topW / 2, p.topH / 2);
    ctx.scale(1, -1);
    ctx.drawImage(imgPipe, -topW / 2, -p.topH / 2, topW, p.topH);
    ctx.restore();
  } else {
    const capH = 22, capX = 6;
    ctx.fillStyle = '#4caf50';
    ctx.fillRect(p.x, 0, w, p.topH);
    ctx.fillStyle = '#388e3c';
    ctx.fillRect(p.x - capX, p.topH - capH, w + capX * 2, capH);
    ctx.fillStyle = '#4caf50';
    ctx.fillRect(p.x, botY, w, botH);
    ctx.fillStyle = '#388e3c';
    ctx.fillRect(p.x - capX, botY, w + capX * 2, capH);
  }
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
    ctx.drawImage(sprite, -CFG.birdW / 2, -CFG.birdH / 2, CFG.birdW, CFG.birdH);
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
    if (!p.scored && p.x + (p.w || CFG.pipeWidth) < bird.x) {
      p.scored = true;
      score++;
    }
  }

  // remove off-screen pipes
  pipes = pipes.filter(p => p.x + CFG.pipeWidth > -10);

  if (checkCollision()) die();
}

async function die() {
  gameState = 'dead';
  cancelAnimationFrame(animFrame);
  playSound('die');

  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem('flappy_best', bestScore);
  }

  finalScoreEl.textContent = score;
  rankDisplay.textContent  = '';
  gameOverScreen.classList.remove('hidden');

  if (username) {
    const rank = await submitScore(score);
    if (rank) {
      rankDisplay.textContent = `You ranked #${rank} on the leaderboard!`;
      if (score >= bestScore) localStorage.setItem('flappy_best_synced', String(bestScore));
    } else {
      // couldn't reach the server (offline) — clear the marker so this best
      // gets pushed automatically once we're back online
      localStorage.removeItem('flappy_best_synced');
    }
  }
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
syncBestScore();  // push any locally-cached best (e.g. earned offline) now we're online
