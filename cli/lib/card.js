'use strict'

// Minimal card formatting for JokerGame CLI
// Deck: 19 cards — values 1–20

const SORTED_DECK = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20]

function describeCard(card) {
  if (!card) return '?'
  const v = card.value ?? card.baseValue ?? 0
  return `NUM(${v})`
}

function swapSummary(oldCard, newCard) {
  if (!oldCard || !newCard) return ''
  const ov = oldCard.value ?? oldCard.baseValue ?? 0
  const nv = newCard.value ?? newCard.baseValue ?? 0
  return `${ov}->${nv}`
}

module.exports = { SORTED_DECK, describeCard, swapSummary }
