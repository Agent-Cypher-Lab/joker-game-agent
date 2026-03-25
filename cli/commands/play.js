'use strict'

const { getConfig }          = require('../lib/config')
const { createSigner }       = require('../lib/signer')
const chain                  = require('../lib/chain')
const dealer                 = require('../lib/dealer')
const { describeCard } = require('../lib/card')
const { join }               = require('./join')
const round                  = require('./round')
const { CLI }                    = require('../lib/constants')
const logger                 = require('../lib/logger')

const POLL_MS       = 10_000
const CHECKPOINT_MS = 20 * 60 * 1_000
const ENDED_WAIT_STATUSES = new Set(['EXPIRED', 'ROUND_CLOSED', 'ROUND_PENDING_FINALIZE'])

function resolveMySeat(snap, address) {
  const seatStates = snap?.seatStates ?? []
  let mySeat = seatStates.find(
    s => (s.address ?? '').toLowerCase() === address.toLowerCase()
  )
  if (!mySeat) {
    const myEntry = (snap?.entries ?? []).find(
      e => (e.address ?? '').toLowerCase() === address.toLowerCase()
    )
    if (myEntry) mySeat = { seatId: myEntry.seatId, address: myEntry.address }
  }
  return mySeat || null
}

function isEndedWaitPhase(phase) {
  return ENDED_WAIT_STATUSES.has(phase)
}

// ── Poll snapshot until card dealt ──────────────────────────────────────────

async function waitForCard(gameId, address) {
  const deadline = Date.now() + CHECKPOINT_MS
  let lastSnap = null
  let lastMySeat = null

  while (Date.now() < deadline) {
    let snap
    try {
      snap = await dealer.getPublicSnapshot(gameId, 1)
    } catch {
      await new Promise(r => setTimeout(r, POLL_MS))
      continue
    }
    lastSnap = snap

    const gameStatus = snap.game?.status ?? 'UNKNOWN'
    if (isEndedWaitPhase(gameStatus)) {
      return { snap, mySeat: lastMySeat, ready: false, terminal: gameStatus }
    }

    const mySeat = resolveMySeat(snap, address)
    if (mySeat) lastMySeat = mySeat

    if (mySeat) {
      const cardDealt = Boolean(mySeat.initialCardCiphertextHash)
      const roundData = snap.round
      const roundOpen = roundData != null && roundData.roundStartMs != null

      if (roundOpen && cardDealt) {
        return { snap, mySeat, ready: true }
      }
    }

    await new Promise(r => setTimeout(r, POLL_MS))
  }

  return { snap: lastSnap, mySeat: lastMySeat, ready: false, checkpoint: true }
}

function printCheckpoint(gameId, snap, mySeat) {
  const seatStates = snap?.seatStates ?? []
  const joined     = (snap?.entries ?? []).length || seatStates.length
  const maxSeats   = snap?.meta?.maxSeats ?? snap?.game?.maxSeats ?? '?'
  const gamePhase  = snap?.game?.status ?? 'UNKNOWN'
  const seatId     = mySeat?.seatId ?? 'N/A'
  console.log(`CHECKPOINT game=${gameId} phase=${gamePhase} seats=${joined}/${maxSeats} mySeat=${seatId} NEXT: ${CLI} wait ${gameId}`)
}

function printEndedWait(gameId, phase) {
  console.log(`WAIT STOPPED game=${gameId} phase=${phase} NEXT: ${CLI} join`)
}

// ── Full flow: join → wait → read card → hand off decision ──────────────────

async function run(gameId, { joinKey } = {}) {
  const joinResult = await join(gameId, { joinKey })
  gameId = joinResult.gameId
  logger.init(gameId)

  // If challenge is pending, stop here — agent must solve and run challenge-answer
  if (joinResult.challengePending) {
    return joinResult
  }

  const config = getConfig()
  chain.init(config)
  dealer.init(config.dealerUrl)

  const provider = chain.getProvider()
  const signer   = createSigner(provider)
  const address  = signer.address

  // Phase 1: Wait for card deal until card arrives, room ends, or checkpoint is hit
  const waitResult = await waitForCard(gameId, address)

  if (waitResult.terminal) {
    printEndedWait(gameId, waitResult.terminal)
    return { gameId, terminal: waitResult.terminal, endedWaiting: true }
  }

  if (waitResult.checkpoint) {
    printCheckpoint(gameId, waitResult.snap, waitResult.mySeat)
    return { gameId, checkpoint: true }
  }

  const { snap, mySeat } = waitResult
  const seatId   = mySeat.seatId
  const roundNum = 1
  const N = snap?.seatStates?.length || snap?.entries?.length || 6

  // Phase 2: Read card
  const cardResp = await round.readCard(gameId, roundNum, { signer, address })
  const card     = cardResp.card
  console.log(`CARD: ${describeCard(card)} players=${N}`)
  console.log(`KEEP -> ${CLI} finalize ${gameId} ${roundNum}`)
  console.log(`SWAP -> ${CLI} swap ${gameId} ${roundNum}`)

  return { gameId, seatId, card, N, pendingDecision: true }
}

module.exports = { run, waitForCard, printCheckpoint, printEndedWait, isEndedWaitPhase }
