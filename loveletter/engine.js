(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./cards"));
  } else {
    root.LoveLetterEngine = factory(root.LoveLetterCards);
  }
})(typeof self !== "undefined" ? self : globalThis, function (C) {
"use strict";

/* Node 19+ and every browser expose crypto globally. */
function uuid() {
  const platform = globalThis.crypto;
  if (platform && typeof platform.randomUUID === "function") return platform.randomUUID();
  return "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, ch => {
    const r = Math.floor(Math.random() * 16);
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/* -------------------- ERRORS -------------------- */

class GameError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GameError";
    this.code = code;
  }
}

/* -------------------- RANDOMNESS -------------------- */

/* Small seeded PRNG so games (and tests) can be reproduced. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(deck, rng) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  return deck;
}

/* -------------------- HELPERS -------------------- */

function current(game) {
  return game.players[game.round.turn];
}

function activePlayers(game) {
  return game.players.filter(p => !p.eliminated);
}

function findPlayer(game, playerId) {
  return game.players.find(p => p.id === playerId) || null;
}

function discardSum(player) {
  return player.discards.reduce((sum, card) => sum + card, 0);
}

function mustPlayCountess(hand) {
  return hand.includes(C.COUNTESS) && (hand.includes(C.KING) || hand.includes(C.PRINCE));
}

function logPublic(game, text) {
  game.round.log.push({ turn: game.round.log.length + 1, text, to: null });
}

function logPrivate(game, playerId, text) {
  game.round.log.push({ turn: game.round.log.length + 1, text, to: playerId });
}

/*
  Players this card may legally be played against: still in the round and
  not shielded by a Handmaid. A player is never protected on their own turn,
  so the Prince can always choose its own player.
*/
function legalTargets(game, player, card) {
  if (!C.needsTarget(card)) return [];
  return game.players
    .filter(p => {
      if (p.eliminated) return false;
      if (p.protected) return false;
      if (p.id === player.id) return C.canTargetSelf(card);
      return true;
    })
    .map(p => p.id);
}

function eliminate(game, player, reason) {
  if (player.eliminated) return;
  player.eliminated = true;
  while (player.hand.length) player.discards.push(player.hand.pop());
  player.protected = false;
  logPublic(game, `${player.name} is out of the round (${reason}).`);
}

/* -------------------- GAME CREATION -------------------- */

function createGame(options) {
  const opts = options || {};
  const names = Array.isArray(opts.players) ? opts.players : [];

  if (names.length < C.MIN_PLAYERS || names.length > C.MAX_PLAYERS) {
    throw new GameError(
      "invalid_player_count",
      `Love Letter is for ${C.MIN_PLAYERS} to ${C.MAX_PLAYERS} players, got ${names.length}.`
    );
  }

  const players = names.map((rawName, index) => {
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name) throw new GameError("invalid_player_name", `Player ${index + 1} needs a name.`);
    return {
      id: `p${index + 1}`,
      name,
      secret: uuid(),
      tokens: 0,
      hand: [],
      discards: [],
      eliminated: false,
      protected: false
    };
  });

  let tokensToWin = C.TOKENS_TO_WIN[players.length];
  if (opts.tokensToWin !== undefined && opts.tokensToWin !== null) {
    const requested = Number(opts.tokensToWin);
    if (!Number.isInteger(requested) || requested < 1 || requested > 20) {
      throw new GameError("invalid_tokens_to_win", "tokensToWin must be an integer between 1 and 20.");
    }
    tokensToWin = requested;
  }

  const game = {
    id: uuid(),
    createdAt: new Date().toISOString(),
    seed: opts.seed === undefined ? null : Number(opts.seed),
    rng: opts.seed === undefined ? Math.random : mulberry32(Number(opts.seed)),
    tokensToWin,
    status: "in_progress",
    players,
    nextStarter: 0,
    round: null,
    winners: []
  };

  startRound(game);
  return game;
}

/* -------------------- ROUND SETUP -------------------- */

function startRound(game) {
  const count = game.players.length;
  const deck = shuffle(C.buildDeck(), game.rng);

  /* One card is always removed face down, so the deck can never be fully counted. */
  const burned = deck.pop();

  /* In a two player game three more cards are removed face up. */
  const setAside = [];
  if (count === 2) {
    for (let i = 0; i < 3; i++) setAside.push(deck.pop());
  }

  for (const player of game.players) {
    player.hand = [];
    player.discards = [];
    player.eliminated = false;
    player.protected = false;
  }

  game.round = {
    number: game.round ? game.round.number + 1 : 1,
    deck,
    burned,
    burnedTaken: false,
    setAside,
    turn: game.nextStarter,
    phase: "play",
    pending: null,
    result: null,
    log: []
  };

  logPublic(game, `Round ${game.round.number} begins.`);
  if (setAside.length) {
    logPublic(game, `Set aside face up: ${setAside.map(C.name).join(", ")}.`);
  }

  /* Deal one card each, starting with the player who leads the round. */
  for (let i = 0; i < count; i++) {
    const player = game.players[(game.nextStarter + i) % count];
    player.hand.push(deck.pop());
  }

  beginTurn(game);
  return game;
}

function beginTurn(game) {
  const player = current(game);
  player.protected = false;
  player.hand.push(game.round.deck.pop());
  game.round.phase = "play";
}

/* -------------------- PLAYING A CARD -------------------- */

function play(game, playerId, action) {
  const move = action || {};
  const player = requireTurn(game, playerId);

  if (game.round.phase === "chancellor") {
    throw new GameError("chancellor_pending", "Resolve the Chancellor before playing another card.");
  }
  if (game.round.phase !== "play") {
    throw new GameError("wrong_phase", "No card can be played right now.");
  }

  const card = Number(move.card);
  if (!C.isCard(card)) throw new GameError("invalid_card", `${move.card} is not a Love Letter card.`);
  if (!player.hand.includes(card)) {
    throw new GameError("card_not_held", `${player.name} is not holding the ${C.name(card)}.`);
  }
  if (mustPlayCountess(player.hand) && card !== C.COUNTESS) {
    throw new GameError(
      "countess_required",
      "The Countess must be played when the other card in hand is a King or a Prince."
    );
  }

  /* Resolve targeting before the card leaves the hand. */
  const targets = legalTargets(game, player, card);
  let target = null;

  if (C.needsTarget(card)) {
    if (targets.length === 0) {
      if (move.target) {
        throw new GameError("no_legal_target", "Every other player is protected or out; play the card with no target.");
      }
    } else {
      if (!move.target) throw new GameError("target_required", `The ${C.name(card)} must choose a player.`);
      if (!targets.includes(move.target)) {
        throw new GameError("illegal_target", `${move.target} cannot be chosen right now.`);
      }
      target = findPlayer(game, move.target);
    }
  } else if (move.target) {
    throw new GameError("target_not_allowed", `The ${C.name(card)} does not choose a player.`);
  }

  let guess = null;
  if (card === C.GUARD && target) {
    if (move.guess === undefined || move.guess === null || move.guess === "") {
      throw new GameError("guess_required", "The Guard must name a card.");
    }
    guess = Number(move.guess);
    if (!C.isCard(guess)) throw new GameError("invalid_guess", `${move.guess} is not a Love Letter card.`);
    if (guess === C.GUARD) throw new GameError("invalid_guess", "The Guard cannot name another Guard.");
  }

  /* The played card hits the discard pile before its effect resolves. */
  player.hand.splice(player.hand.indexOf(card), 1);
  player.discards.push(card);
  logPublic(
    game,
    `${player.name} plays the ${C.name(card)}` +
      (target ? ` on ${target.name}` : "") +
      (guess !== null ? `, naming the ${C.name(guess)}` : "") +
      "."
  );

  const outcome = resolve(game, player, card, target, guess);

  /* The Chancellor pauses the turn until the drawn cards are put back. */
  if (game.round.phase === "chancellor") return outcome;

  endTurn(game);
  return outcome;
}

function resolve(game, player, card, target, guess) {
  switch (card) {
    case C.SPY: {
      return { effect: "spy", note: "Counts at the end of the round." };
    }

    case C.GUARD: {
      if (!target) return noEffect();
      const hit = target.hand[0] === guess;
      if (hit) {
        eliminate(game, target, `caught holding the ${C.name(guess)}`);
      } else {
        logPublic(game, `${target.name} is not holding the ${C.name(guess)}.`);
      }
      return { effect: "guard", target: target.id, guess, correct: hit };
    }

    case C.PRIEST: {
      if (!target) return noEffect();
      logPrivate(game, player.id, `${target.name} is holding the ${C.name(target.hand[0])}.`);
      logPublic(game, `${player.name} looks at ${target.name}'s hand.`);
      return { effect: "priest", target: target.id, reveal: target.hand[0] };
    }

    case C.BARON: {
      if (!target) return noEffect();
      const mine = player.hand[0];
      const theirs = target.hand[0];
      logPrivate(game, player.id, `${target.name} is holding the ${C.name(theirs)}.`);
      logPrivate(game, target.id, `${player.name} is holding the ${C.name(mine)}.`);
      if (mine > theirs) {
        eliminate(game, target, `lost the comparison to the ${C.name(mine)}`);
      } else if (theirs > mine) {
        eliminate(game, player, `lost the comparison to the ${C.name(theirs)}`);
      } else {
        logPublic(game, "The comparison is a tie; nobody is out.");
      }
      return {
        effect: "baron",
        target: target.id,
        yourCard: mine,
        theirCard: theirs,
        loser: mine === theirs ? null : mine > theirs ? target.id : player.id
      };
    }

    case C.HANDMAID: {
      player.protected = true;
      logPublic(game, `${player.name} is protected until the start of their next turn.`);
      return { effect: "handmaid" };
    }

    case C.PRINCE: {
      if (!target) return noEffect();
      const discarded = target.hand.pop();
      target.discards.push(discarded);
      logPublic(game, `${target.name} discards the ${C.name(discarded)}.`);

      if (discarded === C.PRINCESS) {
        eliminate(game, target, "discarded the Princess");
        return { effect: "prince", target: target.id, discarded, drew: null };
      }

      /* With the deck empty the replacement is the card burned during setup. */
      let drawn;
      if (game.round.deck.length) {
        drawn = game.round.deck.pop();
      } else {
        drawn = game.round.burned;
        game.round.burnedTaken = true;
        game.round.burned = null;
        logPublic(game, `${target.name} draws the card set aside at the start of the round.`);
      }
      target.hand.push(drawn);
      return { effect: "prince", target: target.id, discarded, drew: target.id === player.id ? drawn : null };
    }

    case C.CHANCELLOR: {
      const take = Math.min(2, game.round.deck.length);
      if (take === 0) {
        logPublic(game, "The deck is empty; the Chancellor has no effect.");
        return noEffect();
      }
      const drawn = [];
      for (let i = 0; i < take; i++) drawn.push(game.round.deck.pop());
      game.round.pending = drawn;
      game.round.phase = "chancellor";
      logPublic(game, `${player.name} draws ${take} card${take === 1 ? "" : "s"} with the Chancellor.`);
      return { effect: "chancellor", pool: player.hand.concat(drawn) };
    }

    case C.KING: {
      if (!target) return noEffect();
      const mine = player.hand.pop();
      const theirs = target.hand.pop();
      player.hand.push(theirs);
      target.hand.push(mine);
      logPrivate(game, player.id, `You traded the ${C.name(mine)} for ${target.name}'s ${C.name(theirs)}.`);
      logPrivate(game, target.id, `${player.name} traded you the ${C.name(mine)} for your ${C.name(theirs)}.`);
      logPublic(game, `${player.name} trades hands with ${target.name}.`);
      return { effect: "king", target: target.id, received: theirs };
    }

    case C.COUNTESS: {
      return noEffect();
    }

    case C.PRINCESS: {
      eliminate(game, player, "played the Princess");
      return { effect: "princess" };
    }

    default:
      return noEffect();
  }
}

function noEffect() {
  return { effect: "none" };
}

/* -------------------- CHANCELLOR -------------------- */

function chancellor(game, playerId, action) {
  const move = action || {};
  const player = requireTurn(game, playerId);

  if (game.round.phase !== "chancellor") {
    throw new GameError("wrong_phase", "There is no Chancellor to resolve.");
  }

  const pool = player.hand.concat(game.round.pending);
  const keep = Number(move.keep);
  if (!C.isCard(keep)) throw new GameError("invalid_card", `${move.keep} is not a Love Letter card.`);
  if (!pool.includes(keep)) {
    throw new GameError("card_not_held", `The ${C.name(keep)} is not among the cards to choose from.`);
  }

  /* Whatever is not kept goes back, bottom-most card first. */
  const remaining = pool.slice();
  remaining.splice(remaining.indexOf(keep), 1);

  let bottom;
  if (move.bottom === undefined || move.bottom === null) {
    bottom = remaining;
  } else {
    if (!Array.isArray(move.bottom)) throw new GameError("invalid_bottom", "bottom must be an array of cards.");
    bottom = move.bottom.map(Number);
    if (!sameCards(bottom, remaining)) {
      throw new GameError("invalid_bottom", "bottom must be exactly the cards you are not keeping.");
    }
  }

  player.hand = [keep];
  game.round.deck.unshift(...bottom);
  game.round.pending = null;
  game.round.phase = "play";
  logPublic(game, `${player.name} returns ${bottom.length} card${bottom.length === 1 ? "" : "s"} to the bottom of the deck.`);

  endTurn(game);
  return { effect: "chancellor_resolved", kept: keep, returned: bottom.length };
}

function sameCards(a, b) {
  if (a.length !== b.length) return false;
  const left = a.slice().sort();
  const right = b.slice().sort();
  return left.every((card, i) => card === right[i]);
}

/* -------------------- TURN / ROUND FLOW -------------------- */

function requireTurn(game, playerId) {
  if (game.status !== "in_progress") throw new GameError("game_over", "This game has already been won.");
  if (!game.round || game.round.phase === "over") {
    throw new GameError("round_over", "The round is over; start the next one.");
  }
  const player = findPlayer(game, playerId);
  if (!player) throw new GameError("unknown_player", `No player ${playerId} in this game.`);
  if (player.eliminated) throw new GameError("eliminated", `${player.name} is out of the round.`);
  if (current(game).id !== player.id) {
    throw new GameError("not_your_turn", `It is ${current(game).name}'s turn.`);
  }
  return player;
}

function endTurn(game) {
  const active = activePlayers(game);

  /* Last player standing, or the deck ran out at the end of a turn. */
  if (active.length <= 1 || game.round.deck.length === 0) {
    endRound(game);
    return;
  }

  let index = game.round.turn;
  do {
    index = (index + 1) % game.players.length;
  } while (game.players[index].eliminated);

  game.round.turn = index;
  beginTurn(game);
}

function endRound(game) {
  const survivors = activePlayers(game);
  let winners;
  let reason;

  if (survivors.length <= 1) {
    winners = survivors;
    reason = "last_standing";
  } else {
    reason = "showdown";
    const best = Math.max(...survivors.map(p => p.hand[0]));
    let contenders = survivors.filter(p => p.hand[0] === best);
    if (contenders.length > 1) {
      /* Ties are broken by the total value of the cards discarded this round. */
      const bestSum = Math.max(...contenders.map(discardSum));
      contenders = contenders.filter(p => discardSum(p) === bestSum);
      if (contenders.length > 1) reason = "shared";
    }
    winners = contenders;
  }

  const reveals = survivors.map(p => ({ playerId: p.id, name: p.name, card: p.hand[0] }));

  for (const winner of winners) {
    winner.tokens += 1;
    logPublic(game, `${winner.name} wins the round and takes a token of affection.`);
  }

  /* The Spy pays out only if exactly one surviving player played or discarded one. */
  const spies = survivors.filter(p => p.discards.includes(C.SPY));
  let spyBonus = null;
  if (spies.length === 1) {
    spyBonus = spies[0].id;
    spies[0].tokens += 1;
    logPublic(game, `${spies[0].name} was the only spy left standing and takes an extra token.`);
  }

  game.round.phase = "over";
  game.round.result = {
    reason,
    winners: winners.map(p => p.id),
    spyBonus,
    reveals,
    burned: game.round.burnedTaken ? null : game.round.burned,
    tokens: game.players.map(p => ({ playerId: p.id, name: p.name, tokens: p.tokens }))
  };

  /* The winner of the round leads the next one. */
  if (winners.length) {
    game.nextStarter = game.players.indexOf(winners[0]);
  }

  const champions = game.players.filter(p => p.tokens >= game.tokensToWin);
  if (champions.length) {
    const most = Math.max(...champions.map(p => p.tokens));
    game.winners = champions.filter(p => p.tokens === most).map(p => p.id);
    game.status = "complete";
    logPublic(
      game,
      `${game.players
        .filter(p => game.winners.includes(p.id))
        .map(p => p.name)
        .join(" and ")} wins the game.`
    );
  }
}

function nextRound(game) {
  if (game.status !== "in_progress") throw new GameError("game_over", "This game has already been won.");
  if (!game.round || game.round.phase !== "over") {
    throw new GameError("round_in_progress", "Finish the current round first.");
  }
  return startRound(game);
}

/* -------------------- VIEWS -------------------- */

function legalActions(game, playerId) {
  if (game.status !== "in_progress" || !game.round) return [];
  const player = findPlayer(game, playerId);
  if (!player || player.eliminated || current(game).id !== player.id) return [];

  if (game.round.phase === "chancellor") {
    return [
      {
        type: "chancellor",
        pool: player.hand.concat(game.round.pending),
        keepOne: true
      }
    ];
  }
  if (game.round.phase !== "play") return [];

  const forced = mustPlayCountess(player.hand);
  const playable = forced ? [C.COUNTESS] : Array.from(new Set(player.hand));

  return playable.map(card => {
    const targets = legalTargets(game, player, card);
    return {
      type: "play",
      card,
      name: C.name(card),
      requiresTarget: C.needsTarget(card) && targets.length > 0,
      targets,
      requiresGuess: card === C.GUARD && targets.length > 0,
      guessOptions: card === C.GUARD && targets.length > 0
        ? Object.values(C.CARDS).filter(c => c.value !== C.GUARD).map(c => c.value)
        : []
    };
  });
}

function publicView(game) {
  const round = game.round;
  return {
    id: game.id,
    createdAt: game.createdAt,
    status: game.status,
    tokensToWin: game.tokensToWin,
    winners: game.winners,
    players: game.players.map(p => ({
      id: p.id,
      name: p.name,
      tokens: p.tokens,
      handCount: p.hand.length,
      discards: p.discards,
      eliminated: p.eliminated,
      protected: p.protected
    })),
    round: round && {
      number: round.number,
      phase: round.phase,
      deckCount: round.deck.length,
      setAside: round.setAside,
      currentPlayer: round.phase === "over" ? null : current(game).id,
      result: round.result,
      log: round.log.filter(entry => entry.to === null).map(entry => entry.text)
    }
  };
}

function privateView(game, playerId) {
  const player = findPlayer(game, playerId);
  if (!player) throw new GameError("unknown_player", `No player ${playerId} in this game.`);

  const view = publicView(game);
  view.you = {
    id: player.id,
    name: player.name,
    hand: player.hand,
    tokens: player.tokens,
    eliminated: player.eliminated,
    protected: player.protected,
    mustPlayCountess: mustPlayCountess(player.hand),
    pending: game.round && game.round.phase === "chancellor" && current(game).id === player.id
      ? game.round.pending
      : null,
    legalActions: legalActions(game, playerId),
    notes: game.round
      ? game.round.log.filter(entry => entry.to === player.id).map(entry => entry.text)
      : []
  };
  return view;
}

return {
  GameError,
  createGame,
  play,
  chancellor,
  nextRound,
  startRound,
  publicView,
  privateView,
  legalActions,
  legalTargets,
  mustPlayCountess,
  activePlayers,
  findPlayer,
  current,
  mulberry32,
  shuffle
};
});
