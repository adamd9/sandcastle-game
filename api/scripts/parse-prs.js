#!/usr/bin/env node
/**
 * parse-prs.js — Reconstruct SandCastle Wars game history from player turn PRs.
 *
 * Reads player-one-prs.json and player-two-prs.json, extracts tick numbers,
 * moves, and weather data, then outputs reconstructed-history.json.
 *
 * Usage: node api/scripts/parse-prs.js
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ────────────────────────────────────────────────────────────────────

const SESSION_DIR = '/Users/adam/.copilot/session-state/e698a727-4bd1-4c18-ac0c-265dd1aaf966/files';
const P1_FILE = resolve(SESSION_DIR, 'player-one-prs.json');
const P2_FILE = resolve(SESSION_DIR, 'player-two-prs.json');
const OUT_FILE = resolve(SESSION_DIR, 'reconstructed-history.json');

const MAX_TICK = 517;
const MIN_TICK = 1;
const MAX_VALID_TICK = 600; // Ignore numbers above this (likely years like 2026)

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract tick number from PR title and body.
 * Returns the tick number or null.
 */
function extractTick(pr) {
  const text = `${pr.title}\n${pr.body || ''}`;

  // Primary pattern: "Tick 123" or "Turn 123" or "tick #123"
  const patterns = [
    /[Tt]ick\s*#?\s*(\d+)/,
    /[Tt]urn\s+(\d+)/,
  ];

  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= MIN_TICK && n <= MAX_VALID_TICK) return n;
    }
  }

  // Secondary: look in body for "tick 123" mentions (might appear in context)
  const bodyMatches = [...(pr.body || '').matchAll(/[Tt]ick\s*#?\s*(\d+)/g)];
  for (const m of bodyMatches) {
    const n = parseInt(m[1], 10);
    if (n >= MIN_TICK && n <= MAX_VALID_TICK) return n;
  }

  return null;
}

/**
 * Estimate tick from timestamp using known tick-timestamp pairs.
 * Game ticks are hourly. We build a lookup from known ticks and
 * find the closest matching hour.
 */
function buildTickEstimator(prs) {
  const known = [];
  for (const pr of prs) {
    const tick = extractTick(pr);
    if (tick !== null && tick >= MIN_TICK && tick <= MAX_TICK) {
      known.push({ tick, time: new Date(pr.created_at).getTime() });
    }
  }
  if (known.length < 2) return () => null;

  // Sort by tick
  known.sort((a, b) => a.tick - b.tick);

  // Use linear regression on tick vs timestamp to estimate epoch
  const n = known.length;
  let sumT = 0, sumMs = 0, sumTMs = 0, sumT2 = 0;
  for (const { tick, time } of known) {
    sumT += tick;
    sumMs += time;
    sumTMs += tick * time;
    sumT2 += tick * tick;
  }
  const slope = (n * sumTMs - sumT * sumMs) / (n * sumT2 - sumT * sumT);
  const intercept = (sumMs - slope * sumT) / n;

  // slope ≈ ms per tick (should be ~3600000 for hourly)
  // intercept ≈ ms at tick 0

  return function estimateTick(timestamp) {
    const ms = new Date(timestamp).getTime();
    const estimated = Math.round((ms - intercept) / slope);
    return (estimated >= MIN_TICK && estimated <= MAX_TICK) ? estimated : null;
  };
}

/**
 * Determine if the PR represents a failed/blocked turn.
 */
function isFailed(pr) {
  const body = (pr.body || '').toLowerCase();
  const title = pr.title.toLowerCase();
  const combined = title + ' ' + body;

  // Strong indicators of failure
  const failPatterns = [
    'could not submit',
    'could not be played',
    'unavailable',
    'tool name mismatch',
    'not registered',
    'silently blocking',
    'silently filtered',
    'submit_move unavailable',
    'tools unavailable',
    'unable to submit',
    'not exposed',
    'not provisioned',
    'turn could not',
    'mcp tools unavailable',
    'mcp tool unavailability',
  ];

  const hasFail = failPatterns.some(p => combined.includes(p));

  // But if the PR also has "Moves submitted" or clear submission evidence, it might be partial
  const hasSubmission = /moves?\s*submitted|submitted\s*(?:via|successfully|12|all)/i.test(body)
    && !/not\s+submitted|could\s+not\s+submit/i.test(body);

  // Check for actual move action counts
  const hasMovesSection = /##\s*(?:moves|actions)\s*\(\d+\/\d+/i.test(body);

  // If it has a moves section with counts, treat as submitted even if title says unavailable
  if (hasMovesSection && !(/0\/12|0 of 12/.test(body))) return false;
  if (hasSubmission && hasMovesSection) return false;

  return hasFail;
}

/**
 * Determine if a PR has actual submitted moves (not just planned moves).
 */
function hasSubmittedMoves(pr) {
  const body = (pr.body || '');
  const bodyLower = body.toLowerCase();

  // Check for moves section with count
  if (/##\s*(?:moves|actions)\s*\(\d+\/\d+/i.test(body)) return true;
  if (/##\s*(?:moves|actions)\s+(?:submitted|taken)/i.test(body)) return true;
  if (/all\s+(?:12|actions)\s+(?:were|used)/i.test(bodyLower)) return true;
  if (/\d+\/12\s*(?:actions|moves)\s*(?:used|submitted)?/i.test(bodyLower)) return true;
  if (/submitted?\s+(?:via|successfully)/i.test(bodyLower)) return true;
  if (/moves?\s+submitted/i.test(bodyLower)) return true;

  // If we see "12× REINFORCE" or similar, likely submitted
  if (/\d+×\s*(?:REINFORCE|PLACE|REMOVE)/i.test(body)) return true;

  // "(N/N budget used)" patterns
  if (/\(\d+\s*\/\s*\d+\s*(?:budget|actions|moves)/i.test(body)) return true;

  // Check for action descriptions that look like actual submissions
  const actionLines = body.split('\n').filter(l =>
    /^\s*[-*]\s*\*?\*?(?:REINFORCE|PLACE|REMOVE|Reinforce|Place|Remove)/i.test(l) ||
    /^\s*[-*]\s*\*?\*?\d+\s*×\s*(?:REINFORCE|PLACE|REMOVE)/i.test(l)
  );
  if (actionLines.length >= 2) return true;

  // Bullet lines with coordinates in a moves/actions section
  const movesSection = body.match(/##\s*(?:Moves|Actions|Changes).*?\n([\s\S]*?)(?=##|$|<!--)/);
  if (movesSection) {
    const coordLines = movesSection[1].split('\n').filter(l =>
      /^\s*[-*]/.test(l) && /\(\d+\s*,?\s*\d+\)/.test(l)
    );
    if (coordLines.length >= 2) return true;
  }

  return false;
}

/**
 * Expand a range string like "3", "3–7", "3-7" into an array of integers.
 */
function expandRange(str) {
  str = str.trim();
  const rm = str.match(/^(\d{1,2})\s*[–\-→]\s*(\d{1,2})$/);
  if (rm) {
    const a = parseInt(rm[1]), b = parseInt(rm[2]);
    if (b >= a && b - a <= 20) {
      const result = [];
      for (let i = a; i <= b; i++) result.push(i);
      return result;
    }
  }
  const n = parseInt(str);
  return isNaN(n) ? [] : [n];
}

/**
 * Parse coordinate pairs from text. Returns array of {x, y}.
 * Aggressively handles many notation styles found in PR descriptions.
 */
function parseCoordinates(text) {
  const coords = [];
  const seen = new Set();
  const add = (x, y) => {
    const key = `${x},${y}`;
    if (!seen.has(key) && x >= 0 && x <= 19 && y >= 0 && y <= 19) {
      seen.add(key);
      coords.push({ x, y });
    }
  };

  // Pattern 1: explicit (x, y) pairs — most common
  for (const m of text.matchAll(/\((\d{1,2})\s*,\s*(\d{1,2})\)/g)) {
    add(parseInt(m[1]), parseInt(m[2]));
  }

  // Pattern 2: ranges in parens like (3-7, 8) or (3-7,16)
  for (const m of text.matchAll(/\((\d{1,2})\s*[–\-]\s*(\d{1,2})\s*,\s*(\d{1,2})\)/g)) {
    const x1 = parseInt(m[1]), x2 = parseInt(m[2]), y = parseInt(m[3]);
    if (x2 - x1 <= 20 && x2 > x1) {
      for (let x = x1; x <= x2; x++) add(x, y);
    }
  }
  // (3, 5-9)
  for (const m of text.matchAll(/\((\d{1,2})\s*,\s*(\d{1,2})\s*[–\-]\s*(\d{1,2})\)/g)) {
    const x = parseInt(m[1]), y1 = parseInt(m[2]), y2 = parseInt(m[3]);
    if (y2 - y1 <= 20 && y2 > y1) {
      for (let y = y1; y <= y2; y++) add(x, y);
    }
  }

  // Pattern 3: x=A–B, y=C–D (with = sign, ranges or singles)
  for (const m of text.matchAll(/x\s*=\s*(\d{1,2}(?:\s*[–\-→]\s*\d{1,2})?)\s*,?\s*y\s*=?\s*(\d{1,2}(?:\s*[–\-→]\s*\d{1,2})?)/g)) {
    const xs = expandRange(m[1]), ys = expandRange(m[2]);
    for (const x of xs) for (const y of ys) add(x, y);
  }
  // y=C–D, x=A–B (reversed)
  for (const m of text.matchAll(/y\s*=\s*(\d{1,2}(?:\s*[–\-→]\s*\d{1,2})?)\s*,?\s*x\s*=?\s*(\d{1,2}(?:\s*[–\-→]\s*\d{1,2})?)/g)) {
    const ys = expandRange(m[1]), xs = expandRange(m[2]);
    for (const x of xs) for (const y of ys) add(x, y);
  }

  // Pattern 4: x:A, y:B (colon notation) — "x:2,y:18" or "x:2–5, y:16"
  for (const m of text.matchAll(/x\s*:\s*(\d{1,2}(?:\s*[–\-→]\s*\d{1,2})?)\s*,?\s*y\s*:?\s*(\d{1,2}(?:\s*[–\-→]\s*\d{1,2})?)/g)) {
    const xs = expandRange(m[1]), ys = expandRange(m[2]);
    for (const x of xs) for (const y of ys) add(x, y);
  }

  // Pattern 5: inline backtick coords `(0,8)`–`(0,11)` (range of coords along one axis)
  for (const m of text.matchAll(/`?\((\d{1,2})\s*,\s*(\d{1,2})\)`?\s*[–\-]\s*`?\((\d{1,2})\s*,\s*(\d{1,2})\)`?/g)) {
    const x1 = parseInt(m[1]), y1 = parseInt(m[2]), x2 = parseInt(m[3]), y2 = parseInt(m[4]);
    if (x1 === x2 && Math.abs(y2 - y1) <= 20) {
      const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
      for (let y = lo; y <= hi; y++) add(x1, y);
    } else if (y1 === y2 && Math.abs(x2 - x1) <= 20) {
      const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
      for (let x = lo; x <= hi; x++) add(x, y1);
    } else {
      add(x1, y1);
      add(x2, y2);
    }
  }

  // Pattern 6: "at x=9, y=7→14" or "at x=9, y=9–13" (arrow ranges)
  // Already handled by Pattern 3 with → support

  // Pattern 7: (range, y=N) like "(2–6, y=7)" or "(x=2, 8–10)"
  for (const m of text.matchAll(/\((\d{1,2})\s*[–\-]\s*(\d{1,2})\s*,\s*y\s*[=:]?\s*(\d{1,2})\)/g)) {
    const xs = expandRange(`${m[1]}–${m[2]}`);
    const y = parseInt(m[3]);
    for (const x of xs) add(x, y);
  }
  for (const m of text.matchAll(/\(x\s*[=:]?\s*(\d{1,2})\s*,\s*(\d{1,2})\s*[–\-]\s*(\d{1,2})\)/g)) {
    const x = parseInt(m[1]);
    const ys = expandRange(`${m[2]}–${m[3]}`);
    for (const y of ys) add(x, y);
  }

  // Pattern 8: table row coords like "| (5,10) L3 |"
  // Already handled by Pattern 1

  // Pattern 9: "y=0, x=0–9" — reversed axis=range
  // Already handled by Pattern 3 reversed variant

  // Pattern 10: multi-coord on one line: "(9,8/9; x=3; ...)" — slash-separated y values
  for (const m of text.matchAll(/\((\d{1,2})\s*,\s*(\d{1,2})\s*\/\s*(\d{1,2})\)/g)) {
    const x = parseInt(m[1]);
    add(x, parseInt(m[2]));
    add(x, parseInt(m[3]));
  }

  // Pattern 11: y=N with x=A–B on same line (e.g., "y=14, x=2–8")
  for (const m of text.matchAll(/y\s*[=:]\s*(\d{1,2})\s*,?\s*x\s*[=:]\s*(\d{1,2})\s*[–\-→]\s*(\d{1,2})/g)) {
    const y = parseInt(m[1]);
    const xs = expandRange(`${m[2]}–${m[3]}`);
    for (const x of xs) add(x, y);
  }

  // Pattern 12: "(x=6, y=8–10)" — explicit axis labels in parens
  for (const m of text.matchAll(/\(\s*x\s*[=:]\s*(\d{1,2}(?:\s*[–\-→]\s*\d{1,2})?)\s*,\s*y\s*[=:]\s*(\d{1,2}(?:\s*[–\-→]\s*\d{1,2})?)\s*\)/g)) {
    const xs = expandRange(m[1]), ys = expandRange(m[2]);
    for (const x of xs) for (const y of ys) add(x, y);
  }

  return coords;
}

/**
 * Parse move lines from a PR body. Each move has action, x, y, optional level, block_type.
 */
function parseMoves(body) {
  if (!body) return [];

  const moves = [];
  const lines = body.split('\n');

  // We'll process the body in chunks — each line with action keywords gets coordinates
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLower = line.toLowerCase();

    // Skip lines that are clearly not move-related
    if (lineLower.startsWith('<!--') || lineLower.startsWith('> <')) continue;
    if (lineLower.includes('copilot original') || lineLower.includes('<details')) continue;
    if (lineLower.includes('next turn priorities') || lineLower.includes('## reasoning')) continue;
    if (lineLower.includes('## next') || lineLower.includes('## strategy')) continue;

    // Determine action type from line context
    let action = null;
    if (/\bREINFORCE\b/i.test(line) || /\breinforced?\b/i.test(line) ||
        /\btopped\s+up\b/i.test(lineLower) || /\bboosted?\b/i.test(lineLower) ||
        /\bemergency\b/i.test(lineLower) && /\breinforce/i.test(lineLower) ||
        /\bshored\s+up\b/i.test(lineLower) || /\bpatched\b/i.test(lineLower) ||
        /\bHP\s*→\s*\d+\s*HP/i.test(line) || /\d+\s*HP\s*→\s*\d+/i.test(line) ||
        /raised.*from.*L\d/i.test(line)) {
      action = 'REINFORCE';
    } else if (/\bPLACE[Dd]?\b/i.test(line) || /\bplacing\b/i.test(lineLower) ||
               /\bnew\b.*\bpacked_sand\b/i.test(lineLower) ||
               /\bextend/i.test(lineLower) || /\bfilled?\s+\d+\s+gaps?/i.test(lineLower) ||
               /\bplaced?\s+\d+\s+new\b/i.test(lineLower) ||
               /\bplaced?\s+.*packed_sand/i.test(lineLower) ||
               /\bplaced?\s+.*moat/i.test(lineLower) ||
               /\bplaced?\s+.*courtyard/i.test(lineLower)) {
      action = 'PLACE';
    } else if (/\bREMOVE[Dd]?\b/i.test(line) || /\bremoving\b/i.test(lineLower) ||
               /\bdemolish/i.test(lineLower) || /\bsacrifice/i.test(lineLower) && /\bremov/i.test(lineLower)) {
      action = 'REMOVE';
    }

    // If no clear action keyword, check broader patterns
    if (!action) {
      // Lines with bullet points and coordinates might still be moves
      if (/^\s*[-*]/.test(line) && /\(\d+\s*,\s*\d+\)/.test(line)) {
        // Try to infer from nearby context
        const context = lines.slice(Math.max(0, i - 3), i + 1).join(' ');
        if (/\bREINFORCE/i.test(context) || /reinforc/i.test(context) || /HP/i.test(context)) {
          action = 'REINFORCE';
        } else if (/\bPLACE/i.test(context) || /\bplac/i.test(context) || /\bnew\b/i.test(context)) {
          action = 'PLACE';
        } else {
          action = 'REINFORCE'; // Default for unlabeled bullet lines with coords
        }
      }
      // Lines with x=, y= range patterns
      else if (/^\s*[-*]/.test(line) && /[xy]\s*[=:]\s*\d+/.test(line)) {
        const context = lines.slice(Math.max(0, i - 3), i + 1).join(' ');
        if (/\bREINFORCE/i.test(context) || /reinforc/i.test(context) || /HP/i.test(context)) {
          action = 'REINFORCE';
        } else if (/\bPLACE/i.test(context) || /\bplac/i.test(context) || /\bnew\b/i.test(context)) {
          action = 'PLACE';
        } else {
          action = 'REINFORCE';
        }
      }
      // Table rows with coordinates
      else if (/^\s*\|/.test(line) && /\(\d+\s*,?\s*\d+\)/.test(line)) {
        const context = lines.slice(Math.max(0, i - 5), i + 1).join(' ');
        if (/\bPLACE/i.test(context) || /\bplac/i.test(context)) {
          action = 'PLACE';
        } else {
          action = 'REINFORCE';
        }
      }
    }

    if (!action) continue;

    // Extract coordinates from this line
    const lineCoords = parseCoordinates(line);

    // If no coords on this line, check for range notation "x=0–9, y=0"
    // already handled by parseCoordinates

    // Determine block type
    let blockType = 'packed_sand';
    if (/\bmoat\b/i.test(line)) blockType = 'moat';
    else if (/\bcourtyard\b/i.test(line)) blockType = 'courtyard';
    else if (/\bbuttress\b/i.test(line)) blockType = 'buttress';
    else if (/\bparapet\b/i.test(line)) blockType = 'parapet';
    else if (/\breinforced_wall\b/i.test(line)) blockType = 'reinforced_wall';

    // Extract level
    let level = 0;
    const levelMatch = line.match(/\bL(\d)\b/) || line.match(/\b[Ll]evel\s*(\d)\b/);
    if (levelMatch) level = parseInt(levelMatch[1]);

    // Check for "→ L3" pattern (indicates resulting level)
    const resultLevel = line.match(/→\s*L(\d)/);
    if (resultLevel) level = parseInt(resultLevel[1]);

    // Handle multiplier patterns like "12× REINFORCE" or "Reinforce ×10"
    const multiplierMatch = line.match(/(\d+)\s*×\s*(?:REINFORCE|PLACE|REMOVE)/i)
      || line.match(/(?:REINFORCE|PLACE|REMOVE)\s*×?\s*(\d+)/i);

    // If we have a multiplier but fewer coords, the coords represent targets
    // Process coords we found
    for (const { x, y } of lineCoords) {
      moves.push({
        action,
        x,
        y,
        level: action === 'PLACE' ? level : level,
        block_type: blockType,
      });
    }

    // If multiplier found but no coords, we still record what we know
    // (can't do much without coordinates)
  }

  return moves;
}

/**
 * Extract weather information from PR body.
 */
function extractWeather(body) {
  if (!body) return { event_name: null, event_type: null, rain_mm: null, wind_speed_kph: null, wind_direction: null };

  const weather = {
    event_name: null,
    event_type: null,
    rain_mm: null,
    wind_speed_kph: null,
    wind_direction: null,
  };

  // Extract event name — look for quoted strings near weather context
  const namePatterns = [
    /(?:weather|event|storm)(?:\s+(?:event|conditions?))?\s*[:=]\s*[""]([A-Z][A-Za-z\s]+?)[""](?:\s*\()?/i,
    /(?:under|during|active)\s+[""]([A-Z][A-Za-z\s]+?)[""]?\s+(?:storm|event|weather|conditions)/i,
    /(?:under|during|active)\s+\*?\*?[""]?([A-Z][A-Za-z\s]+?)[""]?\*?\*?\s+(?:storm|event|weather|conditions)/i,
    /responding\s+to\s+\*?\*?[""]?([A-Z][A-Za-z\s]+?)[""]?\*?\*?\s+(?:weather|event|storm)/i,
  ];

  for (const pat of namePatterns) {
    const m = body.match(pat);
    if (m && m[1].length > 3 && m[1].length < 40) {
      const name = m[1].trim();
      // Filter out false positives — castle structure names, generic words, not weather events
      const BANNED_NAME_STARTS = /^(Player|Copilot|SandCastle|GitHub|Changes|Prior|Result|North|South|East|West|Row|Column|Block|Inner|Outer|Tower|Wall|Keep|Castle|Moat|Flag)/i;
      const GENERIC_WORDS = /^(calm|active|severe|heavy|heavy rain|storm|normal|clear|mild|strong|sustained|adverse|current|ongoing|moderate|significant|minimal|light|extreme|intense|critical|dangerous|SE wind|NE wind|NW wind|SW wind|N wind|S wind|E wind|W wind)$/i;
      if (!BANNED_NAME_STARTS.test(name) && !GENERIC_WORDS.test(name) && name.includes(' ')) {
        weather.event_name = name;
        break;
      }
    }
  }

  // Extract rain mm
  const rainMatch = body.match(/(\d+(?:\.\d+)?)\s*mm(?:\s+rain)?/);
  if (rainMatch) weather.rain_mm = parseFloat(rainMatch[1]);

  // Extract wind speed
  const windMatch = body.match(/(\d+(?:\.\d+)?)\s*kph/);
  if (windMatch) weather.wind_speed_kph = parseFloat(windMatch[1]);

  // Extract wind direction
  const dirPatterns = [
    /(\b[NSEW]{1,2})\s+wind/i,
    /wind.*?(?:from\s+)?(?:the\s+)?(\b[NSEW]{1,2})\b/i,
    /(\b(?:NE|NW|SE|SW|N|S|E|W)\b)\s+(?:\d|wind)/,
  ];
  for (const pat of dirPatterns) {
    const m = body.match(pat);
    if (m) {
      weather.wind_direction = m[1].toUpperCase();
      break;
    }
  }

  // Determine event type
  const bodyLower = body.toLowerCase();
  if (/\bstorm\b|\bwave\s+surge\b|\bsurge\b|\bgale\b|\brogue\s+wave\b|\btornado\b|\bhurricane\b|\btyphoon\b|\bcyclone\b/.test(bodyLower)) {
    weather.event_type = 'storm';
  } else if (/\bcalm\b|\bclear\b|\bperfect\b|\blifeguard\s+boredom\b|\bserene\b|\bpeaceful\b|\bideal\b|\bmild\b/.test(bodyLower)) {
    weather.event_type = 'calm';
  } else {
    weather.event_type = 'normal';
  }

  return weather;
}

/**
 * Count actions from the body, looking for "(N/12)" or "N actions" patterns.
 */
function extractActionCount(body) {
  if (!body) return 0;

  // Look for "(12/12)" or "(10/12 actions)" — standard format
  const countMatch = body.match(/\((\d+)\s*\/\s*12\s*(?:actions|moves)?\s*\)/i);
  if (countMatch) return Math.min(parseInt(countMatch[1]), 12);

  // "12/12 actions used" or "12/12 moves"
  const countMatch2 = body.match(/(\d+)\s*\/\s*12\s*(?:actions|moves)\s*(?:used|submitted)?/i);
  if (countMatch2) return Math.min(parseInt(countMatch2[1]), 12);

  // "All 12 actions" or "12 actions submitted"
  const allMatch = body.match(/(?:all\s+)?(\d+)\s+(?:actions?|moves?)\s+(?:used|submitted|were)/i);
  if (allMatch) return Math.min(parseInt(allMatch[1]), 12);

  // "12× REINFORCE" pattern
  const multMatch = body.match(/(\d+)\s*×/);
  if (multMatch) return Math.min(parseInt(multMatch[1]), 12);

  // "(N/N budget used)" — variable budget format
  const budgetMatch = body.match(/\((\d+)\s*\/\s*\d+\s*(?:budget|actions?|moves?)?\s*(?:used)?\)/i);
  if (budgetMatch) return Math.min(parseInt(budgetMatch[1]), 12);

  return 0;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

console.log('=== SandCastle Wars PR History Parser ===\n');

// Load PR data
const p1Prs = JSON.parse(readFileSync(P1_FILE, 'utf-8'));
const p2Prs = JSON.parse(readFileSync(P2_FILE, 'utf-8'));

console.log(`Loaded ${p1Prs.length} player-one PRs, ${p2Prs.length} player-two PRs`);

// Stats tracking
const stats = {
  p1: { total: 0, tickFound: 0, withMoves: 0, failed: 0, skippedRange: 0, movesExtracted: 0 },
  p2: { total: 0, tickFound: 0, withMoves: 0, failed: 0, skippedRange: 0, movesExtracted: 0 },
  duplicatesResolved: 0,
  ticksWithBothPlayers: 0,
  ticksWithOnePlayer: 0,
  totalEntries: 0,
};

/**
 * Process an array of PRs for one player.
 * Returns Map<tick, { pr, moves, weather, actionCount, committed, timestamp }>
 */
function processPRs(prs, playerKey) {
  const s = stats[playerKey];
  const tickMap = new Map();
  const estimateTick = buildTickEstimator(prs);
  let timestampEstimated = 0;

  for (const pr of prs) {
    s.total++;
    let tick = extractTick(pr);

    // Fall back to timestamp-based estimation
    if (tick === null) {
      tick = estimateTick(pr.created_at);
      if (tick !== null) timestampEstimated++;
    }

    if (tick === null) continue;
    s.tickFound++;

    if (tick < MIN_TICK || tick > MAX_TICK) {
      s.skippedRange++;
      continue;
    }

    const failed = isFailed(pr);
    const submitted = !failed && hasSubmittedMoves(pr);

    if (failed) {
      s.failed++;
      // Still record the tick if no better data exists
      if (!tickMap.has(tick)) {
        tickMap.set(tick, {
          pr,
          moves: [],
          weather: extractWeather(pr.body),
          actionCount: 0,
          committed: false,
          timestamp: pr.created_at,
        });
      }
      continue;
    }

    const moves = parseMoves(pr.body);
    const weather = extractWeather(pr.body);
    const actionCount = Math.min(extractActionCount(pr.body) || moves.length, 12);

    s.movesExtracted += moves.length;

    // Dedup: keep PR with most moves
    if (tickMap.has(tick)) {
      const existing = tickMap.get(tick);
      if (moves.length > existing.moves.length) {
        stats.duplicatesResolved++;
        tickMap.set(tick, { pr, moves, weather, actionCount, committed: submitted, timestamp: pr.created_at });
      } else {
        stats.duplicatesResolved++;
      }
    } else {
      tickMap.set(tick, { pr, moves, weather, actionCount, committed: submitted, timestamp: pr.created_at });
    }

    if (submitted) s.withMoves++;
  }

  if (timestampEstimated > 0) {
    console.log(`  ${playerKey}: ${timestampEstimated} ticks estimated from timestamp`);
  }

  return tickMap;
}

const p1Map = processPRs(p1Prs, 'p1');
const p2Map = processPRs(p2Prs, 'p2');

console.log(`\nPlayer 1: ${p1Map.size} ticks extracted (${stats.p1.tickFound} ticks found, ${stats.p1.failed} failed, ${stats.p1.skippedRange} out-of-range)`);
console.log(`Player 2: ${p2Map.size} ticks extracted (${stats.p2.tickFound} ticks found, ${stats.p2.failed} failed, ${stats.p2.skippedRange} out-of-range)`);

// Merge ticks from both players
const allTicks = new Set([...p1Map.keys(), ...p2Map.keys()]);
const history = [];

for (const tick of allTicks) {
  const p1Data = p1Map.get(tick);
  const p2Data = p2Map.get(tick);

  // Pick earliest timestamp
  let timestamp = null;
  if (p1Data && p2Data) {
    timestamp = p1Data.timestamp < p2Data.timestamp ? p1Data.timestamp : p2Data.timestamp;
    stats.ticksWithBothPlayers++;
  } else if (p1Data) {
    timestamp = p1Data.timestamp;
    stats.ticksWithOnePlayer++;
  } else {
    timestamp = p2Data.timestamp;
    stats.ticksWithOnePlayer++;
  }

  // Merge weather: prefer data from whichever has more info
  let weather = { event_name: null, event_type: null, rain_mm: null, wind_speed_kph: null, wind_direction: null };
  const weathers = [p1Data?.weather, p2Data?.weather].filter(Boolean);
  for (const w of weathers) {
    // Fill in nulls from available sources
    if (w.event_name && !weather.event_name) weather.event_name = w.event_name;
    if (w.event_type && w.event_type !== 'normal' && (!weather.event_type || weather.event_type === 'normal')) weather.event_type = w.event_type;
    if (w.rain_mm !== null && weather.rain_mm === null) weather.rain_mm = w.rain_mm;
    if (w.wind_speed_kph !== null && weather.wind_speed_kph === null) weather.wind_speed_kph = w.wind_speed_kph;
    if (w.wind_direction !== null && !weather.wind_direction) weather.wind_direction = w.wind_direction;
  }
  // Default event_type if still null
  if (!weather.event_type) weather.event_type = 'normal';

  const entry = {
    tick,
    timestamp,
    weather,
    moves: {
      player1: p1Data?.moves || [],
      player2: p2Data?.moves || [],
    },
    player1: {
      actions: p1Data?.actionCount || 0,
      committed: p1Data?.committed || false,
      blocks: 0,
    },
    player2: {
      actions: p2Data?.actionCount || 0,
      committed: p2Data?.committed || false,
      blocks: 0,
    },
    weatherEvents: [],
    cells: [],
    cells_after_weather: null,
    flags_snapshot: [],
    score_breakdown: null,
    _reconstructed: true,
    _source: {
      player1_pr: p1Data?.pr?.number || null,
      player2_pr: p2Data?.pr?.number || null,
    },
  };

  history.push(entry);
}

// Sort by tick ascending
history.sort((a, b) => a.tick - b.tick);
stats.totalEntries = history.length;

// Write output
writeFileSync(OUT_FILE, JSON.stringify(history, null, 2));
console.log(`\nWrote ${history.length} history entries to ${OUT_FILE}`);

// ─── Stats ─────────────────────────────────────────────────────────────────────

const p1Moves = history.reduce((sum, e) => sum + e.moves.player1.length, 0);
const p2Moves = history.reduce((sum, e) => sum + e.moves.player2.length, 0);
const p1Committed = history.filter(e => e.player1.committed).length;
const p2Committed = history.filter(e => e.player2.committed).length;
const withWeatherName = history.filter(e => e.weather.event_name).length;
const withStorm = history.filter(e => e.weather.event_type === 'storm').length;
const tickRange = history.length > 0
  ? `${history[0].tick}–${history[history.length - 1].tick}`
  : 'none';

console.log('\n=== Summary Statistics ===');
console.log(`Total history entries:      ${stats.totalEntries}`);
console.log(`Tick range:                 ${tickRange}`);
console.log(`Ticks with both players:    ${stats.ticksWithBothPlayers}`);
console.log(`Ticks with only one player: ${stats.ticksWithOnePlayer}`);
console.log(`Duplicate PRs resolved:     ${stats.duplicatesResolved}`);
console.log('');
console.log('--- Player 1 ---');
console.log(`  PRs processed:            ${stats.p1.total}`);
console.log(`  Ticks identified:         ${stats.p1.tickFound}`);
console.log(`  Successful turns:         ${stats.p1.withMoves}`);
console.log(`  Failed turns:             ${stats.p1.failed}`);
console.log(`  Out-of-range skipped:     ${stats.p1.skippedRange}`);
console.log(`  Total moves extracted:    ${stats.p1.movesExtracted}`);
console.log(`  Committed ticks:          ${p1Committed}`);
console.log(`  Moves in output:          ${p1Moves}`);
console.log('');
console.log('--- Player 2 ---');
console.log(`  PRs processed:            ${stats.p2.total}`);
console.log(`  Ticks identified:         ${stats.p2.tickFound}`);
console.log(`  Successful turns:         ${stats.p2.withMoves}`);
console.log(`  Failed turns:             ${stats.p2.failed}`);
console.log(`  Out-of-range skipped:     ${stats.p2.skippedRange}`);
console.log(`  Total moves extracted:    ${stats.p2.movesExtracted}`);
console.log(`  Committed ticks:          ${p2Committed}`);
console.log(`  Moves in output:          ${p2Moves}`);
console.log('');
console.log('--- Weather ---');
console.log(`  Named events:             ${withWeatherName}`);
console.log(`  Storm ticks:              ${withStorm}`);
console.log(`  With rain data:           ${history.filter(e => e.weather.rain_mm !== null).length}`);
console.log(`  With wind data:           ${history.filter(e => e.weather.wind_speed_kph !== null).length}`);

// Show sample entries
console.log('\n=== Sample Entries ===');
for (const entry of history.slice(0, 3)) {
  console.log(`\nTick ${entry.tick} (${entry.timestamp}):`);
  console.log(`  Weather: ${entry.weather.event_name || 'unknown'} (${entry.weather.event_type})`);
  console.log(`  P1: ${entry.moves.player1.length} moves, committed=${entry.player1.committed}`);
  console.log(`  P2: ${entry.moves.player2.length} moves, committed=${entry.player2.committed}`);
  console.log(`  Source: P1 PR#${entry._source.player1_pr}, P2 PR#${entry._source.player2_pr}`);
}
