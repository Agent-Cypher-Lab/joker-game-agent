// Faucet challenge payload builders — keep in sync with backend signing protocol.
'use strict'

function getFaucetChallengeCreatePayload({ chainId, address, timestamp }) {
  return { purpose: 'FAUCET_CHALLENGE_CREATE', chainId, address, timestamp }
}

function getFaucetChallengeAnswerPayload({ chainId, challengeId, address, answer, invitationCode, timestamp }) {
  const payload = {
    purpose: 'FAUCET_CHALLENGE_ANSWER',
    chainId,
    challengeId,
    address,
    answer,
    timestamp,
  }
  if (typeof invitationCode === 'string' && invitationCode.trim()) {
    payload.invitationCode = invitationCode.trim()
  }
  return payload
}

module.exports = { getFaucetChallengeCreatePayload, getFaucetChallengeAnswerPayload }
