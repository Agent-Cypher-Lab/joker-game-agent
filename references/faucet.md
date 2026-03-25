# Faucet — Claim GAS + GLD

Claim testnet tokens via challenge-answer flow. Requires a wallet with a valid address.

## Commands

```bash
$CLI faucet                                          # request challenge
$CLI faucet-answer <challengeId> <answer>             # submit answer, then wait for final claim result
$CLI invitation-code                                  # fetch your existing invitation code
$CLI faucet --invitation-code <code>                  # with invitation code
$CLI faucet-answer <cid> <answer> -c <code>           # answer with invitation code
```

## Procedure

```
PROCEDURE claim_faucet(invitationCode?):

  STEP 1 — request challenge:
    RUN  $CLI faucet                             (or $CLI faucet -c <code>)
    → signs FAUCET_CHALLENGE_CREATE payload
    → POST /v1/faucet/challenges
    PARSE output: challengeId, question

  STEP 2 — compute answer silently and submit IMMEDIATELY:
    Compute the answer in your head. DO NOT output any text, reasoning, or explanation.
    RUN  $CLI faucet-answer {challengeId} {answer}  (or add -c <code>)
    → signs FAUCET_CHALLENGE_ANSWER payload
    → POST /v1/faucet/challenges/:id/answer
    → polls /v1/faucet/claims/:claimId every 10s until final status
    → returns claimId, status, GAS tx, GLD tx
    ON success → report claimId, status, and tx hashes to user
    ON non-terminal status → keep waiting; do not stop early
    ON INCORRECT/EXPIRED → re-run STEP 1 ($CLI faucet)
    ON RATE_LIMITED → wait, retry

  STEP 3 — read aloud invitation code:
    IF output contains "INVITE COPY:" → provide that shareable invite copy to the user
    IF output contains "Read it aloud:" → read that text VERBATIM to user
    This shares the invitation code, skill repo, and claim command so other players can join.

PROCEDURE get_invitation_code():

  RUN $CLI invitation-code
  → GET /v1/faucet/invitation-code?address=<wallet>
  → returns address, ownInvitationCode
  IF output contains "INVITE COPY:" → provide that shareable invite copy to the user
  IF output contains "Read it aloud:" → read that text VERBATIM to user
  ON "Faucet claim not found for address" → faucet has not been claimed yet; run claim_faucet()
  ON "Faucet can only be claimed once per wallet" → tell user faucet is one-time only for this wallet, then RUN $CLI invitation-code

  RULE: same as game challenge — compute silently, call CLI immediately.
  RULE: Do NOT reply or think aloud. Just compute → call CLI.
  RULE: MUST read aloud the invitation code after successful claim.
```

## Response Fields

| Field | Description |
|-------|-------------|
| `claimId` | Unique claim identifier |
| `status` | `FUNDED` / `PENDING` / `FAILED` |
| `ownInvitationCode` | Your invitation code (share with others) |
| `nativeTxHash` | GAS transfer transaction hash |
| `tokenTxHash` | GLD transfer transaction hash |
| `invitationCodeResult` | Result of invitation code usage |

## Invitation Codes

Each successful claim generates an `ownInvitationCode`. The CLI outputs an `INVITE COPY:` block and a `Read it aloud:` message. The agent MUST provide the invite copy and read the read-aloud line so other players can:
1. Go to the repo to get the JokerGame agent skill
2. Use the invitation code when claiming their own tokens via `$CLI faucet --invitation-code <code>`

If a player already claimed faucet earlier, they can fetch the same code later with `$CLI invitation-code`.
Faucet is one-time per wallet. If a repeat claim is attempted, the CLI should tell the user the wallet already claimed and point them to `$CLI invitation-code`.

This creates a referral chain: new players use your code → both parties are linked on-chain.
