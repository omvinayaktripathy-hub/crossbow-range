import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'scores.json');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function readScores() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeScores(scores) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(scores, null, 2));
}

function sanitizeName(name) {
  if (typeof name !== 'string') return 'Anonymous';
  const trimmed = name.trim().slice(0, 16);
  return trimmed || 'Anonymous';
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

app.get('/api/leaderboard', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);
  const scores = await readScores();
  const sorted = scores.sort((a, b) => b.score - a.score).slice(0, limit);
  res.json({ leaderboard: sorted });
});

app.post('/api/scores', async (req, res) => {
  const { name, score, accuracy, bestCombo, shots, hits } = req.body || {};
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name: sanitizeName(name),
    score: toInt(score),
    accuracy: toInt(accuracy),
    bestCombo: toInt(bestCombo),
    shots: toInt(shots),
    hits: toInt(hits),
    at: new Date().toISOString()
  };
  const scores = await readScores();
  scores.push(entry);
  // keep top 500
  const kept = scores.sort((a,b)=>b.score-a.score).slice(0, 500);
  await writeScores(kept);
  const rank = kept.findIndex(s => s.id === entry.id) + 1;
  res.status(201).json({ entry, rank });
});

app.get('/api/stats', async (req, res) => {
  const scores = await readScores();
  const total = scores.length;
  const best = scores.reduce((m, s) => Math.max(m, s.score), 0);
  const avg = total ? Math.round(scores.reduce((a, s) => a + s.score, 0) / total) : 0;
  res.json({ total, best, avg });
});

app.listen(PORT, () => console.log(`Crossbow Range running at http://localhost:${PORT}`));