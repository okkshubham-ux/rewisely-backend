"use strict";

/* In-memory game store, in the same spirit as the conversation store in server.js. */

const games = new Map();

const MAX_AGE_MS = 6 * 60 * 60 * 1000;

function put(game) {
  games.set(game.id, { game, touchedAt: Date.now() });
  return game;
}

function get(id) {
  const entry = games.get(id);
  if (!entry) return null;
  entry.touchedAt = Date.now();
  return entry.game;
}

function remove(id) {
  return games.delete(id);
}

function size() {
  return games.size;
}

/* Games are throwaway; drop the ones nobody has touched in hours. */
function sweep(now) {
  const cutoff = (now === undefined ? Date.now() : now) - MAX_AGE_MS;
  let removed = 0;
  for (const [id, entry] of games) {
    if (entry.touchedAt < cutoff) {
      games.delete(id);
      removed += 1;
    }
  }
  return removed;
}

module.exports = { put, get, remove, size, sweep, MAX_AGE_MS };
