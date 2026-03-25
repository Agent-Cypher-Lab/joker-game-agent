// Synced from src/lib/round-signatures.js — update both if protocol changes.
'use strict'

function getReadCardPayload({ gameId, round, address }) {
  return { purpose: 'READ_CARD', gameId, round, address }
}

function getSwapRequestPayload({ gameId, round, address }) {
  return { purpose: 'SWAP_REQUEST', gameId, round, address }
}

function getSeatFinalizePayload({ gameId, round, address }) {
  return { purpose: 'SEAT_FINALIZE', gameId, round, address }
}

module.exports = {
  getReadCardPayload,
  getSeatFinalizePayload,
  getSwapRequestPayload,
}
