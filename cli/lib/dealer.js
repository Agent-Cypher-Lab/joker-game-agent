'use strict'

let _baseUrl = ''

const MAX_RETRIES  = 5
const REQ_TIMEOUT  = 60_000  // 1 minute per attempt

function init(dealerUrl) {
  _baseUrl = dealerUrl
}

async function _api(method, path, body) {
  let lastError
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let timer
    try {
      const url = `${_baseUrl}${path}`
      const ctrl = new AbortController()
      timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT)
      const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
      }
      if (body !== undefined) opts.body = JSON.stringify(body)

      const res = await fetch(url, opts)

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const err  = new Error(`HTTP ${res.status} ${method} ${path}: ${text}`)
        err.status = res.status
        // Don't retry client errors (4xx) except 408/429
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          throw err
        }
        throw err
      }
      return res.json()
    } catch (err) {
      lastError = err
      // Don't retry 4xx client errors (already thrown above)
      if (err.status && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
        throw err
      }
      if (attempt < MAX_RETRIES) {
        const delay = Math.min(1000 * attempt, 5000)
        await new Promise(r => setTimeout(r, delay))
      }
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`Dealer API ${method} ${path} failed after ${MAX_RETRIES} attempts: ${lastError.message}`)
}

async function listGames(status) {
  return _api('GET', `/v1/games?status=${encodeURIComponent(status)}&limit=50`)
}

async function getConfig(gameId) {
  return _api('GET', `/v1/games/${gameId}/config`)
}

async function getPublicInfo(gameId) {
  return _api('GET', `/v1/games/${gameId}/public`)
}

async function getPublicSnapshot(gameId, round = 1) {
  return _api('GET', `/v1/read/games/${gameId}/snapshot?round=${round}`)
}

async function recoverEntry(gameId, address) {
  return _api('GET', `/v1/games/${gameId}/entries?address=${encodeURIComponent(address)}`)
}

async function readCard(gameId, round, { sig, address }) {
  return _api('POST', `/v1/games/${gameId}/rounds/${round}/card`, { address, sig })
}

async function swapRequest(gameId, round, { sig, address }) {
  return _api('POST', `/v1/games/${gameId}/rounds/${round}/swap-request`, { address, sig })
}

async function seatFinalize(gameId, round, { sig, address }) {
  return _api('POST', `/v1/games/${gameId}/rounds/${round}/seat-finalize`, { address, sig })
}

async function getSettlement(gameId) {
  try {
    return await _api('GET', `/v1/games/${gameId}/settlement`)
  } catch (err) {
    if (err.status === 404) return null
    throw err
  }
}

async function createChallenge(gameId, { address, agentId }) {
  return _api('POST', `/v1/games/${gameId}/challenges`, { address, agentId })
}

async function answerChallenge(gameId, challengeId, { address, agentId, answer }) {
  return _api('POST', `/v1/games/${gameId}/challenges/${challengeId}/answer`, { address, agentId, answer })
}

async function submitEntryWithChallenge(gameId, { txid, sig, address, agentId, joinKey }) {
  try {
    return await _api('POST', `/v1/games/${gameId}/entries`, { txid, address, sig, agentId, joinKey })
  } catch (err) {
    if (err.status === 409) {
      return recoverEntry(gameId, address)
    }
    throw err
  }
}

async function getMatchHistory(address) {
  return _api('GET', `/v1/users/${encodeURIComponent(address)}/matches`)
}

async function getUserSummary(address) {
  return _api('GET', `/v1/users/${encodeURIComponent(address)}/summary`)
}

async function createFaucetChallenge({ address, sig, timestamp }) {
  return _api('POST', '/v1/faucet/challenges', { address, sig, timestamp })
}

async function answerFaucetChallenge(challengeId, { address, answer, invitationCode, sig, timestamp }) {
  return _api('POST', `/v1/faucet/challenges/${encodeURIComponent(challengeId)}/answer`,
    { address, answer, invitationCode, sig, timestamp })
}

async function getOwnInvitationCode(address) {
  return _api('GET', `/v1/faucet/invitation-code?address=${encodeURIComponent(address)}`)
}

async function getFaucetClaimStatus(claimId) {
  return _api('GET', `/v1/faucet/claims/${encodeURIComponent(claimId)}`)
}

module.exports = {
  init,
  listGames,
  getConfig,
  getPublicInfo,
  getPublicSnapshot,
  recoverEntry,
  submitEntryWithChallenge,
  createChallenge,
  answerChallenge,
  readCard,
  swapRequest,
  seatFinalize,
  getSettlement,
  getMatchHistory,
  getUserSummary,
  createFaucetChallenge,
  answerFaucetChallenge,
  getFaucetClaimStatus,
  getOwnInvitationCode,
}
