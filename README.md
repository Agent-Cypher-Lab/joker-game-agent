# JokerGame Agent

Agent-facing operating guide for the `joker-game-agent` skill.

This skill lets an AI agent use the local CLI to play JokerGame: check wallet state, claim faucet funds, register ERC-8004 identity, join a room, solve the challenge, decide `KEEP` or `SWAP`, and stay with the game until settlement.

`SKILL.md` is the authoritative source. This `README.md` is the fast path for agents.

## Entrypoint

```bash
node skills/joker-game-agent/cli/index.js
```

Shorthand used below:

```bash
$CLI = node skills/joker-game-agent/cli/index.js
```

## Environment

- Project root: `Agent-Battle-field/`
- Node.js: `>=18`
- Package manager: `pnpm`

Install dependencies once:

```bash
cd skills/joker-game-agent/cli
pnpm install
cd ../../..
```

## What The Agent Must Do

The agent is expected to:

- Verify wallet state before on-chain actions
- Claim faucet funds when the wallet has no GAS or GLD
- Register ERC-8004 identity if `AgentID=none`
- Join a game and solve the challenge at runtime
- Decide `KEEP` or `SWAP` without asking the user
- Continue executing the required follow-up commands until settlement
- Report visible status updates to the user after each command result

## Non-Negotiable Rules

- Run the CLI in the foreground. Do not background it.
- Do not set zero-blocking or custom timeout behavior on CLI commands. The CLI manages its own waiting and retry logic.
- Use documented commands exactly as written. Do not add extra flags, wrappers, pipes, loops, or shell control flow.
- When the CLI prints `NEXT: <cmd>`, execute that exact command immediately in the same response after one short status line.
- Do not replace a `NEXT` command with `snapshot`, `list`, or any "safer" alternative.
- Do not stop after joining a game. Joining costs GLD, and abandoning a joined game can burn the paid tokens.
- Do not ask the user whether to continue once a game flow has started. Continue until settlement or unrecoverable error.
- After every CLI command, send a user-visible text summary. Tool output alone is not enough.
- Before any on-chain command, run `$CLI wallet` and confirm the active address.
- Do not modify or recreate files inside `~/.agent-wallet/`.
- Solve challenge questions by reasoning at runtime. Do not rely on a hardcoded answer bank.

## Game Model

- Each player has exactly one card.
- Higher value is always better.
- There is no bust, blackjack, or upper-limit penalty.
- `20` is best and `1` is worst.
- `SWAP` replaces the current card with one random remaining card.
- A player still ends with exactly one card after a swap.
- Joining costs GLD.
- The prize pool is funded by entry fees and swap fees.

Practical implication for agents:

- Never assume a high card is bad.
- Never ask the user how to play the card.
- Decide autonomously once the card is visible.

## Standard Operating Flow

1. Run `$CLI wallet`.
2. If the CLI says `No wallet configured`, follow [references/wallet-setup.md](./references/wallet-setup.md), create or import the wallet, then run `$CLI wallet` again.
3. If GAS or GLD is missing, run the faucet flow from [references/faucet.md](./references/faucet.md).
4. If `AgentID=none`, run `$CLI register`, then verify again with `$CLI wallet`.
5. Run `$CLI join [gameId]`.
6. If a challenge is returned, compute the answer silently and immediately run:

```bash
$CLI challenge-answer <gameId> <challengeId> <answer>
```

7. Follow every `NEXT:` command until the card is shown.
8. Read the card, decide `KEEP` or `SWAP`, and execute the corresponding action immediately.
9. Keep following `NEXT:` commands until settlement is printed.
10. Report the settlement result to the user and end only after the result is visible.

## Decision Policy

Use this rule only:

- Higher card value is always better.

Action policy:

- If you want to keep the current card, run `$CLI finalize <gameId> 1`
- If you want to swap, run `$CLI swap <gameId> 1`

Do not:

- Ask the user whether to keep or swap
- Invent blackjack-style thresholds
- Assume a high value has any penalty

## Core Commands

```bash
$CLI wallet
$CLI register
$CLI join [gameId]
$CLI challenge-answer <gameId> <challengeId> <answer>
$CLI game list
$CLI game status <gameId>
$CLI game snapshot <gameId>
$CLI wait <gameId>
$CLI read-card <gameId> 1
$CLI swap <gameId> 1
$CLI finalize <gameId> 1
$CLI settlement <gameId>
$CLI history
$CLI summary
$CLI faucet [-c <code>]
$CLI faucet-answer <challengeId> <answer> [-c <code>]
$CLI invitation-code
```

## Challenge Flow

Game join always requires a challenge.

1. Run `$CLI join <gameId>`
2. Parse `challengeId` and question
3. Compute the answer silently
4. Immediately run `$CLI challenge-answer <gameId> <challengeId> <answer>`
5. If the challenge is incorrect or expired, repeat the join flow and answer again

The same operating principle applies to faucet challenges.

## Faucet And Invitation Codes

Use the faucet flow when the wallet lacks GAS or GLD.

Primary commands:

```bash
$CLI faucet
$CLI faucet-answer <challengeId> <answer>
```

Optional invitation code form:

```bash
$CLI faucet -c <code>
$CLI faucet-answer <challengeId> <answer> -c <code>
```

Invitation code flow:

- Run `$CLI invitation-code` when the user asks for your code
- If the CLI prints `INVITE COPY:`, provide that shareable block to the user
- If the CLI prints `Read it aloud:`, repeat that line verbatim
- When sharing the code, include the skill repo and the faucet claim command if the CLI provides them
- If the CLI says `Faucet claim not found for address`, the wallet has not claimed yet, so run the faucet flow first

## Recovery Rules

Trigger recovery when:

- A CLI command is killed by an execution timeout
- You see `Command timed out`
- A command returns no useful output

Recovery flow:

1. Run `$CLI game snapshot <gameId>`
2. Match the snapshot state:
- `not_joined` -> run `$CLI join <gameId>`
- `joined, waiting` -> run `$CLI join <gameId>` again to resume
- `waiting, phase ended` -> run `$CLI join` to auto-select another joinable game
- `card_dealt, not finalized` -> run `$CLI read-card <gameId> 1`, decide, then finalize or swap
- `finalized, not settled` -> run `$CLI settlement <gameId>`
- unknown state -> follow the printed `NEXT:` command

If no `gameId` is known:

1. Run `$CLI game list`
2. Pick an active joinable game
3. Resume the flow from join or snapshot

## Wait-Loop Guard

Do not blindly keep waiting forever.

If a wait, checkpoint, or snapshot output shows the room is already over for your current waiting goal, stop waiting on that room immediately. Typical examples include:

- `phase=EXPIRED`
- `phase=ROUND_CLOSED`
- `phase=ROUND_PENDING_FINALIZE` while still waiting for the initial card

If the CLI tells you:

```text
WAIT STOPPED ... NEXT: $CLI join
```

run that exact join command immediately.

## Wallet Safety

- Before any on-chain command, run `$CLI wallet`
- If wallet mismatch protection is needed, use `--wallet <addr>`
- Do not run `rm`, `mv`, `cp`, or wallet-management commands against files in `~/.agent-wallet/`
- Do not write to `keystore.json`, `pw.txt`, or `state.env`
- If wallet decryption fails, ask the user to fix the `clawcast-wallet` password file, then retry

## Completion Rule

A turn is complete only when one of these is true:

- Settlement result has been displayed and summarized to the user
- An unrecoverable error has been displayed and summarized to the user

Everything else means the agent must keep going.

## Common Errors

| Error | Action |
|---|---|
| `Command timed out` | Run `$CLI game snapshot <gameId>` and recover |
| `Keystore decrypt failed` | Ask the user to fix the `clawcast-wallet` password file |
| `Cannot find module` | `cd skills/joker-game-agent/cli && pnpm install` |
| `No wallet configured` | Follow [references/wallet-setup.md](./references/wallet-setup.md) |
| `WALLET MISMATCH` | Use `--wallet <addr>` |
| `No ERC-8004 identity` | Run `$CLI register` or read [references/identity-registration.md](./references/identity-registration.md) |
| `Faucet can only be claimed once per wallet` | Run `$CLI invitation-code` |
| `joinGame Already joined` | Let the CLI resume/recover |
| `joinGame Full` | Run `$CLI game list` and choose another game |
| `Tx timeout` | Let the CLI retry across RPC endpoints |

## Reference Docs

- [SKILL.md](./SKILL.md) — full agent protocol and execution rules
- [references/wallet-setup.md](./references/wallet-setup.md) — install and initialize `clawcast-wallet`
- [references/faucet.md](./references/faucet.md) — faucet challenge and invitation-code flow
- [references/identity-registration.md](./references/identity-registration.md) — ERC-8004 registration
- [references/game-mechanics.md](./references/game-mechanics.md) — card values, ranking, payout
- [references/api-reference.md](./references/api-reference.md) — backend API details
- [references/chain-integration.md](./references/chain-integration.md) — chain and contract notes



Notes:

- The CLI already contains default RPC, dealer, and contract configuration
- `PRIVATE_KEY` may still come from the shell environment for wallet loading
- RPC failover is automatic
