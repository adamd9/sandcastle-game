import { Router } from 'express';
import { getState } from '../lib/db.js';
import { triggerHookByName } from '../lib/hooks.js';

const router = Router();

const VALID_HOOKS = ['notify-players', 'notify-player1', 'notify-player2', 'review-improvements'];

/**
 * POST /hooks/:hookName
 * Manually triggers a named post-tick hook. Requires TICK_ADMIN_KEY auth.
 * Header: X-Api-Key (TICK_ADMIN_KEY)
 */
router.post('/:hookName', async (req, res) => {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.TICK_ADMIN_KEY) {
    return res.status(401).json({ error: 'Invalid or missing X-Api-Key header.' });
  }

  const { hookName } = req.params;
  if (!VALID_HOOKS.includes(hookName)) {
    return res.status(400).json({ error: `Unknown hook. Valid hooks: ${VALID_HOOKS.join(', ')}` });
  }

  try {
    const state = await getState();
    const results = await triggerHookByName(hookName, state);
    res.json({ ok: true, hook: hookName, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
