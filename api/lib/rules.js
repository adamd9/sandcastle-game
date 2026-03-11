// Game rules constants — single source of truth consumed by gameLogic.js and GET /rules.

export const GRID_WIDTH = 20;
export const GRID_HEIGHT = 20;

export const ZONES = {
  player1: { x_min: 0, x_max: 9 },
  player2: { x_min: 10, x_max: 19 },
};

export const ACTIONS_PER_TICK = 12;

export const WATER_ROWS = 3;   // rows y=0,1,2 are ocean — no building allowed
export const MAX_LEVEL  = 3;   // levels 0 (ground) through 3 (spire)

export const BLOCK_TYPES = {
  dry_sand:    { initial_health: 25 },
  wet_sand:    { initial_health: 40 },
  packed_sand: { initial_health: 60 },
};

export const VALID_ACTIONS = ['PLACE', 'REMOVE', 'REINFORCE'];

export const REINFORCE_AMOUNT = 15;
export const MAX_HEALTH = 60;

// Weather damage formulae
export const BASE_DAMAGE = 5;  // minimum damage every tick regardless of weather
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
