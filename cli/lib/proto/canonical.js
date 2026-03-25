// Synced from src/lib/canonical.js — update both if protocol changes.
'use strict'

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sortRecursively(value) {
  if (Array.isArray(value)) {
    return value.map(sortRecursively)
  }
  if (!isPlainObject(value)) {
    return value
  }

  const out = {}
  for (const key of Object.keys(value).sort()) {
    out[key] = sortRecursively(value[key])
  }
  return out
}

function canonicalStringify(value) {
  return JSON.stringify(sortRecursively(value))
}

module.exports = { canonicalStringify }
