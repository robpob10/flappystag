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
};

// ── Asset paths (swap these to change sprites) ────────────────────────────────
const ASSETS = {
  birdUp:   'assets/bird_up.png',
  birdDown: 'assets/bird_down.png',
  pipe:     'assets/pipe.png',
};

// ── Sound effects (swap these to change sounds) ───────────────────────────────
const SOUNDS = {
  flap: 'assets/flap.ogg',  // plays on each flap/click
  die:  'assets/die.ogg',   // plays on death
};

// Preload one Audio element per sound; clone on play so rapid flaps can overlap.
const audioFlap = new Audio(SOUNDS.flap);
const audioDie  = new Audio(SOUNDS.die);
audioFlap.preload = 'auto';
audioDie.preload  = 'auto';

function playSound(base) {
  try {
    const sfx = base.cloneNode();
    sfx.currentTime = 0;
    sfx.play().catch(() => {});  // ignore autoplay/interaction errors
  } catch { /* audio unsupported — fail silently */ }
}

// ── State ─────────────────────────────────────────────────────────────────────
let username = localStorage.getItem('flappy_username') || '';
let bestScore = parseInt(localStorage.getItem('flappy_best') || '0', 10);

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
  if (gameState === 'waiting') {
    gameState = 'playing';
    startScreen.classList.add('hidden');
  }
  if (gameState === 'playing') {
    bird.vy = CFG.flapForce;
    playSound(audioFlap);
  }
  if (gameState === 'dead') return;
}

document.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); flap(); }
});
canvas.addEventListener('click',     flap);
canvas.addEventListener('touchstart', e => { e.preventDefault(); flap(); }, { passive: false });

restartBtn.addEventListener('click',   () => { initGame(); loop(); });
leaderboardBtn.addEventListener('click', showLeaderboard);
closeLeaderboard.addEventListener('click', () => {
  leaderboardPanel.classList.add('hidden');
  initGame();
  loop();
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
function checkCollision() {
  const bx = bird.x + 4;
  const by = bird.y + 4;
  const bw = CFG.birdW - 8;
  const bh = CFG.birdH - 8;

  // ground / ceiling
  if (bird.y + CFG.birdH >= CFG.height - CFG.groundHeight) return true;
  if (bird.y <= 0) return true;

  for (const p of pipes) {
    const pw = p.w || CFG.pipeWidth;
    if (bx + bw > p.x && bx < p.x + pw) {
      if (by < p.topH || by + bh > p.topH + CFG.pipeGap) return true;
    }
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
    return data.rank;
  } catch {
    return null;
  }
}

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
    data.forEach((entry, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>#${i+1} ${entry.username}</span><span>${entry.score}</span>`;
      if (entry.username === username) li.classList.add('me');
      leaderboardList.appendChild(li);
    });
  } catch {
    leaderboardList.innerHTML = '<li>Could not load scores.</li>';
  }
}

// ── Draw helpers ──────────────────────────────────────────────────────────────
function drawSky() {
  const grad = ctx.createLinearGradient(0, 0, 0, CFG.height - CFG.groundHeight);
  grad.addColorStop(0,   '#70c5ce');
  grad.addColorStop(1,   '#c9eaf5');
  ctx.fillStyle = grad;
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
  playSound(audioDie);

  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem('flappy_best', bestScore);
  }

  finalScoreEl.textContent = score;
  rankDisplay.textContent  = '';
  gameOverScreen.classList.remove('hidden');

  if (username) {
    const rank = await submitScore(score);
    if (rank) rankDisplay.textContent = `You ranked #${rank} on the leaderboard!`;
  }
}

function render() {
  drawSky();
  for (const p of pipes) drawPipe(p);
  drawGround();
  drawBird();
  if (gameState === 'playing' || gameState === 'dead') drawScore();
}

function loop() {
  if (gameState === 'dead') return;
  update();
  render();
  animFrame = requestAnimationFrame(loop);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
initUsername();
initGame();
loop();
