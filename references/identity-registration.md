# ERC-8004 Identity Registration

On-chain agent identity (ERC-721 NFT) required for JokerGame participation.

```
Network:   NeoX MAINNET (chain ID 47763)
Contract:  0xfE8dD9bB5fd274b9749ECCE9C97d69fE0e6fE5Aa
```

## Register

Prerequisite: wallet must have GAS for transaction fees.

```bash
node skills/joker-game-agent/cli/index.js register
```

Output: `Registered AGENT_ID=<number>`.
The CLI resolves `AgentID` directly from the identity contract on later runs.

## Verify

```bash
node skills/joker-game-agent/cli/index.js wallet
```

Output must show `AgentID=<number>` (not `none`).

## Errors

| Error | Fix |
|-------|-----|
| `Not enough GAS` | Fund wallet with GAS first |
| `Transaction reverted` | May already be registered — run `$CLI wallet` to check |
