'use strict'

function isAlreadyJoinedError(message) {
  const normalized = String(message || '').toLowerCase()
  return normalized.includes('already joined')
    || normalized.includes('address already joined')
    || normalized.includes('on-chain seat already joined')
    || normalized.includes('execution reverted: joined')
    || normalized.includes('reverted: joined')
    || normalized.includes('playeralreadyjoined')
}

module.exports = { isAlreadyJoinedError }
