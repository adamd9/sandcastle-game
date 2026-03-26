import { Router } from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  GRID_WIDTH,
  GRID_HEIGHT,
  ZONES,
  ACTIONS_PER_TICK,
  BLOCK_TYPES,
  VALID_ACTIONS,
  REINFORCE_AMOUNT,
  MAX_HEALTH,
  WATER_ROWS,
  MAX_LEVEL,
  WEATHER_EVENTS,
  FLAG_DAMAGE_REDUCTION,
  MOAT_DAMAGE_REDUCTION,
} from '../lib/rules.js';
import { getAllWeatherEvents } from '../lib/weather.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// RULES.md lives at the repo root (two levels up from api/routes/)
const RULES_MD_PATH = join(__dirname, '../../RULES.md');

// Cache the file in memory — it only changes on deploy
let _rulesMd = null;
function getRulesMd() {
  if (!_rulesMd) {
    try {
      _rulesMd = readFileSync(RULES_MD_PATH, 'utf8');
    } catch {
      _rulesMd = '<!-- RULES.md not found -->';
    }
  }
  return _rulesMd;
}

const router = Router();

// Computed constants from lib/rules.js — authoritative for game logic
const COMPUTED = {
  grid: { width: GRID_WIDTH, height: GRID_HEIGHT },
  zones: ZONES,
  actions_per_tick: ACTIONS_PER_TICK,
  block_types: BLOCK_TYPES,
  valid_actions: VALID_ACTIONS,
  reinforce_amount: REINFORCE_AMOUNT,
  max_health: MAX_HEALTH,
  water_zone: {
    rows: `y=0 to y=${WATER_ROWS - 1}`,
    description: 'Ocean — no building. Wave events surge from here.',
  },
  levels: {
    max_level: MAX_LEVEL,
    description: 'Each (x,y) cell can stack up to 4 blocks (levels 0–3). Must place L0 before L1. Removing a level destroys all levels above (cascade).',
    weather_interaction: 'Normal/storm damage hits only the TOP level. Wave surge destroys L0 in affected rows → cascades all levels above.',
  },
  weather_events: WEATHER_EVENTS.map(e => ({ id: e.id, label: e.label, description: e.description })),
  flag_damage_reduction: FLAG_DAMAGE_REDUCTION,
  moat_damage_reduction: MOAT_DAMAGE_REDUCTION,
  moat_mechanics: {
    description: 'Moat blocks are permanent ground-level water channels. They are immune to all weather damage and grant damage reduction to adjacent same-owner blocks.',
    placement: 'Level 0 only — cannot be stacked or have blocks placed on top.',
    permanence: 'Immune to all weather: rain, wind, storm, wave surge, rogue wave.',
    adjacency_protection: `Same-owner blocks orthogonally adjacent (up/down/left/right) to a moat take ${MOAT_DAMAGE_REDUCTION * 100}% less weather damage.`,
    damage_reduction: MOAT_DAMAGE_REDUCTION,
    score_contribution: 'Moat blocks do not contribute to structural score (health = 0).',
    cannot_reinforce: true,
  },
};

// GET /rules — JSON response with computed constants + raw Markdown embedded
router.get('/', (_req, res) => {
  res.json({
    ...COMPUTED,
    rules_md: getRulesMd(),
    rules_md_url: '/rules.md',
  });
});

// GET /rules.md — raw Markdown (human-readable, easy to read in agent context)
router.get('/md', (_req, res) => {
  res.type('text/markdown').send(getRulesMd());
});

// GET /rules/weather-events — full predefined weather events list for UI dropdown
router.get('/weather-events', (_req, res) => {
  res.json(getAllWeatherEvents());
});

export default router;

