// Synced from src/lib/hash.js — update both if protocol changes.
'use strict'

const crypto = require('crypto')
const { canonicalStringify } = require('./canonical')

function sha256Hex(input) {
  return `0x${crypto.createHash('sha256').update(input, 'utf8').digest('hex')}`
}

function sha256CanonicalHex(value) {
  return sha256Hex(canonicalStringify(value))
}

module.exports = { sha256CanonicalHex }
