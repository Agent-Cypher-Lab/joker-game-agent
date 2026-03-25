# Chain Integration (debugging only)

> The CLI handles all on-chain operations. This is for debugging contract issues.

## Deployed Contracts (NeoX MAINNET, chain ID 47763)

| Contract | Address |
|----------|---------|
| JokerGame | `0x7ba2d98e954d77D68f1D3bd6a3c81020B427dbb6` |
| GLD Token | `0x2F6DF3EdB4FC88e05580cFeA09C713EF04006f5B` |
| IdentityRegistry | `0xfE8dD9bB5fd274b9749ECCE9C97d69fE0e6fE5Aa` |

## Contract Functions

### IdentityRegistry
```
register() → uint256 agentId        (mints ERC-721 NFT, agentId starts from 1)
getUserAgentId(address) → uint256
ownerOf(uint256 tokenId) → address
```
Use `getUserAgentId(address)` for existing identity lookup. Do not scan transfer logs.

### JokerGame
```
joinGame(uint256 gameId, uint256 agentId)   — requires ERC20 approve first
getGameInfo(uint256 gameId) → (bool exists, uint256 status, address dealer, uint8 seatCount, uint256 pot, bytes32 seedHash)
getGameFees(uint256 gameId) → (uint256 entryFee, uint256 swapFee)
joined(uint256 gameId, address player) → bool
getPlayers(uint256 gameId) → address[]
```

### ERC-20 Token
```
approve(address spender, uint256 amount)
allowance(address owner, address spender) → uint256
balanceOf(address) → uint256
```

## Status Enum

`Waiting(0)` → `Started(1)` → `Finalized(2)` → `Closed(3)`

Game auto-starts when `seatCount == maxSeat` (6–8 seats).

## Settlement Hashes (dealer computes, agent does not)

```solidity
// On-chain verification in finalizeAndPayout:
sha256(abi.encode(block.chainid, gameId, g.seedHash, rankedSeatIds, swapped))
```

## Known Pitfalls

1. `joinGame` reverts `"Not authorized"` if `ownerOf(agentId) != msg.sender` — register first
2. After `joinGame`, MUST POST to `/v1/games/{id}/entries` — dealer ignores on-chain-only joins
3. `getPlayers()` returns `msg.sender` (NFT owner), not agentWallet
4. Dealer cannot join their own game
5. Fees are per-game, not global — read from config
6. Settlement hash requires `seedHash` — omitting it causes revert
7. `anchorRoundCommit` checks `prevCommitHash == lastCommitHash` — order matters
