(() => {
'use strict';

/* ============================== API CLIENT ============================== */
const API = {
  async leaderboard(limit = 10) {
    const r = await fetch(`/api/leaderboard?limit=${limit}`);
    if (!r.ok) throw new Error('leaderboard failed');
    return r.json();
  },
  async submit(payload) {
    const r = await fetch('/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error('submit failed');
    return r.json();
  }
};

/* ============================== DOM ============================== */
const cvs      = document.getElementById('game');
const ctx      = cvs.getContext('2d');
const ui       = document.getElementById('ui');
const titleEl  = document.getElementById('title');
const subEl    = document.getElementById('sub');
const statsEl  = document.getElementById('stats');
const btn      = document.getElementById('btn');
const nameRow  = document.getElementById('nameRow');
const nameInput= document.getElementById('nameInput');
const lbList   = document.getElementById('lbList');

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const TOTAL_TIME  = 60;
const GRAVITY     = 430;
const CHARGE_TIME = 0.55;
const MIN_A = -Math.PI + 0.18;
const MAX_A = -0.18;
const COLORS = ['#ff5d5d','#ffb020','#4ade80','#38bdf8','#a78bfa','#f472b6','#facc15','#2dd4bf'];

let W = 0, H = 0, DPR = 1;
const origin = { x: 0, y: 0 };
let stars = [];

/* ============================== STATE ============================== */
let state = 'menu';               // menu | playing | over
let mouse = { x: 0, y: 0 };
let aimAngle = -Math.PI / 2;

let charging = false;
let power = 0;
let reload = 0;
let recoil = 0;
let shake = 0;

let bolts = [], balloons = [], particles = [], popups = [];

let score = 0, shots = 0, hits = 0, combo = 0, bestCombo = 0;
let timeLeft = TOTAL_TIME, elapsed = 0;
let spawnTimer = 0, spawnInterval = 1.1;
let gameTime = 0;
let submitted = false;

/* ============================== AUDIO ============================== */
let actx = null;
function ac() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) actx = new AC();
  }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
function tone(freq, dur, type, vol, slideTo) {
  const a = ac(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, a.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), a.currentTime + dur);
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0008, a.currentTime + dur);
  o.connect(g); g.connect(a.destination);
  o.start(); o.stop(a.currentTime + dur + 0.02);
}
const sfxFire = () => { tone(300, 0.10, 'square', 0.055, 110); tone(1200, 0.06, 'triangle', 0.03, 400); };
const sfxPop  = () => { tone(820, 0.09, 'triangle', 0.10, 300); };
const sfxMiss = () => { tone(150, 0.09, 'sine', 0.025, 90); };
const sfxEnd  = () => { tone(520, 0.5, 'sine', 0.08, 130); };

/* ============================== HELPERS ============================== */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rand  = (a, b) => a + Math.random() * (b - a);

function shade(hex, amt) {
  const c = hex.slice(1);
  let r = parseInt(c.slice(0, 2), 16);
  let g = parseInt(c.slice(2, 4), 16);
  let b = parseInt(c.slice(4, 6), 16);
  r = clamp(Math.round(r + amt * 255), 0, 255);
  g = clamp(Math.round(g + amt * 255), 0, 255);
  b = clamp(Math.round(b + amt * 255), 0, 255);
  return `rgb(${r},${g},${b})`;
}

function segCircle(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1, dy = y2 - y1;
  const fx = x1 - cx, fy = y1 - cy;
  const a = dx * dx + dy * dy;
  if (a < 1e-9) return (fx * fx + fy * fy) <= r * r;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return false;
  disc = Math.sqrt(disc);
  const t1 = (-b - disc) / (2 * a);
  const t2 = (-b + disc) / (2 * a);
  return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1) || (t1 < 0 && t2 > 1);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ============================== LEADERBOARD UI ============================== */
function renderLeaderboard(entries, highlightId) {
  if (!entries || !entries.length) {
    lbList.innerHTML = '<li class="empty">No scores yet — be the first!</li>';
    return;
  }
  lbList.innerHTML = entries.map((e, i) => `
    <li${e.id === highlightId ? ' class="me"' : ''}>
      <span class="rank">${i + 1}</span>
      <span class="name">${escapeHtml(e.name)}</span>
      <span class="score">${e.score}</span>
    </li>
  `).join('');
}

async function loadLeaderboard(highlightId) {
  try {
    const data = await API.leaderboard(10);
    renderLeaderboard(data.leaderboard, highlightId);
  } catch {
    lbList.innerHTML = '<li class="empty">Leaderboard unavailable</li>';
  }
}

/* ============================== RESIZE ============================== */
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  cvs.width  = Math.round(W * DPR);
  cvs.height = Math.round(H * DPR);
  cvs.style.width  = W + 'px';
  cvs.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  origin.x = W / 2;
  origin.y = H - 60;
  makeStars();
}

function makeStars() {
  stars = [];
  const n = Math.round((W * H) / 16000);
  for (let i = 0; i < n; i++) {
    stars.push({
      x: Math.random() * W,
      y: Math.random() * H * 0.78,
      r: rand(0.4, 1.7),
      a: rand(0.12, 0.6),
      tw: rand(0, Math.PI * 2)
    });
  }
}

/* ============================== SPAWNING ============================== */
function spawnBalloon() {
  const r = rand(15, 34);
  const fromLeft = Math.random() < 0.5;
  const speed = rand(45, 120) * (1 + elapsed * 0.011);
  const baseY = rand(70, Math.max(110, H * 0.55));
  balloons.push({
    x: fromLeft ? -r - 20 : W + r + 20,
    baseY,
    y: baseY,
    vx: fromLeft ? speed : -speed,
    r,
    t: rand(0, 10),
    phase: rand(0, Math.PI * 2),
    bob: rand(6, 18),
    bobSpeed: rand(0.9, 2.1),
    color: COLORS[(Math.random() * COLORS.length) | 0],
    points: Math.round(46 - r)
  });
}

function explode(x, y, color, r) {
  const n = Math.round(r * 0.8) + 12;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rand(50, 300);
    const life = rand(0.35, 0.85);
    particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life, maxLife: life,
      size: rand(1.8, 4.5),
      color: Math.random() < 0.28 ? '#ffffff' : color
    });
  }
}

/* ============================== ACTIONS ============================== */
function fireBolt() {
  const speed = 700 + power * 900;
  const mx = origin.x + Math.cos(aimAngle) * 58;
  const my = origin.y + Math.sin(aimAngle) * 58;
  bolts.push({
    x: mx, y: my,
    vx: Math.cos(aimAngle) * speed,
    vy: Math.sin(aimAngle) * speed,
    angle: aimAngle
  });
  shots++;
  power = 0;
  reload = 0.16;
  recoil = 9;
  shake = Math.max(shake, 4);
  sfxFire();
}

function hitBalloon(b) {
  combo++;
  if (combo > bestCombo) bestCombo = combo;
  hits++;
  const mult = 1 + Math.min(combo - 1, 10) * 0.1;
  const pts = Math.round(b.points * mult);
  score += pts;

  popups.push({
    x: b.x, y: b.y, text: '+' + pts,
    life: 0.85, maxLife: 0.85,
    color: b.color, size: 20 + Math.min(pts / 8, 12)
  });
  explode(b.x, b.y, b.color, b.r);
  shake = Math.max(shake, 6);
  sfxPop();
}

function startGame() {
  state = 'playing';
  score = 0; shots = 0; hits = 0; combo = 0; bestCombo = 0;
  timeLeft = TOTAL_TIME; elapsed = 0; gameTime = 0;
  bolts = []; balloons = []; particles = []; popups = [];
  spawnTimer = 0.55;
  power = 0; charging = false; reload = 0; recoil = 0; shake = 0;
  submitted = false;
  nameRow.hidden = true;
  ui.classList.add('hidden');
  ac();
}

function endGame() {
  state = 'over';
  charging = false;
  power = 0;
  submitted = false;
  sfxEnd();

  const acc = shots ? Math.round((hits / shots) * 100) : 0;
  titleEl.textContent = 'TIME UP!';
  subEl.textContent = 'Nice shooting.';
  statsEl.innerHTML =
    `Score <b>${score}</b><br>` +
    `Accuracy <b>${acc}%</b> &nbsp;·&nbsp; Best combo <b>${bestCombo}</b>`;

  nameRow.hidden = false;
  nameInput.value = localStorage.getItem('crossbow.name') || '';
  btn.textContent = 'SUBMIT SCORE';
  btn.disabled = false;

  ui.classList.remove('hidden');
  setTimeout(() => nameInput.focus(), 60);
}

async function submitScore() {
  if (submitted) return;
  const name = (nameInput.value || 'Anonymous').trim().slice(0, 16) || 'Anonymous';
  localStorage.setItem('crossbow.name', name);

  const acc = shots ? Math.round((hits / shots) * 100) : 0;
  btn.disabled = true;
  btn.textContent = 'SUBMITTING…';

  try {
    const res = await API.submit({
      name,
      score,
      accuracy: acc,
      bestCombo,
      shots,
      hits
    });
    submitted = true;
    nameRow.hidden = true;
    subEl.textContent = `Saved — you ranked #${res.rank}!`;
    btn.textContent = 'PLAY AGAIN';
    btn.disabled = false;
    await loadLeaderboard(res.entry.id);
  } catch (err) {
    console.error(err);
    btn.textContent = 'TRY AGAIN';
    btn.disabled = false;
    subEl.textContent = 'Could not submit — check the server.';
  }
}

/* ============================== INPUT ============================== */
function pointerPos(e) {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
}

cvs.addEventListener('pointerdown', (e) => {
  pointerPos(e);
  if (state === 'playing' && reload <= 0 && !charging) {
    charging = true;
    power = 0;
  }
});
cvs.addEventListener('pointermove', pointerPos);
window.addEventListener('pointerup', () => {
  if (charging) {
    charging = false;
    if (state === 'playing') fireBolt();
    else power = 0;
  }
});
cvs.addEventListener('contextmenu', (e) => e.preventDefault());

btn.addEventListener('click', () => {
  if (state === 'menu') startGame();
  else if (state === 'over') {
    if (!submitted) submitScore();
    else startGame();
  }
});

nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    submitScore();
  }
});

window.addEventListener('keydown', (e) => {
  if ((e.key === ' ' || e.key === 'Enter') && state === 'menu') {
    e.preventDefault();
    startGame();
  }
});

/* ============================== UPDATE ============================== */
function update(dt) {
  gameTime += dt;

  const dx = mouse.x - origin.x;
  const dy = mouse.y - origin.y;
  let a = Math.atan2(dy, dx);
  if (a > 0) a = (a < Math.PI / 2) ? MAX_A : MIN_A;
  aimAngle = clamp(a, MIN_A, MAX_A);

  if (reload > 0) reload -= dt;
  if (recoil > 0) recoil = Math.max(0, recoil - dt * 60);
  if (shake > 0) shake = Math.max(0, shake - dt * 45);
  if (charging) power = Math.min(1, power + dt / CHARGE_TIME);

  if (state === 'playing') {
    timeLeft -= dt;
    if (timeLeft <= 0) { timeLeft = 0; endGame(); }
    elapsed += dt;

    spawnInterval = Math.max(0.42, 1.15 - elapsed * 0.012);
    spawnTimer -= dt;
    if (spawnTimer <= 0 && balloons.length < 12) {
      spawnBalloon();
      spawnTimer = spawnInterval * rand(0.65, 1.3);
    }
  }

  for (let i = balloons.length - 1; i >= 0; i--) {
    const b = balloons[i];
    b.t += dt;
    b.x += b.vx * dt;
    b.y = b.baseY + Math.sin(b.t * b.bobSpeed + b.phase) * b.bob;
    if (b.x < -120 || b.x > W + 120) balloons.splice(i, 1);
  }

  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    const px = b.x, py = b.y;
    b.vy += GRAVITY * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.angle = Math.atan2(b.vy, b.vx);

    let hit = false;
    for (let j = balloons.length - 1; j >= 0; j--) {
      const bl = balloons[j];
      if (segCircle(px, py, b.x, b.y, bl.x, bl.y, bl.r * 0.95)) {
        hitBalloon(bl);
        balloons.splice(j, 1);
        hit = true;
        break;
      }
    }
    if (hit) { bolts.splice(i, 1); continue; }

    if (b.x < -250 || b.x > W + 250 || b.y > H + 250 || b.y < -600) {
      bolts.splice(i, 1);
      if (state === 'playing' && combo > 0) { combo = 0; sfxMiss(); }
    }
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.vy += 620 * dt;
    p.vx *= Math.pow(0.14, dt);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    p.life -= dt;
    p.y -= 52 * dt;
    if (p.life <= 0) popups.splice(i, 1);
  }
}

/* ============================== DRAW ============================== */
function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#080d1a');
  g.addColorStop(0.5, '#111b32');
  g.addColorStop(1, '#1b2740');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    const tw = 0.65 + 0.35 * Math.sin(gameTime * 1.7 + s.tw);
    ctx.globalAlpha = s.a * tw;
    ctx.fillStyle = '#cfe4ff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const hg = ctx.createRadialGradient(W * 0.5, H * 1.05, 0, W * 0.5, H * 1.05, H * 0.8);
  hg.addColorStop(0, 'rgba(70,140,220,0.16)');
  hg.addColorStop(1, 'rgba(70,140,220,0)');
  ctx.fillStyle = hg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(8,12,22,0.75)';
  ctx.fillRect(0, H - 26, W, 26);
  ctx.strokeStyle = 'rgba(110,180,255,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, H - 26.5);
  ctx.lineTo(W, H - 26.5);
  ctx.stroke();
}

function drawAimPreview() {
  if (!charging || state !== 'playing') return;
  const speed = 700 + power * 900;
  let px = origin.x + Math.cos(aimAngle) * 58;
  let py = origin.y + Math.sin(aimAngle) * 58;
  let vx = Math.cos(aimAngle) * speed;
  let vy = Math.sin(aimAngle) * speed;
  const step = 0.02;

  for (let i = 0; i < 70; i++) {
    px += vx * step;
    py += vy * step;
    vy += GRAVITY * step;
    if (py > H || px < -60 || px > W + 60) break;
    const alpha = 0.55 * (1 - i / 70);
    ctx.fillStyle = `rgba(150,215,255,${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(px, py, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBalloon(b) {
  ctx.save();
  ctx.translate(b.x, b.y);

  ctx.strokeStyle = 'rgba(200,225,255,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, b.r * 1.05);
  ctx.quadraticCurveTo(b.r * 0.55, b.r * 1.7, 0, b.r * 2.35);
  ctx.stroke();

  const g = ctx.createRadialGradient(-b.r * 0.32, -b.r * 0.38, b.r * 0.06, 0, 0, b.r * 1.2);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.22, b.color);
  g.addColorStop(1, shade(b.color, -0.38));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, b.r * 0.86, b.r, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = shade(b.color, -0.32);
  ctx.beginPath();
  ctx.moveTo(-4, b.r * 0.96);
  ctx.lineTo(4, b.r * 0.96);
  ctx.lineTo(0, b.r * 1.18);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.ellipse(-b.r * 0.32, -b.r * 0.36, b.r * 0.16, b.r * 0.25, -0.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawBolt(b) {
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.angle);

  ctx.strokeStyle = 'rgba(150,220,255,0.22)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-46, 0);
  ctx.lineTo(-14, 0);
  ctx.stroke();

  ctx.strokeStyle = '#e9dcc0';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-16, 0);
  ctx.lineTo(11, 0);
  ctx.stroke();

  ctx.fillStyle = '#cfe3ff';
  ctx.beginPath();
  ctx.moveTo(17, 0);
  ctx.lineTo(8, -5);
  ctx.lineTo(8, 5);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#ff5a4a';
  ctx.beginPath();
  ctx.moveTo(-16, 0);
  ctx.lineTo(-8, -5.5);
  ctx.lineTo(-8, 5.5);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawCrossbow() {
  const pull = charging ? power * 15 : 0;

  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.rotate(aimAngle);
  ctx.translate(-recoil, 0);

  ctx.fillStyle = '#4b3524';
  ctx.fillRect(-32, -5, 74, 10);
  ctx.fillStyle = '#6b4c30';
  ctx.fillRect(-32, -5, 74, 3);
  ctx.fillStyle = '#33241a';
  ctx.fillRect(-32, 3, 74, 2);

  ctx.fillStyle = '#3a2a1c';
  ctx.beginPath();
  ctx.moveTo(-26, 5);
  ctx.lineTo(-14, 5);
  ctx.lineTo(-18, 20);
  ctx.lineTo(-30, 20);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#8a6a44';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(6, -38);
  ctx.quadraticCurveTo(35, -16, 35, 0);
  ctx.quadraticCurveTo(35, 16, 6, 38);
  ctx.stroke();

  ctx.fillStyle = '#b08a5a';
  ctx.beginPath(); ctx.arc(6, -38, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(6, 38, 3, 0, Math.PI * 2); ctx.fill();

  ctx.strokeStyle = 'rgba(235,242,255,0.9)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(6, -38);
  ctx.lineTo(6 - pull, 0);
  ctx.lineTo(6, 38);
  ctx.stroke();

  if (reload <= 0) {
    ctx.strokeStyle = '#e9dcc0';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(6 - pull, 0);
    ctx.lineTo(60, 0);
    ctx.stroke();

    ctx.fillStyle = '#cfe3ff';
    ctx.beginPath();
    ctx.moveTo(66, 0);
    ctx.lineTo(58, -5);
    ctx.lineTo(58, 5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ff5a4a';
    ctx.beginPath();
    ctx.moveTo(6 - pull, 0);
    ctx.lineTo(14 - pull, -5.5);
    ctx.lineTo(14 - pull, 5.5);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();

  ctx.fillStyle = 'rgba(12,20,34,0.95)';
  ctx.beginPath();
  ctx.arc(origin.x, origin.y + 6, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,185,255,0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(origin.x, origin.y + 6, 20, 0, Math.PI * 2);
  ctx.stroke();

  if (charging) {
    const R = 52;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, R, 0, Math.PI * 2);
    ctx.stroke();

    const hue = 190 - power * 175;
    ctx.strokeStyle = `hsl(${hue}, 95%, 62%)`;
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, R, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2);
    ctx.stroke();

    if (power >= 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, R + 9, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawHUD() {
  if (state !== 'playing') return;

  const pct = timeLeft / TOTAL_TIME;

  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(0, 0, W, 5);
  ctx.fillStyle = pct > 0.5 ? '#4ade80' : pct > 0.25 ? '#fbbf24' : '#f87171';
  ctx.fillRect(0, 0, W * pct, 5);

  ctx.textBaseline = 'alphabetic';

  ctx.textAlign = 'left';
  ctx.font = `600 11px ${FONT}`;
  ctx.fillStyle = 'rgba(160,195,235,0.65)';
  ctx.fillText('SCORE', 24, 36);
  ctx.font = `800 28px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(String(score), 24, 66);

  ctx.textAlign = 'center';
  ctx.font = `600 11px ${FONT}`;
  ctx.fillStyle = 'rgba(160,195,235,0.65)';
  ctx.fillText('TIME', W / 2, 36);
  ctx.font = `800 28px ${FONT}`;
  ctx.fillStyle = pct > 0.25 ? '#e8f2ff' : '#f87171';
  ctx.fillText(Math.ceil(timeLeft) + 's', W / 2, 66);

  const mult = 1 + Math.min(Math.max(combo - 1, 0), 10) * 0.1;
  ctx.textAlign = 'right';
  ctx.font = `600 11px ${FONT}`;
  ctx.fillStyle = 'rgba(160,195,235,0.65)';
  ctx.fillText('COMBO', W - 24, 36);
  ctx.font = `800 28px ${FONT}`;
  ctx.fillStyle = combo > 1 ? `hsl(${190 - Math.min(combo, 10) * 12}, 95%, 65%)` : '#8fa6c8';
  ctx.fillText('×' + mult.toFixed(1), W - 24, 66);
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);

  ctx.save();
  if (shake > 0.4) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  }

  drawBackground();
  drawAimPreview();

  for (let i = 0; i < balloons.length; i++) drawBalloon(balloons[i]);

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (let i = 0; i < bolts.length; i++) drawBolt(bolts[i]);

  drawCrossbow();

  ctx.textAlign = 'center';
  for (let i = 0; i < popups.length; i++) {
    const p = popups[i];
    const a = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = a;
    ctx.font = `800 ${p.size}px ${FONT}`;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 12;
    ctx.fillText(p.text, p.x, p.y);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  drawHUD();
}

/* ============================== LOOP ============================== */
let lastTime = performance.now();
function loop(t) {
  let dt = (t - lastTime) / 1000;
  lastTime = t;
  if (!isFinite(dt) || dt < 0) dt = 0;
  dt = Math.min(dt, 0.05);

  update(dt);
  render();

  requestAnimationFrame(loop);
}

/* ============================== BOOT ============================== */
window.addEventListener('resize', resize);
resize();
mouse.x = W / 2;
mouse.y = H * 0.3;

statsEl.innerHTML =
  'Pop the balloons before the clock runs out.<br>' +
  'Small balloons score more &middot; chain hits for a multiplier.';
btn.textContent = 'START';

loadLeaderboard();
requestAnimationFrame(loop);

})();