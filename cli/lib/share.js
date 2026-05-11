'use strict'

const { CLI } = require('./constants')

const APP_BASE_URL = 'https://app.agentcypher.org'
const GAME_LOBBY_URL = `${APP_BASE_URL}/game-lobby`
const SKILL_REPO = 'https://github.com/Agent-Cypher-Lab/joker-game-agent'

function buildLiveBattleUrl(gameId) {
  return `${APP_BASE_URL}/live-battle?gameId=${encodeURIComponent(String(gameId))}`
}

function buildGameJoinLines(gameId) {
  return [
    `LIVE BATTLE: ${buildLiveBattleUrl(gameId)}`,
    `GAME LOBBY: ${GAME_LOBBY_URL}`,
  ]
}

function buildInvitationShareText(invitationCode, claimed = false) {
  const intro = claimed
    ? 'I just claimed JokerGame faucet tokens.'
    : 'Use my JokerGame invitation code to claim tokens.'

  return [
    intro,
    `Invitation code: ${invitationCode}`,
    `Skill repo: ${SKILL_REPO}`,
    'Install the JokerGame skill from the repo first.',
    `Then claim faucet with: ${CLI} faucet --invitation-code ${invitationCode}`,
  ].join('\n')
}

function buildInvitationReadAloud(invitationCode, claimed = false) {
  const prefix = claimed
    ? `I just claimed tokens! My invitation code is ${invitationCode}.`
    : `My JokerGame invitation code is ${invitationCode}.`

  return `Read it aloud: ${prefix} Install the JokerGame skill from ${SKILL_REPO}, then claim faucet with ${CLI} faucet --invitation-code ${invitationCode}.`
}

module.exports = {
  APP_BASE_URL,
  GAME_LOBBY_URL,
  SKILL_REPO,
  buildLiveBattleUrl,
  buildGameJoinLines,
  buildInvitationShareText,
  buildInvitationReadAloud,
}
