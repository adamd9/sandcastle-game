const REVIEW_WORKFLOW = 'review-improvements.lock.yml';
const reviewEveryNTicks = parseInt(process.env.REVIEW_EVERY_N_TICKS || '24');

async function dispatchPlayerTurn(owner, repo, workflow, _state) {
  const token = process.env.COPILOT_TOKEN;
  if (!token) throw new Error('COPILOT_TOKEN not set');

  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
    },
    body: JSON.stringify({ ref: 'main' }),
  });

  if (res.status !== 204) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub dispatch failed: ${res.status} ${body}`);
  }
  return true;
}

async function maybeDispatchReview(state) {
  const n = parseInt(process.env.REVIEW_EVERY_N_TICKS || '24');
  if (state.tick % n !== 0) return;
  await dispatchPlayerTurn('adamd9', 'sandcastle-game', REVIEW_WORKFLOW, state);
}

async function forceDispatchReview(_state) {
  await dispatchPlayerTurn('adamd9', 'sandcastle-game', REVIEW_WORKFLOW, _state);
}

// Hook registry
const hooks = [
  {
    name: 'notify-player1',
    fn: dispatchPlayerTurn.bind(null, 'adamd9', 'sandcastle-player-one', 'player-turn.yml'),
  },
  {
    name: 'notify-player2',
    fn: dispatchPlayerTurn.bind(null, 'adamd9', 'sandcastle-player-two', 'player-turn.yml'),
  },
  {
    name: 'review-improvements',
    fn: maybeDispatchReview,
  },
];

export async function firePostTickHooks(state) {
  const results = await Promise.allSettled(hooks.map(h => h.fn(state)));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      console.log(`[hooks] ${hooks[i].name}: ok`);
    } else {
      console.error(`[hooks] ${hooks[i].name}: FAILED`, r.reason?.message ?? r.reason);
    }
  });
}

export async function triggerHookByName(name, state) {
  const targets = [];

  if (name === 'notify-players') {
    targets.push(hooks.find(h => h.name === 'notify-player1'));
    targets.push(hooks.find(h => h.name === 'notify-player2'));
  } else if (name === 'review-improvements') {
    targets.push({ name: 'review-improvements', fn: forceDispatchReview });
  } else {
    const h = hooks.find(h => h.name === name);
    if (!h) throw new Error(`Unknown hook: ${name}`);
    targets.push(h);
  }

  const results = await Promise.allSettled(targets.map(h => h.fn(state)));
  return results.map((r, i) => ({
    name: targets[i].name,
    ok: r.status === 'fulfilled',
    error: r.status === 'rejected' ? (r.reason?.message ?? String(r.reason)) : undefined,
  }));
}
