"use strict";

const express = require("express");
const engine = require("./engine");
const store = require("./store");
const C = require("./cards");

const router = express.Router();

/* -------------------- HELPERS -------------------- */

function loadGame(req, res) {
  const game = store.get(req.params.id);
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return null;
  }
  return game;
}

/*
  Hands are secret, so every action carries the player's secret from
  the create response, either as a header or in the body.
*/
function authenticate(game, req, res, playerId) {
  /* Express 5 leaves req.body undefined when the request carries no body. */
  const body = req.body || {};
  const id = playerId || body.playerId;
  const secret = req.get("x-player-secret") || body.secret || req.query.secret;

  const player = engine.findPlayer(game, id);
  if (!player) {
    res.status(404).json({ error: `No player ${id} in this game` });
    return null;
  }
  if (!secret || secret !== player.secret) {
    res.status(403).json({ error: "Wrong or missing player secret" });
    return null;
  }
  return player;
}

function fail(res, error) {
  if (error instanceof engine.GameError) {
    return res.status(400).json({ error: error.message, code: error.code });
  }
  console.error("Love Letter error:", error);
  return res.status(500).json({ error: "Internal error" });
}

/* -------------------- REFERENCE -------------------- */

router.get("/cards", (req, res) => {
  res.json({
    edition: "2019",
    deckSize: C.DECK_SIZE,
    players: { min: C.MIN_PLAYERS, max: C.MAX_PLAYERS },
    tokensToWin: C.TOKENS_TO_WIN,
    cards: Object.values(C.CARDS)
  });
});

/* -------------------- CREATE -------------------- */

router.post("/games", (req, res) => {
  try {
    const { players, tokensToWin, seed } = req.body || {};
    const game = engine.createGame({ players, tokensToWin, seed });
    store.put(game);
    store.sweep();

    res.status(201).json({
      game: engine.publicView(game),
      /* Handed out once: each player needs their own secret to see their hand. */
      secrets: game.players.map(p => ({ playerId: p.id, name: p.name, secret: p.secret }))
    });
  } catch (error) {
    fail(res, error);
  }
});

/* -------------------- STATE -------------------- */

router.get("/games/:id", (req, res) => {
  const game = loadGame(req, res);
  if (!game) return;
  res.json(engine.publicView(game));
});

router.get("/games/:id/players/:playerId", (req, res) => {
  const game = loadGame(req, res);
  if (!game) return;
  const player = authenticate(game, req, res, req.params.playerId);
  if (!player) return;

  try {
    res.json(engine.privateView(game, player.id));
  } catch (error) {
    fail(res, error);
  }
});

/* -------------------- ACTIONS -------------------- */

router.post("/games/:id/play", (req, res) => {
  const game = loadGame(req, res);
  if (!game) return;
  const player = authenticate(game, req, res);
  if (!player) return;

  try {
    const { card, target, guess } = req.body || {};
    const outcome = engine.play(game, player.id, { card, target, guess });
    res.json({ outcome, game: engine.privateView(game, player.id) });
  } catch (error) {
    fail(res, error);
  }
});

router.post("/games/:id/chancellor", (req, res) => {
  const game = loadGame(req, res);
  if (!game) return;
  const player = authenticate(game, req, res);
  if (!player) return;

  try {
    const { keep, bottom } = req.body || {};
    const outcome = engine.chancellor(game, player.id, { keep, bottom });
    res.json({ outcome, game: engine.privateView(game, player.id) });
  } catch (error) {
    fail(res, error);
  }
});

router.post("/games/:id/next-round", (req, res) => {
  const game = loadGame(req, res);
  if (!game) return;
  const player = authenticate(game, req, res);
  if (!player) return;

  try {
    engine.nextRound(game);
    res.json(engine.privateView(game, player.id));
  } catch (error) {
    fail(res, error);
  }
});

router.delete("/games/:id", (req, res) => {
  const game = loadGame(req, res);
  if (!game) return;
  const player = authenticate(game, req, res);
  if (!player) return;
  store.remove(game.id);
  res.json({ deleted: true });
});

module.exports = router;
