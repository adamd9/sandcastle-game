// Game rules constants — single source of truth consumed by gameLogic.js and GET /rules.

export const GRID_WIDTH = 20;
export const GRID_HEIGHT = 20;

export const ZONES = {
  player1: { x_min: 0, x_max: 9 },
  player2: { x_min: 10, x_max: 19 },
};

export const ACTIONS_PER_TICK = 12;

export const BLOCK_TYPES = {
  dry_sand:    { initial_health: 40 },
  wet_sand:    { initial_health: 60 },
  packed_sand: { initial_health: 100 },
};

export const VALID_ACTIONS = ['PLACE', 'REMOVE', 'REINFORCE'];

export const REINFORCE_AMOUNT = 20;
export const MAX_HEALTH = 100;

// Weather damage formulae
export const rainDamage  = (rain_mm)       => Math.floor(rain_mm * 2);
export const windDamage  = (wind_speed_kph) => Math.floor(wind_speed_kph / 5);
