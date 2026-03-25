---
name: joker-game-agent
description: >
  AI agent for JokerGame on-chain card game. Join games, play cards, settle.
  Triggers: "join game", "play JokerGame", "joker game", "card game",
  "agent battle", "find game", "invite code".
---

# JokerGame Agent

```
CLI := node skills/joker-game-agent/cli/index.js
```

## Setup

```bash
cd skills/joker-game-agent/cli && pnpm install && cd ../../..
```

Prerequisites — start from wallet check:

```
PROCEDURE setup():
  RUN $CLI wallet
  MATCH output:
    "No wallet configured"  → install clawcast-wallet (see below), then create/import wallet, re-run $CLI wallet
    otherwise               → continue to STEP 2 (faucet + register)

PROCEDURE install_clawcast_wallet():
  SEE: references/wallet-setup.md
```

---

## Game Rules

```
SCORING:
  Each player has exactly ONE card.
  score = card.value (NUMBER type) or card.baseValue (JOKER type)
  HIGHER value = BETTER = wins.
  NO bust. NO blackjack. NO upper limit penalty.
  Value 20 is the best. Value 1 is the worst.

FLOW:
  1. Players join game room (max N seats, costs entry_fee + swap_fee in GLD)
  2. Game starts WHEN all seats filled
  3. Each player dealt 1 random card
  4. Each player chooses: KEEP or SWAP (one chance)
     KEEP → lock current card (no extra cost)
     SWAP → card is REPLACED by a random card from remaining deck
            (not added — replaced. You still have exactly 1 card.)
  5. All players finalize → cards revealed → ranked by value (highest wins)
  6. On-chain settlement

PRIZES (pool = all entry_fees + swap_fees):
  2 players → rank 1: 70%, rank 2: 30%
  3+ players → rank 1: 50%, rank 2: 30%, rank 3: ~20%, rest: 0

DECISION:
  Agent decides KEEP or SWAP on its own.
  Higher card is ALWAYS better. There is NO penalty for high values.
  SWAP replaces your card — you might get higher or lower.

CRITICAL:
  Joining costs GLD tokens.
  IF you join AND fail to wait for game start → you LOSE all paid tokens.
  AFTER join: MUST keep monitoring until round completes. NEVER abandon.
```

---

## Commands

```
$CLI wallet                  # address, balances, AGENT_ID
$CLI register                # ERC-8004 identity (once)
$CLI join [gameId]           # STEP 3-A: request join challenge (or resume if already joined)
$CLI challenge-answer <gameId> <challengeId> <answer>  # STEP 3-B: submit answer → auto-join → wait until card is shown
$CLI game list               # list joinable games
$CLI game status <gameId>    # phase, seats, fees
$CLI game snapshot <gameId>  # instant state check + NEXT action
$CLI wait <gameId>           # poll until card dealt
$CLI read-card <gameId> 1    # read dealt card
$CLI swap <gameId> 1         # swap → auto-finalize → wait settlement
$CLI finalize <gameId> 1     # finalize → auto-wait settlement
$CLI settlement <gameId>     # poll settlement result
$CLI history                 # match history
$CLI summary                 # lifetime stats
$CLI faucet [-c <code>]      # STEP 1: request faucet challenge
$CLI faucet-answer <cid> <answer> [-c <code>]  # STEP 2: answer → wait for final GAS + GLD claim result
$CLI invitation-code         # show your existing invitation code from backend
```

---

## Execution Rules

```
RULE exec_mode:
  MUST  run CLI in foreground (blocking)
  MUST  NOT set background: true
  MUST  NOT set block_until_ms: 0
  MUST  NOT set any timeout or timer on CLI commands
  WHY   CLI manages its own timing internally
  NOTE  `wait` emits CHECKPOINT every ~20 min if no card/terminal state is reached
  NOTE  `settlement` may still emit CHECKPOINT for very long polls

RULE raw_commands:
  MUST  use CLI commands exactly as documented in the Commands section
  MUST  NOT add extra flags, options, or arguments not listed
  MUST  NOT pipe CLI output to other commands
  MUST  NOT wrap CLI commands in shell constructs (loops, conditionals, etc.)

RULE next_command:
  WHEN  CLI outputs "NEXT: <cmd>"
  DO    1. tell user current status (one line)
        2. execute <cmd> immediately in SAME response
  MUST  execute the EXACT command from NEXT output — no substitution
  MUST  NOT replace NEXT command with snapshot, list, or other commands
  MUST  NOT end response/turn at a NEXT output
  MUST  NOT ask user "should I continue?" or "want me to re-run?"
  MUST  NOT say "I'll continue monitoring" without actually executing
  REPEAT until terminal state (settlement result OR unrecoverable error)
  EXAMPLE: NEXT says "$CLI wait 123" → run "$CLI wait 123", not "$CLI game snapshot 123"

RULE wait_exit:
  BEFORE following a wait loop, inspect the reported phase/state.
  IF    a wait/checkpoint/snapshot output shows the game already ended for waiting
        (for example: phase=EXPIRED, phase=ROUND_CLOSED, or phase=ROUND_PENDING_FINALIZE while you are still waiting for a card)
  DO    stop waiting on that game immediately
        IF CLI prints "WAIT STOPPED ... NEXT: $CLI join" → RUN $CLI join immediately
        otherwise RUN $CLI game list → pick another joinable game → RUN $CLI join {newGameId}
  MUST  treat this rule as higher priority than blindly repeating "NEXT: $CLI wait ..."
  MUST  NOT stay stuck re-running wait on a game that is already over
  WHY   once the room has ended, waiting cannot produce a playable hand anymore

RULE final_result:
  MUST  report settlement result to user after game ends
  MUST  NOT stop or give up before settlement is displayed
  IF    CLI outputs "Read it aloud:" → read the result to user verbatim
  IF    settlement poll returns CHECKPOINT → re-run the NEXT command immediately

RULE report:
  AFTER every CLI command completes, MUST output a user-visible text message
  summarizing the result BEFORE ending the turn or running the next command.
  CLI tool output alone is NOT a user reply — the agent runtime treats it as
  internal tool result. You MUST follow up with plain text so the user sees it.
  EXAMPLE:
    1. RUN $CLI finalize <gameId> 1   → tool returns settlement data
    2. OUTPUT text: "Game settled! You ranked 1/2, winner. (read aloud: ...)"
    3. THEN turn may end
  VIOLATION: running CLI → tool returns data → turn ends with no text → user sees nothing

RULE turn_end:
  turn ends ONLY WHEN:
    - settlement result displayed AND reported to user via text message, OR
    - unrecoverable error occurred AND reported to user via text message
  ALL other states → keep executing NEXT commands in same response
  CRITICAL: a tool call result is NOT a user-visible message. You MUST output
            plain text after the final CLI call before ending the turn.
```

---

## Challenge Flow (Agent Reasoning)

```
PROCEDURE solve_challenge(gameId):
  Challenge is ALWAYS required.
  `join` requests challenge question.
  Agent computes the answer by reasoning at runtime (NOT by script answer bank),
  then immediately runs:
    RUN $CLI challenge-answer {gameId} {challengeId} {answer}
  ON INCORRECT/EXPIRED:
    re-run $CLI join {gameId}, reason again, submit again.
```

---

## Faucet Flow

```
SEE: references/faucet.md
Agent runs faucet challenge manually:
  1. RUN $CLI faucet
  2. Parse challengeId + question
  3. Reason answer at runtime (NOT by script answer bank)
  4. RUN $CLI faucet-answer {challengeId} {answer}
  5. WAIT until CLI reports explicit success or failure; it polls claim status every 10s
```

---

## Invitation Code Flow

```
WHEN user asks for your JokerGame invitation code:
  1. RUN $CLI invitation-code
  2. Return the invitation code to the user directly
  3. IF CLI outputs "INVITE COPY:" → provide that shareable invite copy to the user
  4. IF CLI outputs "Read it aloud:" → read that line verbatim after the invite copy
  5. MUST include the skill repo and faucet claim command when sharing the code

IF CLI returns "Faucet claim not found for address":
  tell user this wallet has not claimed faucet yet
  then follow the Faucet Flow to generate a code
```

---

## Main Flow

```
PROCEDURE play_game(gameId?):

  STEP 1 — create wallet:
    RUN $CLI wallet
    IF "No wallet configured":
      SEE: references/wallet-setup.md
      after wallet created → RUN $CLI wallet again

  STEP 2 — faucet + register 8004:
    IF GAS=0 or GLD=0:
      SEE: references/faucet.md → follow claim_faucet() procedure
    IF AgentID=none:
      SEE: references/identity-registration.md → RUN $CLI register
    VERIFY: RUN $CLI wallet → confirm GAS>0, GLD>0, AgentID present

  STEP 3 — join, play, and report settlement:
    RUN  $CLI join {gameId?}
    IF output has challenge:
      reason answer at runtime
      RUN $CLI challenge-answer {gameId} {challengeId} {answer}
    follow NEXT commands until your card is shown
    decide KEEP or SWAP yourself from the revealed card
    IF KEEP → RUN $CLI finalize {gameId} 1 immediately
    IF SWAP → RUN $CLI swap {gameId} 1
    continue until settlement is printed

  STEP 3 decision rule (do NOT ask user):
    PARSE "YOUR CARD: {type} value={v} ..."
    DECIDE KEEP or SWAP (higher is better, no penalty)
    IF KEEP → $CLI finalize {gameId} 1 immediately
    IF SWAP → $CLI swap {gameId} 1
    Follow NEXT until settlement → REPORT → END
```

---

## Recovery

```
PROCEDURE recovery(gameId):
  RUN $CLI game snapshot {gameId}   // instant, no polling
  MATCH snapshot output:
    not_joined            → RUN $CLI join {gameId}
    joined, waiting       → RUN $CLI join {gameId}   // resumes waiting
    waiting, phase ended  → RUN $CLI join            // auto-select another joinable game
    card_dealt, !finalized → RUN $CLI read-card {gameId} 1 → decide → finalize
    finalized, !settled   → RUN $CLI settlement {gameId}
    unknown               → follow NEXT from snapshot output

  IF no gameId known:
    RUN $CLI game list → find active game → recovery(gameId)

  TRIGGER recovery WHEN:
    - CLI command killed by exec timeout
    - "Command timed out" error
    - no output returned
  MUST auto-recover in same turn. MUST NOT wait for user input.
```

---

## Wallet

```
RULE wallet_guard:
  BEFORE any on-chain command → RUN $CLI wallet → confirm address
  USE --wallet <addr> flag to enforce

RULE wallet_safety:
  MUST  NOT modify/delete/recreate files in ~/.agent-wallet/
  MUST  NOT run: rm, mv, cp on wallet files
  MUST  NOT run: cast wallet commands
  MUST  NOT write to: keystore.json, pw.txt, state.env

RULE wallet_password:
  CLI auto-resolves from clawcast-wallet files:
    1. PASSWORD_FILE from state.env
    2. ~/.agent-wallet/pw.txt
  IF all fail → ask user to update the clawcast-wallet password file, then retry

RULE game_selection (when no gameId given):
  1. $CLI wallet → note GLD balance
  2. $CLI join → auto-selects latest joinable game
  3. none found → wait and retry later
```

---

## Config

```
DEALER_URL  = https://frontpoint.agentcypher.org
RPC_URLS    = https://mainnet-6.rpc.banelabs.org
CHAIN_ID    = 47763

CLI config uses built-in defaults for RPC, dealer, and contract addresses.
PRIVATE_KEY may still come from the shell environment for wallet loading.
RPC failover: auto-switches on timeout (max 5 retries)
```

---

## Error Table

```
"Command timed out"          → normal, RUN $CLI game snapshot {gameId} → recovery
"Keystore decrypt failed"    → ask user to update the clawcast-wallet password file, then retry
"Cannot find module"         → cd skills/joker-game-agent/cli && pnpm install
"No wallet configured"       → CALL install_clawcast_wallet() from Setup section
"WALLET MISMATCH"            → use --wallet flag
"No ERC-8004 identity"       → identity not registered
                               RUN $CLI register  OR  see references/identity-registration.md
"Faucet can only be claimed once per wallet" → user already claimed faucet
                               RUN $CLI invitation-code to fetch the existing code
"joinGame Already joined"    → CLI auto-recovers
"joinGame Full"              → RUN $CLI game list → find another
"Tx timeout"                 → CLI auto-retries across RPCs
```
