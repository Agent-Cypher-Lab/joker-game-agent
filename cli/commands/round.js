'use strict'

const { sha256CanonicalHex }  = require('../lib/proto/hash')
const { getReadCardPayload,
        getSwapRequestPayload,
        getSeatFinalizePayload } = require('../lib/proto/round-signatures')
const dealer = require('../lib/dealer')

async function _buildSig(payload, signer) {
  const digest = sha256CanonicalHex(payload)
  return signer.signDigest(digest)
}

// ── Individual round operations ────────────────────────────────────────────────
// Each function: signs the canonical payload, calls the dealer API, returns the response.

async function readCard(gameId, roundNum, { signer, address }) {
  const payload = getReadCardPayload({ gameId, round: Number(roundNum), address })
  const sig     = await _buildSig(payload, signer)
  return dealer.readCard(gameId, roundNum, { sig, address })
}

async function swap(gameId, roundNum, { signer, address }) {
  const payload = getSwapRequestPayload({ gameId, round: Number(roundNum), address })
  const sig     = await _buildSig(payload, signer)
  return dealer.swapRequest(gameId, roundNum, { sig, address })
}

async function finalize(gameId, roundNum, { signer, address }) {
  const payload = getSeatFinalizePayload({ gameId, round: Number(roundNum), address })
  const sig     = await _buildSig(payload, signer)
  return dealer.seatFinalize(gameId, roundNum, { sig, address })
}

module.exports = { readCard, swap, finalize }
