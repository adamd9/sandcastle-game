// Game rules constants — single source of truth consumed by gameLogic.js and GET /rules.

export const GRID_WIDTH = 20;
export const GRID_HEIGHT = 20;

export const ZONES = {
  player1: { x_min: 0, x_max: 9 },
  player2: { x_min: 10, x_max: 19 },
};

export const ACTIONS_PER_TICK = 20;

export const WATER_ROWS = 3;   // rows y=0,1,2 are ocean — no building allowed
export const MAX_LEVEL  = 3;   // levels 0 (ground) through 3 (spire)

export const BLOCK_TYPES = {
  dry_sand:    { initial_health: 25 },
  wet_sand:    { initial_health: 40 },
  packed_sand: { initial_health: 60 },
  moat:        { initial_health: 0, permanent: true }, // immune to weather; cannot stack; tiered depth (1-3) grants 25/35/45% damage reduction to adjacent same-owner blocks
  courtyard:   { initial_health: 30, level0Only: true }, // paved interior floor; cannot stack; grants 25% prestige bonus to adjacent tower blocks (L2+)
  buttress:    { initial_health: 20, level0Only: true }, // fragile support block; level 0 only; grants +10 max HP and 1.2× prestige score to adjacent same-owner blocks; normal blocks can be stacked on top
};

export const VALID_ACTIONS = ['PLACE', 'REMOVE', 'REINFORCE', 'REPAIR_KIT', 'DEEPEN_MOAT'];

export const REINFORCE_AMOUNT = 15;
export const MAX_HEALTH = 60;
export const REPAIR_KIT_COOLDOWN = 5; // ticks between REPAIR_KIT uses per player
export const MOAT_DAMAGE_REDUCTION = 0.25; // shallow moat (default depth 1) — 25% damage reduction
// Tiered moat depth: depth 1 = shallow (25%), depth 2 = standard (35%), depth 3 = deep (45%)
export const MOAT_DEPTH_REDUCTIONS = { 1: 0.25, 2: 0.35, 3: 0.45 };
export const MOAT_MAX_DEPTH = 3;
export const COURTYARD_TOWER_BONUS = 0.25; // tower blocks (L2+) adjacent to courtyard get 25% prestige bonus
export const BUTTRESS_HP_BONUS = 10; // adjacent same-owner blocks get +10 max HP (cap raised from 60 to 70)
export const BUTTRESS_SCORE_MULTIPLIER = 1.2; // adjacent same-owner blocks get 1.2× prestige score
export const FLAGS_MAX_LABEL_LENGTH = 50;
export const FLAG_MIN_SPACING = 4; // flags must be >= 4 grid units apart (Euclidean), unless separated by empty cells
export const FLAG_DAMAGE_REDUCTION = 0.5; // flagged structures take 50% damage

// Weather damage formulae
export const BASE_DAMAGE = 3;  // minimum damage every tick regardless of weather
export const rainDamage  = (rain_mm)        => BASE_DAMAGE + Math.floor(rain_mm * 10);
export const windDamage  = (wind_speed_kph) => Math.floor(wind_speed_kph / 3);

// Random weather events — one is selected each tick
// weight is relative probability (they sum to 100)
export const WEATHER_EVENTS = [
  {
    id: 'calm',
    label: '☀️ Calm',
    weight: 20,
    damageMultiplier: 0.5,   // halved base damage
    windAffectsAll: false,
    description: 'Peaceful conditions. Light erosion only.',
  },
  {
    id: 'normal',
    label: '🌤 Normal',
    weight: 35,
    damageMultiplier: 1,
    windAffectsAll: false,
    description: 'Typical coastal weather.',
  },
  {
    id: 'storm',
    label: '⛈ Storm',
    weight: 25,
    damageMultiplier: 3,     // 3× base + rain damage everywhere
    windAffectsAll: true,    // wind hits all blocks, not just edge
    description: 'Heavy storm — all blocks take triple damage, wind hits everywhere.',
  },
  {
    id: 'wave_surge',
    label: '🌊 Wave Surge',
    weight: 12,
    damageMultiplier: 1,
    windAffectsAll: false,
    specialEffect: 'wave_surge',  // bottom 3 rows obliterated, rows above heavily damaged
    description: 'Massive wave surge — bottom 3 rows destroyed, rows above take 40 damage.',
  },
  {
    id: 'rogue_wave',
    label: '🌀 Rogue Wave',
    weight: 8,
    damageMultiplier: 1,
    windAffectsAll: false,
    specialEffect: 'rogue_wave',  // 1–2 random columns completely wiped
    description: 'Rogue wave strikes 1–2 random columns — everything in them destroyed.',
  },
];

// Prestige scoring — height-weighted score computed inside computeStructureScore
// Index = level (0–3); value = multiplier applied to block health
export const PRESTIGE_LEVEL_MULTIPLIERS = [1, 1.5, 2, 3];
// Extra multiplier awarded to a column when all four levels (L0–L3) are filled
export const STRUCTURAL_DEPTH_BONUS = 0.25;

// Visual scoring — every JUDGE_INTERVAL ticks, an LLM judges the castles
export const JUDGE_INTERVAL = 4;
export const JUDGE_MODEL = 'gpt-5.2';
export const MAX_JUDGMENTS_HISTORY = 50;

// Maximum number of history entries retained in the stored document.
// Cosmos DB has a 2 MB document size limit; each history entry contains two
// full cell snapshots (~56 KB each), so keeping all history causes 413 errors
// once the document grows beyond ~35 ticks.  Ten entries is a safe ceiling
// while still providing a useful recent-history window for agents and the UI.
export const MAX_HISTORY_IN_STORE = 10;

// Pick a random event by weight
export function selectWeatherEvent() {
  const total = WEATHER_EVENTS.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * total;
  for (const ev of WEATHER_EVENTS) {
    r -= ev.weight;
    if (r <= 0) return ev;
  }
  return WEATHER_EVENTS[1]; // fallback: normal
}
