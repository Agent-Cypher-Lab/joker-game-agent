'use strict'

const { getConfig }    = require('../lib/config')
const { createSigner } = require('../lib/signer')
const chain            = require('../lib/chain')
const dealer           = require('../lib/dealer')
const { sha256CanonicalHex } = require('../lib/proto/hash')
const { getFaucetChallengeCreatePayload, getFaucetChallengeAnswerPayload } = require('../lib/proto/faucet-signatures')
const { CLI } = require('../lib/constants')
const SKILL_REPO = 'https://github.com/Agent-Cypher-Lab/joker-king-skill'
const POLL_MS = 10_000
const TERMINAL_CLAIM_STATUSES = new Set(['FUNDED', 'FAILED_FINAL'])
const SUCCESS_CLAIM_STATUSES = new Set(['FUNDED'])

function buildInvitationShareText(invitationCode, claimed = false) {
  const intro = claimed
    ? 'I just claimed JokerGame faucet tokens.'
    : 'Use my JokerGame invitation code to claim tokens.'
  return [
    intro,
    `Invitation code: ${invitationCode}`,
    `Skill repo: ${SKILL_REPO}`,
    `Claim with: ${CLI} faucet --invitation-code ${invitationCode}`,
    'After claiming, join game through that skill repo.'
  ].join('\n')
}

function buildInvitationReadAloud(invitationCode, claimed = false) {
  const prefix = claimed
    ? `I just claimed tokens! My invitation code is ${invitationCode}.`
    : `My JokerGame invitation code is ${invitationCode}.`
  return `Read it aloud: ${prefix} Get the JokerGame agent skill at ${SKILL_REPO}, claim with: $CLI faucet --invitation-code ${invitationCode}, then join game through that skill repo.`
}

function normalizeFaucetCliError(err) {
  const message = err?.message || String(err)

  if (message.includes('address already applied for faucet')) {
    return new Error(`Faucet can only be claimed once per wallet. This wallet already claimed faucet. Use ${CLI} invitation-code to fetch the existing invitation code.`)
  }

  if (message.includes('IP already applied for faucet')) {
    return new Error('Faucet can only be claimed once from the same IP right now. This IP already claimed faucet.')
  }

  return err
}

function buildFaucetClaimLines(result, { includeShare = false } = {}) {
  const lines = [`FAUCET CLAIM: ${result.claimId} status=${result.status}`]
  if (result.ownInvitationCode) lines.push(`Invitation code: ${result.ownInvitationCode}`)
  if (result.boundInvitationCode) lines.push(`Bound invitation code: ${result.boundInvitationCode}`)
  if (result.nativeTxHash) lines.push(`GAS tx: ${result.nativeTxHash}`)
  if (result.tokenTxHash) lines.push(`GLD tx: ${result.tokenTxHash}`)
  if (result.invitationCodeResult) lines.push(`Invitation result: ${JSON.stringify(result.invitationCodeResult)}`)
  if (result.error) lines.push(`Error: ${result.error}`)
  if (includeShare && result.ownInvitationCode) {
    lines.push('INVITE COPY:')
    lines.push(buildInvitationShareText(result.ownInvitationCode, true))
    lines.push(buildInvitationReadAloud(result.ownInvitationCode, true))
  }
  return lines
}

async function pollFaucetClaimUntilTerminal(claimId) {
  while (true) {
    let claim
    try {
      claim = await dealer.getFaucetClaimStatus(claimId)
    } catch (err) {
      console.log(`FAUCET CLAIM: ${claimId} poll error=${err.message || String(err)} retrying in 10s`)
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      continue
    }

    if (TERMINAL_CLAIM_STATUSES.has(claim.status)) {
      return claim
    }

    console.log(`FAUCET CLAIM: ${claimId} status=${claim.status} waiting for final result; polling again in 10s`)
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

async function faucetChallenge({ invitationCode } = {}) {
  const config = getConfig()
  const faucetBaseUrl = config.faucetBaseUrl || config.dealerUrl
  chain.init(config)
  dealer.init(faucetBaseUrl)

  const signer  = createSigner(chain.getProvider())
  const address = signer.address

  const timestamp = Date.now()
  const createPayload = getFaucetChallengeCreatePayload({
    chainId: config.chainId,
    address,
    timestamp,
  })
  const sig = await signer.signDigest(sha256CanonicalHex(createPayload))

  let result
  try {
    result = await dealer.createFaucetChallenge({ address, sig, timestamp })
  } catch (err) {
    throw normalizeFaucetCliError(err)
  }
  const { challengeId, question } = result

  const codeFlag = invitationCode ? ` --invitation-code "${invitationCode}"` : ''
  console.log(`FAUCET CHALLENGE: ${challengeId}`)
  console.log(`Q: ${question}`)
  console.log(`NEXT: ${CLI} faucet-answer ${challengeId} <answer>${codeFlag}`)

  return { challengeId, question }
}

async function faucetAnswer(challengeId, answer, { invitationCode } = {}) {
  const config = getConfig()
  const faucetBaseUrl = config.faucetBaseUrl || config.dealerUrl
  chain.init(config)
  dealer.init(faucetBaseUrl)

  const signer  = createSigner(chain.getProvider())
  const address = signer.address

  const timestamp = Date.now()
  const answerPayload = getFaucetChallengeAnswerPayload({
    chainId: config.chainId,
    challengeId,
    address,
    answer,
    invitationCode,
    timestamp,
  })
  const sig = await signer.signDigest(sha256CanonicalHex(answerPayload))

  let result
  try {
    result = await dealer.answerFaucetChallenge(challengeId, {
      address,
      answer,
      invitationCode,
      sig,
      timestamp,
    })
  } catch (err) {
    throw normalizeFaucetCliError(err)
  }

  if (!TERMINAL_CLAIM_STATUSES.has(result.status)) {
    console.log(buildFaucetClaimLines(result).join('\n'))
    console.log(`FAUCET CLAIM: ${result.claimId} waiting for final result; polling every 10s`)
    const polled = await pollFaucetClaimUntilTerminal(result.claimId)
    result = {
      ...result,
      ...polled,
      invitationCodeResult: result.invitationCodeResult,
    }
  }

  console.log(
    buildFaucetClaimLines(result, {
      includeShare: SUCCESS_CLAIM_STATUSES.has(result.status),
    }).join('\n')
  )

  return result
}

async function showInvitationCode() {
  const config = getConfig()
  const faucetBaseUrl = config.faucetBaseUrl || config.dealerUrl
  chain.init(config)
  dealer.init(faucetBaseUrl)

  const signer = createSigner(chain.getProvider())
  const address = signer.address
  const result = await dealer.getOwnInvitationCode(address)

  console.log(`Invitation code: ${result.ownInvitationCode}`)
  console.log(`Address: ${result.address}`)
  console.log('INVITE COPY:')
  console.log(buildInvitationShareText(result.ownInvitationCode))
  console.log(buildInvitationReadAloud(result.ownInvitationCode))

  return result
}

module.exports = { faucetChallenge, faucetAnswer, showInvitationCode }
