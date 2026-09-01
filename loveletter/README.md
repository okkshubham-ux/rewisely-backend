# Love Letter (2019 edition)

A complete rules engine and REST API for Love Letter, the 21 card edition for
2 to 6 players. The engine (`engine.js`) is plain state with no Express or
network dependency; `routes.js` is a thin HTTP layer over it, mounted at
`/api/loveletter` in `server.js`.

## The deck

| Value | Card | Copies | Effect |
| --- | --- | --- | --- |
| 0 | Spy | 2 | No effect now. At the end of the round, if you are the only player still in who played or discarded a Spy, take an extra token. |
| 1 | Guard | 6 | Name a card other than Guard and choose another player. If they hold it, they are out. |
| 2 | Priest | 2 | Look at another player's hand. |
| 3 | Baron | 2 | Compare hands privately with another player. The lower value is out. |
| 4 | Handmaid | 2 | You cannot be chosen until the start of your next turn. |
| 5 | Prince | 2 | Choose any player, including yourself, to discard their hand and draw a new card. |
| 6 | Chancellor | 2 | Draw 2, keep 1 of the 3, return the other 2 to the bottom of the deck. |
| 7 | King | 1 | Trade hands with another player. |
| 8 | Countess | 1 | Must be played if the other card in your hand is a King or a Prince. |
| 9 | Princess | 1 | If you play or discard her for any reason, you are out. |

Cards are referred to by their value everywhere in the API.

## Rules the engine enforces

- Setup burns one card face down; a two player game also sets three aside face up.
- Each turn draws one card, then plays one of the two.
- The Countess is forced when it is held beside the King or the Prince.
- A card that must choose a player has no effect when everyone else is
  protected or out; the Prince may then only choose its own player.
- The Prince draws the burned card when the deck is empty.
- The round ends when one player is left, or when the deck runs out at the end
  of a turn. The highest hand wins; ties go to the highest discard pile total,
  and a still-tied round is shared.
- Tokens to win: 6 (2 players), 5 (3), 4 (4), 3 (5 or 6). Override with
  `tokensToWin` when creating a game.
- The round winner leads the next round.

## API

Hands are secret. `POST /games` returns one secret per player; every later
request for that player carries it as an `x-player-secret` header, a `secret`
field in the body, or a `?secret=` query parameter.

### `GET /api/loveletter/cards`
Reference data: the deck, the card texts, and the token targets.

### `POST /api/loveletter/games`
```json
{ "players": ["Ana", "Ben", "Cal"], "tokensToWin": 5, "seed": 42 }
```
`tokensToWin` and `seed` are optional; `seed` makes the shuffle reproducible.
Returns `201` with the public game state and the list of player secrets.

### `GET /api/loveletter/games/:id`
Public state: tokens, discard piles, who is out, who is protected, how many
cards are left, the public log, and the round result once a round is over.

### `GET /api/loveletter/games/:id/players/:playerId`
The same state plus `you`: your hand, whether the Countess is forcing your
hand, anything only you have seen (Priest looks, Baron comparisons, King
trades), and `legalActions` — every card you may play with its legal targets
and, for the Guard, the cards you may name.

### `POST /api/loveletter/games/:id/play`
```json
{ "playerId": "p1", "card": 1, "target": "p2", "guess": 9 }
```
`target` is omitted for cards that choose nobody, and also when every other
player is protected. `guess` is Guard only. Returns the effect of the card
(including anything revealed only to you) and your refreshed view.

### `POST /api/loveletter/games/:id/chancellor`
```json
{ "playerId": "p1", "keep": 7, "bottom": [0, 1] }
```
Required after playing the Chancellor. `bottom` lists the returned cards
bottom-most first; omit it to let the engine keep their drawn order.

### `POST /api/loveletter/games/:id/next-round`
Deals the next round once the current one is scored.

### `DELETE /api/loveletter/games/:id`
Drops the game. Games are held in memory and swept after six idle hours.

Rule violations come back as `400` with a machine readable `code`
(`not_your_turn`, `countess_required`, `illegal_target`, `invalid_guess`, and
so on) alongside a human readable `error`.

## Tests

```
npm test
```

Covers each card, the awkward corners (all opponents protected, the Prince and
an empty deck, forced Countess, a lone spy versus two spies, discard pile
tiebreaks) and 200 randomised complete games across every player count,
asserting all 21 cards stay accounted for at every step.
