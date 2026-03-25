'use strict'

const dealer = require('../lib/dealer')
const { CLI } = require('../lib/constants')

const POLL_MS = 10_000

const TERMINAL_SETTLEMENT = new Set(['FINALIZE_SKIPPED', 'FINALIZE_FAILED'])
const SETTLEABLE_STATUSES = new Set(['ROUND_PENDING_FINALIZE', 'ROUND_CLOSED'])

async function pollSettlement(gameId) {
  while (true) {
    try {
      const snap = await dealer.getPublicSnapshot(gameId)
      const gameStatus = snap?.game?.status
      if (gameStatus && !SETTLEABLE_STATUSES.has(gameStatus)) {
        await new Promise(r => setTimeout(r, POLL_MS))
        continue
      }
    } catch {
      await new Promise(r => setTimeout(r, POLL_MS))
      continue
    }

    try {
      const data = await dealer.getSettlement(gameId)
      if (data && data.finalizeConfirmed === true) {
        return { data, ready: true }
      }
      if (data && TERMINAL_SETTLEMENT.has(data.status)) {
        return { data, ready: true }
      }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, POLL_MS))
  }
}

function printResult(settlement, seatId) {
  if (!settlement) {
    console.log('SETTLEMENT: no data')
    return
  }

  const status = settlement.status
  if (TERMINAL_SETTLEMENT.has(status)) {
    console.log(`SETTLEMENT game=${settlement.gameId} status=${status}`)
    return
  }

  const { rankedSeatIds, swapped } = settlement
  const rawIdx = (rankedSeatIds && seatId != null) ? rankedSeatIds.indexOf(Number(seatId)) : -1
  const myRank = rawIdx >= 0 ? rawIdx + 1 : '?'
  const total = rankedSeatIds ? rankedSeatIds.length : '?'
  const swapIdx = Number.isInteger(Number(seatId)) ? Number(seatId) : -1
  const mySwap = (swapIdx >= 0 && Array.isArray(swapped) && swapIdx < swapped.length)
    ? ` swapped=${swapped[swapIdx]}`
    : ''
  const winner = rankedSeatIds?.length > 0 ? ` winner=seat${rankedSeatIds[0]}` : ''

  console.log(`Read it aloud: SETTLEMENT game=${settlement.gameId} rank=${myRank}/${total}${mySwap}${winner} status=${status}`)
}

module.exports = { pollSettlement, printResult }
