"use strict";

/*
  Love Letter (2019 edition) — 21 cards, 2 to 6 players.
*/

const SPY = 0;
const GUARD = 1;
const PRIEST = 2;
const BARON = 3;
const HANDMAID = 4;
const PRINCE = 5;
const CHANCELLOR = 6;
const KING = 7;
const COUNTESS = 8;
const PRINCESS = 9;

const CARDS = {
  [SPY]: {
    value: SPY,
    name: "Spy",
    count: 2,
    text: "No immediate effect. At the end of the round, if you are the only player still in the round who played or discarded a Spy, gain an extra token."
  },
  [GUARD]: {
    value: GUARD,
    name: "Guard",
    count: 6,
    text: "Name a card other than Guard and choose another player. If that player holds it, they are out of the round."
  },
  [PRIEST]: {
    value: PRIEST,
    name: "Priest",
    count: 2,
    text: "Look at another player's hand."
  },
  [BARON]: {
    value: BARON,
    name: "Baron",
    count: 2,
    text: "Secretly compare hands with another player. The lower value is out of the round."
  },
  [HANDMAID]: {
    value: HANDMAID,
    name: "Handmaid",
    count: 2,
    text: "You cannot be chosen or affected until the start of your next turn."
  },
  [PRINCE]: {
    value: PRINCE,
    name: "Prince",
    count: 2,
    text: "Choose any player (including yourself) to discard their hand and draw a new card."
  },
  [CHANCELLOR]: {
    value: CHANCELLOR,
    name: "Chancellor",
    count: 2,
    text: "Draw 2 cards, keep 1 of the 3 in hand, then return the other 2 to the bottom of the deck."
  },
  [KING]: {
    value: KING,
    name: "King",
    count: 1,
    text: "Trade hands with another player."
  },
  [COUNTESS]: {
    value: COUNTESS,
    name: "Countess",
    count: 1,
    text: "You must play the Countess if the other card in your hand is a King or a Prince."
  },
  [PRINCESS]: {
    value: PRINCESS,
    name: "Princess",
    count: 1,
    text: "If you play or discard the Princess for any reason, you are out of the round."
  }
};

const DECK_SIZE = 21;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

/* Tokens of affection needed to win, by player count. */
const TOKENS_TO_WIN = { 2: 6, 3: 5, 4: 4, 5: 3, 6: 3 };

/* Cards that must choose another player. */
const TARGETS_OTHER = new Set([GUARD, PRIEST, BARON, KING]);
/* Cards that may choose any player, including the one playing it. */
const TARGETS_ANY = new Set([PRINCE]);

function buildDeck() {
  const deck = [];
  for (const card of Object.values(CARDS)) {
    for (let i = 0; i < card.count; i++) deck.push(card.value);
  }
  return deck;
}

function isCard(value) {
  return Number.isInteger(value) && Object.prototype.hasOwnProperty.call(CARDS, value);
}

function needsTarget(card) {
  return TARGETS_OTHER.has(card) || TARGETS_ANY.has(card);
}

function canTargetSelf(card) {
  return TARGETS_ANY.has(card);
}

function name(card) {
  return CARDS[card].name;
}

module.exports = {
  SPY,
  GUARD,
  PRIEST,
  BARON,
  HANDMAID,
  PRINCE,
  CHANCELLOR,
  KING,
  COUNTESS,
  PRINCESS,
  CARDS,
  DECK_SIZE,
  MIN_PLAYERS,
  MAX_PLAYERS,
  TOKENS_TO_WIN,
  buildDeck,
  isCard,
  needsTarget,
  canTargetSelf,
  name
};
