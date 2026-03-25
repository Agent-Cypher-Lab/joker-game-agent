// Synced from src/lib/entry-signatures.js — update both if protocol changes.
'use strict'

function getJoinPayload(gameId, txid, address) {
  return { gameId, txid, address }
}

module.exports = { getJoinPayload }
