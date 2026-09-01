"use strict";

const test = require("node:test");
const assert = require("node:assert");

const C = require("../loveletter/cards");
const engine = require("../loveletter/engine");

/*
  The deck is drawn with pop(), so the LAST element of `deck` is the top card,
  i.e. the next card anybody draws.
*/
function testGame(names, setup) {
  const options = setup || {};
  const game = engine.createGame({ players: names, seed: 7, tokensToWin: options.tokensToWin });

  for (const player of game.players) {
    player.hand = [];
    player.discards = [];
    player.eliminated = false;
    player.protected = false;
  }
  for (const [id, hand] of Object.entries(options.hands || {})) {
    engine.findPlayer(game, id).hand = hand.slice();
  }

  game.round.deck = (options.deck || []).slice();
  game.round.burned = options.burned === undefined ? C.SPY : options.burned;
  game.round.burnedTaken = false;
  game.round.setAside = options.setAside || [];
  game.round.turn = options.turn || 0;
  game.round.phase = "play";
  game.round.pending = null;
  game.round.result = null;
  return game;
}

function cardsInPlay(game) {
  const round = game.round;
  let total = round.deck.length + round.setAside.length + (round.pending ? round.pending.length : 0);
  if (!round.burnedTaken) total += 1;
  for (const player of game.players) total += player.hand.length + player.discards.length;
  return total;
}

/* -------------------- DECK -------------------- */

test("the deck is the 21 card 2019 edition", () => {
  const deck = C.buildDeck();
  assert.strictEqual(deck.length, 21);

  const counts = {};
  for (const card of deck) counts[card] = (counts[card] || 0) + 1;
  assert.deepStrictEqual(counts, {
    0: 2, // Spy
    1: 6, // Guard
    2: 2, // Priest
    3: 2, // Baron
    4: 2, // Handmaid
    5: 2, // Prince
    6: 2, // Chancellor
    7: 1, // King
    8: 1, // Countess
    9: 1  // Princess
  });
});

test("player count is capped at six", () => {
  assert.throws(() => engine.createGame({ players: ["solo"] }), /2 to 6 players/);
  assert.throws(
    () => engine.createGame({ players: ["a", "b", "c", "d", "e", "f", "g"] }),
    /2 to 6 players/
  );
  const six = engine.createGame({ players: ["a", "b", "c", "d", "e", "f"], seed: 1 });
  assert.strictEqual(six.players.length, 6);
  assert.strictEqual(six.tokensToWin, 3);
});

/* -------------------- SETUP -------------------- */

test("setup burns one card, and three more face up with two players", () => {
  const two = engine.createGame({ players: ["Ana", "Ben"], seed: 3 });
  assert.strictEqual(two.round.setAside.length, 3);
  // 21 - 1 burned - 3 face up - 2 dealt - 1 drawn by the starting player
  assert.strictEqual(two.round.deck.length, 14);
  assert.strictEqual(two.tokensToWin, 6);
  assert.strictEqual(cardsInPlay(two), 21);

  const six = engine.createGame({ players: ["a", "b", "c", "d", "e", "f"], seed: 3 });
  assert.strictEqual(six.round.setAside.length, 0);
  // 21 - 1 burned - 6 dealt - 1 drawn
  assert.strictEqual(six.round.deck.length, 13);
  assert.strictEqual(cardsInPlay(six), 21);
});

test("the player to move holds two cards, everyone else one", () => {
  const game = engine.createGame({ players: ["Ana", "Ben", "Cal"], seed: 5 });
  const view = engine.publicView(game);
  const active = view.players.find(p => p.id === view.round.currentPlayer);
  assert.strictEqual(active.handCount, 2);
  for (const player of view.players.filter(p => p.id !== active.id)) {
    assert.strictEqual(player.handCount, 1);
  }
});

/* -------------------- GUARD -------------------- */

test("a correct Guard guess knocks the target out", () => {
  const game = testGame(["Ana", "Ben"], {
    hands: { p1: [C.GUARD, C.SPY], p2: [C.PRINCESS] },
    deck: [C.SPY, C.SPY]
  });
  const outcome = engine.play(game, "p1", { card: C.GUARD, target: "p2", guess: C.PRINCESS });

  assert.strictEqual(outcome.correct, true);
  assert.strictEqual(engine.findPlayer(game, "p2").eliminated, true);
  assert.strictEqual(game.round.phase, "over");
  assert.deepStrictEqual(game.round.result.winners, ["p1"]);
  assert.strictEqual(game.round.result.reason, "last_standing");
});

test("a wrong Guard guess does nothing", () => {
  const game = testGame(["Ana", "Ben", "Cal"], {
    hands: { p1: [C.GUARD, C.SPY], p2: [C.PRINCESS], p3: [C.BARON] },
    deck: [C.SPY, C.SPY, C.SPY]
  });
  const outcome = engine.play(game, "p1", { card: C.GUARD, target: "p2", guess: C.KING });

  assert.strictEqual(outcome.correct, false);
  assert.strictEqual(engine.findPlayer(game, "p2").eliminated, false);
  assert.strictEqual(engine.current(game).id, "p2");
});

test("the Guard cannot name another Guard", () => {
  const game = testGame(["Ana", "Ben"], {
    hands: { p1: [C.GUARD, C.SPY], p2: [C.GUARD] },
    deck: [C.SPY, C.SPY]
  });
  assert.throws(
    () => engine.play(game, "p1", { card: C.GUARD, target: "p2", guess: C.GUARD }),
    /cannot name another Guard/
  );
  assert.throws(
    () => engine.play(game, "p1", { card: C.GUARD, target: "p2" }),
    /must name a card/
  );
});

test("the Guard can name the Spy", () => {
  const game = testGame(["Ana", "Ben", "Cal"], {
    hands: { p1: [C.GUARD, C.BARON], p2: [C.SPY], p3: [C.KING] },
    deck: [C.SPY, C.SPY, C.SPY]
  });
  const outcome = engine.play(game, "p1", { card: C.GUARD, target: "p2", guess: C.SPY });
  assert.strictEqual(outcome.correct, true);
  assert.strictEqual(engine.findPlayer(game, "p2").eliminated, true);
});

/* -------------------- PRIEST / BARON -------------------- */

test("the Priest shows a hand only to the player who played it", () => {
  const game = testGame(["Ana", "Ben", "Cal"], {
    hands: { p1: [C.PRIEST, C.SPY], p2: [C.PRINCESS], p3: [C.BARON] },
    deck: [C.SPY, C.SPY, C.SPY]
  });
  const outcome = engine.play(game, "p1", { card: C.PRIEST, target: "p2" });

  assert.strictEqual(outcome.reveal, C.PRINCESS);
  assert.ok(engine.privateView(game, "p1").you.notes.some(n => /Princess/.test(n)));
  assert.ok(!engine.privateView(game, "p3").you.notes.some(n => /Princess/.test(n)));
  assert.ok(!JSON.stringify(engine.publicView(game)).includes("Princess"));
});

test("the Baron knocks out the lower hand and spares a tie", () => {
  const lower = testGame(["Ana", "Ben", "Cal"], {
    hands: { p1: [C.BARON, C.KING], p2: [C.PRIEST], p3: [C.SPY] },
    deck: [C.SPY, C.SPY, C.SPY]
  });
  engine.play(lower, "p1", { card: C.BARON, target: "p2" });
  assert.strictEqual(engine.findPlayer(lower, "p2").eliminated, true);
  assert.strictEqual(engine.findPlayer(lower, "p1").eliminated, false);

  const higher = testGame(["Ana", "Ben", "Cal"], {
    hands: { p1: [C.BARON, C.SPY], p2: [C.KING], p3: [C.SPY] },
    deck: [C.SPY, C.SPY, C.SPY]
  });
  engine.play(higher, "p1", { card: C.BARON, target: "p2" });
  assert.strictEqual(engine.findPlayer(higher, "p1").eliminated, true);

  const tie = testGame(["Ana", "Ben", "Cal"], {
    hands: { p1: [C.BARON, C.KING], p2: [C.KING], p3: [C.SPY] },
    deck: [C.SPY, C.SPY, C.SPY]
  });
  engine.play(tie, "p1", { card: C.BARON, target: "p2" });
  assert.strictEqual(engine.findPlayer(tie, "p1").eliminated, false);
  assert.strictEqual(engine.findPlayer(tie, "p2").eliminated, false);
});

/* -------------------- HANDMAID -------------------- */

test("the Handmaid blocks targeting until the player's next turn", () => {
  const game = testGame(["Ana", "Ben", "Cal"], {
    hands: { p1: [C.HANDMAID, C.SPY], p2: [C.GUARD, C.SPY], p3: [C.SPY] },
    deck: [C.SPY, C.SPY, C.SPY, C.SPY]
  });
  engine.play(game, "p1", { card: C.HANDMAID });
  assert.strictEqual(engine.findPlayer(game, "p1").protected, true);

  assert.throws(
    () => engine.play(game, "p2", { card: C.GUARD, target: "p1", guess: C.SPY }),
    /cannot be chosen/
  );

  const targets = engine.legalActions(game, "p2").find(a => a.card === C.GUARD).targets;
  assert.deepStrictEqual(targets, ["p3"]);
});

test("with every other player protected the card is played with no target", () => {
  const game = testGame(["Ana", "Ben"], {
    hands: { p1: [C.GUARD, C.SPY], p2: [C.PRINCESS] },
    deck: [C.SPY, C.SPY]
  });
  engine.findPlayer(game, "p2").protected = true;

  const action = engine.legalActions(game, "p1").find(a => a.card === C.GUARD);
  assert.strictEqual(action.requiresTarget, false);
  assert.deepStrictEqual(action.targets, []);

  assert.throws(
    () => engine.play(game, "p1", { card: C.GUARD, target: "p2", guess: C.PRINCESS }),
    /protected or out/
  );

  const outcome = engine.play(game, "p1", { card: C.GUARD });
  assert.strictEqual(outcome.effect, "none");
  assert.strictEqual(engine.findPlayer(game, "p2").eliminated, false);
});

test("protection lifts at the start of the protected player's own turn", () => {
  const game = testGame(["Ana", "Ben"], {
    hands: { p1: [C.HANDMAID, C.SPY], p2: [C.SPY] },
    deck: [C.SPY, C.SPY, C.SPY]
  });
  engine.play(game, "p1", { card: C.HANDMAID });
  assert.strictEqual(engine.current(game).id, "p2");
  engine.play(game, "p2", { card: C.SPY });
  assert.strictEqual(engine.current(game).id, "p1");
  assert.strictEqual(engine.findPlayer(game, "p1").protected, false);
});

/* -------------------- PRINCE -------------------- */

test("the Prince forces a discard and a redraw", () => {
  const game = testGame(["Ana", "Ben", "Cal"], {
    hands: { p1: [C.PRINCE, C.SPY], p2: [C.COUNTESS], p3: [C.SPY] },
    deck: [C.SPY, C.SPY, C.KING]
  });
  engine.play(game, "p1", { card: C.PRINCE, target: "p2" });

  const ben = engine.findPlayer(game, "p2");
  assert.deepStrictEqual(ben.discards, [C.COUNTESS]);
  assert.strictEqual(ben.hand[0], C.KING);
  assert.strictEqual(ben.eliminated, false);
});

test("a Prince that discards the Princess knocks the target out", () => {
  const game = testGame(["Ana", "Ben", "Cal"], {
    hands: { p1: [C.PRINCE, C.SPY], p2: [C.PRINCESS], p3: [C.SPY] },
    deck: [C.SPY, C.SPY, C.SPY]
  });
  engine.play(game, "p1", { card: C.PRINCE, target: "p2" });

  const ben = engine.findPlayer(game, "p2");
  assert.strictEqual(ben.eliminated, true);
  assert.deepStrictEqual(ben.discards, [C.PRINCESS]);
  assert.deepStrictEqual(ben.hand, []);
});

test("the Prince may target its own player", () => {
  const game = testGame(["Ana", "Ben", "Cal"], {
    hands: { p1: [C.PRINCE, C.BARON], p2: [C.SPY], p3: [C.SPY] },
    deck: [C.SPY, C.SPY, C.KING]
  });
  const action = engine.legalActions(game, "p1").find(a => a.card === C.PRINCE);
  assert.ok(action.targets.includes("p1"));

  engine.play(game, "p1", { card: C.PRINCE, target: "p1" });
  const ana = engine.findPlayer(game, "p1");
  assert.deepStrictEqual(ana.discards, [C.PRINCE, C.BARON]);
  assert.deepStrictEqual(ana.hand, [C.KING]);
});

test("with the deck empty the Prince hands over the card burned at setup", () => {
  const game = testGame(["Ana", "Ben", "Cal"], {
    hands: { p1: [C.PRINCE, C.SPY], p2: [C.BARON], p3: [C.SPY] },
    deck: [],
    burned: C.PRINCESS
  });
  engine.play(game, "p1", { card: C.PRINCE, target: "p2" });

  assert.deepStrictEqual(engine.findPlayer(game, "p2").hand, [C.PRINCESS]);
  assert.strictEqual(game.round.burnedTaken, true);
  // The deck was empty at the end of the turn, so the round is scored.
  assert.strictEqual(game.round.phase, "over");
  assert.deepStrictEqual(game.round.result.winners, ["p2"]);
});

/* -------------------- CHANCELLOR -------------------- */

test("the Chancellor keeps one of three and buries the rest at the bottom", () => {
  const game = testGame(["Ana", "Ben", "Cal"], {
    hands: { p1: [C.CHANCELLOR, C.SPY], p2: [C.BARON], p3: [C.SPY] },
    // bottom ... top: the Chancellor draws the King then the Princess
    deck: [C.GUARD, C.GUARD, C.KING, C.PRINCESS]
  });
  const outcome = engine.play(game, "p1", { card: C.CHANCELLOR });

  assert.strictEqual(game.round.phase, "chancellor");
  assert.deepStrictEqual(outcome.pool.slice().sort(), [C.SPY, C.KING, C.PRINCESS].sort());
  assert.throws(() => engine.play(game, "p1", { card: C.SPY }), /Chancellor/);

  engine.chancellor(game, "p1", { keep: C.PRINCESS, bottom: [C.SPY, C.KING] });

  assert.deepStrictEqual(engine.findPlayer(game, "p1").hand, [C.PRINCESS]);
  // bottom-most first, then the two Guards that were already there
  assert.deepStrictEqual(game.round.deck.slice(0, 2), [C.SPY, C.KING]);
  assert.strictEqual(game.round.phase, "play");
  assert.strictEqual(engine.current(game).id, "p2");
});

test("the Chancellor draws what it can and refuses cards not in the pool", () => {
  const game = testGame(["Ana", "Ben", "Cal"], {
    hands: { p1: [C.CHANCELLOR, C.SPY], p2: [C.BARON], p3: [C.SPY] },
    deck: [C.KING]
  });
  engine.play(game, "p1", { card: C.CHANCELLOR });
  assert.deepStrictEqual(game.round.pending, [C.KING]);

  assert.throws(() => engine.chancellor(game, "p1", { keep: C.PRINCESS }), /not among the cards/);
  assert.throws(
    () => engine.chancellor(game, "p1", { keep: C.KING, bottom: [C.PRINCESS] }),
    /exactly the cards you are not keeping/
  );

  engine.chancellor(game, "p1", { keep: C.KING });
  assert.deepStrictEqual(engine.findPlayer(game, "p1").hand, [C.KING]);
  // The Spy went to the bottom and is the only card left for Ben to draw.
  assert.deepStrictEqual(game.round.deck, []);
  assert.deepStrictEqual(engine.findPlayer(game, "p2").hand, [C.BARON, C.SPY]);
});

test("with an empty deck the Chancellor has no effect", () => {
  const game = testGame(["Ana", "Ben", "Cal"], {
    hands: { p1: [C.CHANCELLOR, C.SPY], p2: [C.BARON], p3: [C.KING] },
    deck: []
  });
  const outcome = engine.play(game, "p1", { card: C.CHANCELLOR });
  assert.strictEqual(outcome.effect, "none");
  assert.strictEqual(game.round.phase, "over");
});

/* -------------------- KING / COUNTESS / PRINCESS -------------------- */

test("the King trades hands", () => {
  const game = testGame(["Ana", "Ben", "Cal"], {
    hands: { p1: [C.KING, C.SPY], p2: [C.PRINCESS], p3: [C.SPY] },
    deck: [C.SPY, C.SPY, C.SPY]
  });
  engine.play(game, "p1", { card: C.KING, target: "p2" });

  assert.deepStrictEqual(engine.findPlayer(game, "p1").hand, [C.PRINCESS]);
  assert.strictEqual(engine.findPlayer(game, "p2").hand[0], C.SPY);
});

test("the Countess must be played beside the King or the Prince", () => {
  for (const partner of [C.KING, C.PRINCE]) {
    const game = testGame(["Ana", "Ben"], {
      hands: { p1: [C.COUNTESS, partner], p2: [C.SPY] },
      deck: [C.SPY, C.SPY]
    });
    assert.strictEqual(engine.mustPlayCountess(engine.findPlayer(game, "p1").hand), true);
    assert.deepStrictEqual(
      engine.legalActions(game, "p1").map(a => a.card),
      [C.COUNTESS]
    );
    assert.throws(() => engine.play(game, "p1", { card: partner, target: "p2" }), /Countess must be played/);
    engine.play(game, "p1", { card: C.COUNTESS });
    assert.deepStrictEqual(engine.findPlayer(game, "p1").hand, [partner]);
  }
});

test("the Countess is free to keep next to anything else", () => {
  const game = testGame(["Ana", "Ben"], {
    hands: { p1: [C.COUNTESS, C.PRINCESS], p2: [C.SPY] },
    deck: [C.SPY, C.SPY]
  });
  assert.strictEqual(engine.mustPlayCountess(engine.findPlayer(game, "p1").hand), false);
  engine.play(game, "p1", { card: C.PRINCESS });
  assert.strictEqual(engine.findPlayer(game, "p1").eliminated, true);
});

test("playing the Princess knocks you out", () => {
  const game = testGame(["Ana", "Ben", "Cal"], {
    hands: { p1: [C.PRINCESS, C.SPY], p2: [C.BARON], p3: [C.KING] },
    deck: [C.SPY, C.SPY]
  });
  engine.play(game, "p1", { card: C.PRINCESS });
  const ana = engine.findPlayer(game, "p1");
  assert.strictEqual(ana.eliminated, true);
  assert.deepStrictEqual(ana.hand, []);
  assert.deepStrictEqual(ana.discards, [C.PRINCESS, C.SPY]);
});

/* -------------------- ROUND SCORING -------------------- */

test("an empty deck ends the round and the highest card wins", () => {
  const game = testGame(["Ana", "Ben", "Cal"], {
    hands: { p1: [C.SPY, C.GUARD], p2: [C.KING], p3: [C.BARON] },
    deck: []
  });
  engine.play(game, "p1", { card: C.GUARD, target: "p3", guess: C.PRINCESS });

  assert.strictEqual(game.round.phase, "over");
  assert.strictEqual(game.round.result.reason, "showdown");
  assert.deepStrictEqual(game.round.result.winners, ["p2"]);
  assert.strictEqual(engine.findPlayer(game, "p2").tokens, 1);
});

test("a tied showdown is broken by the discard pile, then shared", () => {
  const broken = testGame(["Ana", "Ben"], {
    hands: { p1: [C.KING, C.SPY], p2: [C.KING] },
    deck: []
  });
  engine.findPlayer(broken, "p2").discards = [C.PRINCE];
  engine.play(broken, "p1", { card: C.SPY });
  assert.deepStrictEqual(broken.round.result.winners, ["p2"]);

  const shared = testGame(["Ana", "Ben"], {
    hands: { p1: [C.KING, C.SPY], p2: [C.KING] },
    deck: []
  });
  engine.findPlayer(shared, "p2").discards = [C.SPY];
  engine.play(shared, "p1", { card: C.SPY });
  assert.deepStrictEqual(shared.round.result.winners, ["p1", "p2"]);
  assert.strictEqual(shared.round.result.reason, "shared");
  assert.strictEqual(engine.findPlayer(shared, "p1").tokens, 1);
  assert.strictEqual(engine.findPlayer(shared, "p2").tokens, 1);
});

/* -------------------- SPY -------------------- */

test("a lone surviving spy takes an extra token", () => {
  const game = testGame(["Ana", "Ben", "Cal"], {
    hands: { p1: [C.SPY, C.GUARD], p2: [C.KING], p3: [C.BARON] },
    deck: []
  });
  engine.play(game, "p1", { card: C.SPY });

  assert.strictEqual(game.round.result.spyBonus, "p1");
  assert.strictEqual(engine.findPlayer(game, "p1").tokens, 1);
  assert.strictEqual(engine.findPlayer(game, "p2").tokens, 1); // won the showdown
});

test("two surviving spies cancel each other out", () => {
  const game = testGame(["Ana", "Ben", "Cal"], {
    hands: { p1: [C.SPY, C.GUARD], p2: [C.KING], p3: [C.BARON] },
    deck: []
  });
  engine.findPlayer(game, "p2").discards = [C.SPY];
  engine.play(game, "p1", { card: C.SPY });

  assert.strictEqual(game.round.result.spyBonus, null);
  assert.strictEqual(engine.findPlayer(game, "p1").tokens, 0);
  assert.strictEqual(engine.findPlayer(game, "p2").tokens, 1);
});

test("a spy who is out of the round gets nothing", () => {
  const game = testGame(["Ana", "Ben"], {
    hands: { p1: [C.PRINCESS, C.SPY], p2: [C.GUARD] },
    deck: [C.SPY, C.SPY]
  });
  engine.findPlayer(game, "p1").discards = [C.SPY];
  engine.play(game, "p1", { card: C.PRINCESS });

  assert.strictEqual(game.round.result.spyBonus, null);
  assert.strictEqual(engine.findPlayer(game, "p1").tokens, 0);
});

/* -------------------- TURN ORDER AND GAME END -------------------- */

test("turn order skips players who are out", () => {
  const game = testGame(["Ana", "Ben", "Cal", "Dee"], {
    hands: { p1: [C.GUARD, C.SPY], p2: [C.PRINCESS], p3: [C.BARON], p4: [C.KING] },
    deck: [C.SPY, C.SPY, C.SPY, C.SPY, C.SPY]
  });
  engine.play(game, "p1", { card: C.GUARD, target: "p2", guess: C.PRINCESS });
  assert.strictEqual(engine.current(game).id, "p3");
});

test("the round winner leads the next round and the game ends at the token target", () => {
  const game = testGame(["Ana", "Ben"], {
    hands: { p1: [C.SPY, C.GUARD], p2: [C.PRINCESS] },
    deck: [],
    tokensToWin: 1
  });
  engine.play(game, "p1", { card: C.GUARD, target: "p2", guess: C.PRINCESS });

  assert.strictEqual(game.status, "complete");
  assert.deepStrictEqual(game.winners, ["p1"]);
  assert.throws(() => engine.nextRound(game), /already been won/);

  const long = testGame(["Ana", "Ben"], {
    hands: { p1: [C.SPY, C.GUARD], p2: [C.PRINCESS] },
    deck: [],
    tokensToWin: 4
  });
  engine.play(long, "p1", { card: C.GUARD, target: "p2", guess: C.PRINCESS });
  assert.strictEqual(long.status, "in_progress");
  engine.nextRound(long);
  assert.strictEqual(long.round.number, 2);
  assert.strictEqual(engine.current(long).id, "p1");
  assert.strictEqual(cardsInPlay(long), 21);
});

/* -------------------- TURN GUARDS -------------------- */

test("only the player to move may act", () => {
  const game = testGame(["Ana", "Ben", "Cal"], {
    hands: { p1: [C.SPY, C.GUARD], p2: [C.PRINCESS], p3: [C.BARON] },
    deck: [C.SPY, C.SPY, C.SPY]
  });
  assert.throws(() => engine.play(game, "p2", { card: C.PRINCESS }), /It is Ana's turn/);
  assert.throws(() => engine.play(game, "p9", { card: C.SPY }), /No player p9/);
  assert.throws(() => engine.play(game, "p1", { card: C.KING, target: "p2" }), /not holding the King/);
  assert.throws(() => engine.play(game, "p1", { card: 42 }), /not a Love Letter card/);
  assert.throws(() => engine.play(game, "p1", { card: C.SPY, target: "p2" }), /does not choose a player/);
});

test("a private view never leaks another hand", () => {
  const game = engine.createGame({ players: ["Ana", "Ben", "Cal"], seed: 11 });
  const view = engine.privateView(game, "p2");
  assert.deepStrictEqual(view.you.hand, engine.findPlayer(game, "p2").hand);
  for (const player of view.players) {
    assert.ok(!("hand" in player));
    assert.ok(!("secret" in player));
  }
});

/* -------------------- FULL GAMES -------------------- */

test("random games of every size finish with the cards all accounted for", () => {
  for (let size = 2; size <= 6; size++) {
    for (let trial = 0; trial < 40; trial++) {
      const seed = size * 1000 + trial;
      const rng = engine.mulberry32(seed);
      const pick = list => list[Math.floor(rng() * list.length)];

      const names = [];
      for (let i = 0; i < size; i++) names.push(`P${i + 1}`);
      const game = engine.createGame({ players: names, seed });

      let steps = 0;
      while (game.status === "in_progress") {
        assert.ok(steps++ < 5000, "game did not finish");
        assert.strictEqual(cardsInPlay(game), 21, "cards went missing");

        if (game.round.phase === "over") {
          engine.nextRound(game);
          continue;
        }

        const playerId = engine.current(game).id;
        const actions = engine.legalActions(game, playerId);
        assert.ok(actions.length > 0, "the player to move always has a legal action");
        const action = pick(actions);

        if (action.type === "chancellor") {
          engine.chancellor(game, playerId, { keep: pick(action.pool) });
        } else {
          engine.play(game, playerId, {
            card: action.card,
            target: action.requiresTarget ? pick(action.targets) : undefined,
            guess: action.requiresGuess ? pick(action.guessOptions) : undefined
          });
        }
      }

      assert.strictEqual(cardsInPlay(game), 21);
      assert.ok(game.winners.length >= 1);
      for (const id of game.winners) {
        assert.ok(engine.findPlayer(game, id).tokens >= game.tokensToWin);
      }
    }
  }
});
