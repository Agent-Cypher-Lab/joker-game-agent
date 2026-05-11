'use strict'

const { getConfig } = require('../lib/config')
const { createSigner }           = require('../lib/signer')
const chain                      = require('../lib/chain')
const dealer                     = require('../lib/dealer')
const { sha256CanonicalHex }     = require('../lib/proto/hash')
const { getJoinPayload }         = require('../lib/proto/entry-signatures')
const { CLI }                    = require('../lib/constants')
const { buildGameJoinLines }     = require('../lib/share')

// ── Find a joinable game ────────────────────────────────────────────────────

async function findJoinableGame() {
  for (const status of ['BOOTSTRAPPED']) {
    try {
      const data  = await dealer.listGames(status)
      const items = data.items || []
      if (items.length > 0) return items[0].gameId
    } catch { continue }
  }
  throw new Error('No joinable game found. Try again later or specify a gameId.')
}

// ── Resolve AGENT_ID ────────────────────────────────────────────────────────

async function resolveAgentId(address) {
  const agentId = await chain.lookupAgentId(address)
  if (!agentId) {
    throw new Error('No ERC-8004 identity. Run: register')
  }
  return agentId
}

// ── Challenge flow ──────────────────────────────────────────────────────────

async function requestChallenge(gameId, address, agentId) {
  const result = await dealer.createChallenge(gameId, { address, agentId: String(agentId) })
  console.log(`Q: ${result.question} NEXT: ${CLI} challenge-answer ${gameId} ${result.challengeId} <answer>`)
  return result
}

function isAlreadyJoinedError(message) {
  return /already joined/i.test(message) || /\bjoined\b/i.test(message)
}

// ── Join with joinKey (on-chain + backend) ──────────────────────────────────

async function joinWithKey(gameId, joinKey) {
  const config = getConfig()
  chain.init(config)
  dealer.init(config.dealerUrl)

  const provider = chain.getProvider()
  const signer   = createSigner(provider)
  const address  = signer.address
  const agentId  = await resolveAgentId(address)

  if (!gameId) gameId = await findJoinableGame()

  // Parallel: check chain join state and backend entry
  const [chainJoinedRes, existingEntryRes] = await Promise.allSettled([
    chain.isJoined(gameId, address),
    dealer.recoverEntry(gameId, address),
  ])

  const existingEntry = existingEntryRes.status === 'fulfilled' ? existingEntryRes.value : null
  const isBackendJoined = existingEntry?.seatId != null
  const isChainJoined = chainJoinedRes.status === 'fulfilled' ? chainJoinedRes.value : false

  if (isBackendJoined && isChainJoined) {
    console.log(`Already joined: seat=${existingEntry.seatId}`)
    console.log(buildGameJoinLines(gameId).join('\n'))
    return { gameId, seatId: existingEntry.seatId, address }
  }

  if (isBackendJoined && !isChainJoined) {
    let joinTx = null
    try {
      const [cfg, allowance] = await Promise.all([
        dealer.getConfig(gameId),
        chain.getAllowance(address),
      ])
      const ic = cfg.immutableConfig || {}
      const entryFee = BigInt(ic.feeAmount     || '0')
      const swapFee  = BigInt(ic.swapFeeAmount || '0')
      if (swapFee === 0n) throw new Error('BLOCKED: swapFee is 0')
      const totalFee = entryFee + swapFee
      const currentAllowance = allowance ?? 0n
      if (currentAllowance < totalFee) {
        await chain.approve(signer, totalFee)
      }

      joinTx = await chain.joinGame(signer, gameId, agentId)
      joinTx = joinTx.hash
    } catch (err) {
      if (!isAlreadyJoinedError(err.message || '')) throw err
      // Someone else may have joined on-chain in a concurrent attempt; proceed if this is just a state-sync case.
      const recoveredTx = await chain.getJoinTxByPlayer(gameId, address)
      if (!recoveredTx) throw err
      joinTx = recoveredTx
    }

    console.log(`Already joined backend entry exists, contract synced: seat=${existingEntry.seatId}`)
    console.log(buildGameJoinLines(gameId).join('\n'))
    return { gameId, seatId: existingEntry.seatId, address }
  }

  let joinTx
  if (!isChainJoined) {
    // Need to join on-chain this run.
    const [cfg, allowance] = await Promise.all([
      dealer.getConfig(gameId),
      chain.getAllowance(address),
    ])
    const ic = cfg.immutableConfig || {}
    const entryFee = BigInt(ic.feeAmount     || '0')
    const swapFee  = BigInt(ic.swapFeeAmount || '0')
    if (swapFee === 0n) throw new Error('BLOCKED: swapFee is 0')
    const totalFee = entryFee + swapFee

    // Approve if needed
    const currentAllowance = allowance ?? 0n
    if (currentAllowance < totalFee) {
      await chain.approve(signer, totalFee)
    }

    try {
      const receipt = await chain.joinGame(signer, gameId, agentId)
      joinTx = receipt.hash
    } catch (err) {
      const msg = err.message || ''
      if (!isAlreadyJoinedError(msg)) {
        throw err
      }
      joinTx = await chain.getJoinTxByPlayer(gameId, address)
      if (!joinTx) throw err
    }
  } else {
    // Contract already joined, only backend entry is missing.
    joinTx = await chain.getJoinTxByPlayer(gameId, address)
    if (!joinTx) {
      throw new Error('Contract joined but backend join ticket not found by event lookup, cannot recover automatically')
    }
  }

  // Sign + submit to backend with joinKey
  const payload = getJoinPayload(gameId, joinTx, address)
  const digest  = sha256CanonicalHex(payload)
  const sig     = await signer.signDigest(digest)

  const entry = await dealer.submitEntryWithChallenge(gameId, {
    txid: joinTx, sig, address, agentId: String(agentId), joinKey
  })

  if (entry.seatId == null) throw new Error(`BLOCKED: seatId not returned: ${JSON.stringify(entry)}`)

  console.log(`JOINED game=${gameId} seat=${entry.seatId}${entry.autoStart?.started ? ' STARTED' : ''}`)
  console.log(buildGameJoinLines(gameId).join('\n'))
  return { gameId, seatId: entry.seatId, address }
}

// ── Main join flow: always challenge first ──────────────────────────────────

async function join(gameId, { joinKey } = {}) {
  if (joinKey) {
    return joinWithKey(gameId, joinKey)
  }

  const config = getConfig()
  chain.init(config)
  dealer.init(config.dealerUrl)

  const provider = chain.getProvider()
  const signer   = createSigner(provider)
  const address  = signer.address
  const agentId  = await resolveAgentId(address)

  if (!gameId) gameId = await findJoinableGame()

  // Check if already joined
  try {
    const existing = await dealer.recoverEntry(gameId, address)
    if (existing?.seatId != null) {
      console.log(`Already joined: seat=${existing.seatId}`)
      console.log(buildGameJoinLines(gameId).join('\n'))
      return { gameId, seatId: existing.seatId, address }
    }
  } catch { /* not joined yet */ }

  await requestChallenge(gameId, address, agentId)
  return { gameId, address, challengePending: true }
}

module.exports = { join }
