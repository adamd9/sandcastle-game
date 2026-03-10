import { Router } from 'express';
import { getState } from '../lib/db.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const state = await getState();
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
