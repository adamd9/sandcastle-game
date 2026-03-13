import { Router } from 'express';
import { getState } from '../lib/db.js';
import { renderBoard } from '../lib/renderer.js';

const router = Router();

// GET /render — full board PNG
router.get('/', async (req, res) => {
  try {
    const state = await getState();
    const cellSize = Math.min(60, Math.max(10, parseInt(req.query.cellSize) || 30));
    const buf = await renderBoard(state, { view: 'full', cellSize });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-cache');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /render/player1 — Player 1's zone only
router.get('/player1', async (req, res) => {
  try {
    const state = await getState();
    const cellSize = Math.min(60, Math.max(10, parseInt(req.query.cellSize) || 30));
    const buf = await renderBoard(state, { view: 'player1', cellSize });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-cache');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /render/player2 — Player 2's zone only
router.get('/player2', async (req, res) => {
  try {
    const state = await getState();
    const cellSize = Math.min(60, Math.max(10, parseInt(req.query.cellSize) || 30));
    const buf = await renderBoard(state, { view: 'player2', cellSize });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-cache');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
