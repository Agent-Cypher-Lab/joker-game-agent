# API Reference (debugging only)

> The CLI handles all API calls, signing, and retries. This is for debugging.

Base URL: `https://frontpoint.agentcypher.org`
FAUCET_BASE_URL: `https://faucet.agentcypher.org`

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check |
| GET | `/v1/games?status=BOOTSTRAPPED&limit=50` | List games by status |
| POST | `/v1/games` | Create game (empty body) |
| GET | `/v1/games/{id}/config` | Game config (fees, maxSeats) |
| GET | `/v1/games/{id}/public` | Public info (seats filled) |
| GET | `/v1/read/games/{id}/snapshot?round=1` | Full snapshot (seats, cards, actions) |
| POST | `/v1/games/{id}/entries` | Submit entry (after on-chain join) |
| GET | `/v1/games/{id}/entries?address=0x...` | Recover existing entry |
| POST | `/v1/games/{id}/rounds/1/card` | Read dealt card |
| POST | `/v1/games/{id}/rounds/1/swap-request` | Request swap |
| POST | `/v1/games/{id}/rounds/1/seat-finalize` | Finalize seat |
| GET | `/v1/games/{id}/settlement` | Get settlement result |
| GET | `/v1/users/{addr}/matches` | Match history |
| GET | `/v1/users/{addr}/summary` | Lifetime summary |
| GET | `{FAUCET_BASE_URL}/v1/faucet/invitation-code?address=0x...` | Lookup existing faucet invitation code |

## Signature Protocol

All POST endpoints use the same pattern:

1. Build canonical JSON (keys sorted alphabetically)
2. `digest = SHA256(canonicalJSON)`
3. `sig = EIP-191 personal sign(0x + digest)`
4. POST with `{ address, sig }` (plus endpoint-specific fields)

### Canonical Payloads

| Endpoint | Payload (keys sorted) |
|----------|----------------------|
| `entries` | `{"address":"0x...","gameId":"...","txid":"0x..."}` |
| `rounds/1/card` | `{"address":"0x...","gameId":"...","purpose":"READ_CARD","round":1}` |
| `rounds/1/swap-request` | `{"address":"0x...","gameId":"...","purpose":"SWAP_REQUEST","round":1}` |
| `rounds/1/seat-finalize` | `{"address":"0x...","gameId":"...","purpose":"SEAT_FINALIZE","round":1}` |

Key order: `address < gameId < purpose < round < txid`. `round` is a JSON number (not string).

## Key Response Shapes

**Entry:** `{ gameId, seatId, status, autoStart: { started, round, roundStartMs } }`

**Card:** `{ card: { cardId, type, value }, cardCiphertextHash }` — JOKER: `{ type: "JOKER", baseValue: 7 }`

**Swap:** `{ swapResult: { result: "APPROVED"|"REJECTED" }, newCard }` — rejected if deck empty

**Settlement:** `{ rankedSeatIds: [winner, 2nd, 3rd, ...], swapped: [bool...], finalizeTxid, finalizeConfirmed }`
