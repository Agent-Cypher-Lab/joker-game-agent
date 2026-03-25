'use strict'

const dealer = require('../lib/dealer')

async function gameList() {
  const statuses = ['BOOTSTRAPPED']
  const items = []
  for (const status of statuses) {
    try {
      const data = await dealer.listGames(status)
      const list = data.items || []
      items.push(...list.map(g => ({ ...g, status })))
    } catch { /* skip if status query fails */ }
  }

  if (items.length === 0) {
    console.log('No joinable games.')
    return
  }
  for (const g of items) {
    console.log(`${g.gameId} status=${g.status}`)
  }
}

async function gameStatus(gameId) {
  const [pub, cfg] = await Promise.allSettled([
    dealer.getPublicInfo(gameId),
    dealer.getConfig(gameId),
  ])

  const pubData = pub.status === 'fulfilled' ? pub.value  : null
  const cfgData = cfg.status === 'fulfilled' ? cfg.value  : null

  if (!pubData && !cfgData) {
    console.error(`Game ${gameId} not found.`)
    process.exit(1)
  }

  const status = pubData?.status ?? '?'
  const seats  = pubData ? `${pubData.joinedSeats}/${pubData.maxSeats}` : '?'
  const round  = pubData?.round != null ? ` round=${pubData.round}` : ''
  const fee    = cfgData?.immutableConfig?.feeAmount ?? '?'
  console.log(`Game ${gameId} status=${status} seats=${seats}${round} fee=${fee}`)
}

module.exports = { gameList, gameStatus }
