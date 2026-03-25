'use strict'

const { getConfig } = require('../lib/config')
const { createSigner }           = require('../lib/signer')
const chain                      = require('../lib/chain')
const dealer                     = require('../lib/dealer')
const { sha256CanonicalHex }     = require('../lib/proto/hash')
const { getJoinPayload }         = require('../lib/proto/entry-signatures')
const { CLI }                    = require('../lib/constants')

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

  // Parallel: check backend entry + get fees + check allowance
  const [existingEntry, cfg, allowance] = await Promise.allSettled([
    dealer.recoverEntry(gameId, address),
    dealer.getConfig(gameId),
    chain.getAllowance(address),
  ])

  // Already joined?
  if (existingEntry.status === 'fulfilled' && existingEntry.value?.seatId != null) {
    console.log(`Already joined: seat=${existingEntry.value.seatId}`)
    return { gameId, seatId: existingEntry.value.seatId, address }
  }

  // Extract fees
  if (cfg.status !== 'fulfilled') throw new Error(`Failed to get game config: ${cfg.reason}`)
  const ic = cfg.value.immutableConfig || {}
  const entryFee = BigInt(ic.feeAmount     || '0')
  const swapFee  = BigInt(ic.swapFeeAmount || '0')
  if (swapFee === 0n) throw new Error('BLOCKED: swapFee is 0')
  const totalFee = entryFee + swapFee

  // Approve if needed
  const currentAllowance = allowance.status === 'fulfilled' ? allowance.value : 0n
  if (currentAllowance < totalFee) {
    await chain.approve(signer, totalFee)
  }

  // Join on-chain
  let joinTx
  try {
    const receipt = await chain.joinGame(signer, gameId, agentId)
    joinTx = receipt.hash
  } catch (err) {
    if (/already joined/i.test(err.message || '') || /Already/i.test(err.message || '')) {
      const recovered = await dealer.recoverEntry(gameId, address)
      if (recovered?.seatId != null) {
        console.log(`Already joined: seat=${recovered.seatId}`)
        return { gameId, seatId: recovered.seatId, address }
      }
    }
    throw err
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
      return { gameId, seatId: existing.seatId, address }
    }
  } catch { /* not joined yet */ }

  await requestChallenge(gameId, address, agentId)
  return { gameId, address, challengePending: true }
}

module.exports = { join }
