// Game rules constants — single source of truth consumed by gameLogic.js and GET /rules.

export const GRID_WIDTH = 20;
export const GRID_HEIGHT = 20;

export const ZONES = {
  player1: { x_min: 0, x_max: 9 },
  player2: { x_min: 10, x_max: 19 },
};

export const ACTIONS_PER_TICK = 12;

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
