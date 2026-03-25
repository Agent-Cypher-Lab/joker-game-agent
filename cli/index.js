#!/usr/bin/env node
'use strict'

const { Command } = require('commander')
const { getConfig }    = require('./lib/config')
const { createSigner, setExpectedWallet } = require('./lib/signer')
const chain            = require('./lib/chain')
const dealer           = require('./lib/dealer')
const { gameList, gameStatus } = require('./commands/game')
const { join } = require('./commands/join')
const { run, waitForCard, printCheckpoint, printEndedWait, isEndedWaitPhase } = require('./commands/play')
const { walletInfo, register } = require('./commands/wallet')
const { faucetChallenge, faucetAnswer, showInvitationCode } = require('./commands/faucet')
const roundCmds        = require('./commands/round')
const { pollSettlement, printResult } = require('./commands/settlement')
const { describeCard, swapSummary } = require('./lib/card')
const { CLI }          = require('./lib/constants')
const logger           = require('./lib/logger')

const program = new Command()

program
  .name('node skills/joker-game-agent/cli/index.js')
  .description('JokerGame CLI')
  .version('1.0.0')
  .showHelpAfterError(true)
  .option('-w, --wallet <address>', 'Expected wallet address — abort if detected wallet differs')
  .hook('preAction', (thisCmd) => {
    const opts = thisCmd.opts()
    setExpectedWallet(opts.wallet || null)
  })

// ── Helpers ──────────────────────────────────────────────────────────────────

function initReadOnly() {
  const config = getConfig()
  dealer.init(config.dealerUrl)
  return config
}

function initSigner() {
  const config = getConfig()
  chain.init(config)
  dealer.init(config.dealerUrl)
  const signer  = createSigner(chain.getProvider())
  return { config, signer, address: signer.address }
}

async function initSession() {
  const { config, signer, address } = initSigner()
  const agentId = await chain.lookupAgentId(address)
  if (!agentId) throw new Error('No AGENT_ID — run: register')
  return { config, signer, address, agentId }
}

// ── Ensure log is flushed on exit ─────────────────────────────────────────────
process.on('exit', () => logger.close())

// ── Shared: finalize seat → poll settlement → print result ───────────────────
async function _finalizeAndWaitSettlement(gameId, roundNum, signer, address) {
  await roundCmds.finalize(gameId, roundNum, { signer, address })
  let seatId = null
  try {
    const entry = await dealer.recoverEntry(gameId, address)
    if (entry?.seatId != null) seatId = entry.seatId
  } catch { /* best-effort */ }
  const settleResult = await pollSettlement(gameId)
  if (settleResult.ready) {
    printResult(settleResult.data, seatId)
  }
}

// ── wallet / register ────────────────────────────────────────────────────────
program
  .command('wallet')
  .description('Show wallet address, balances, and AGENT_ID')
  .action(async () => {
    try { await walletInfo() } catch (err) { die(err) }
  })

program
  .command('register')
  .description('Register ERC-8004 on-chain identity')
  .action(async () => {
    try { await register() } catch (err) { die(err) }
  })

// ── game list / status / snapshot ────────────────────────────────────────────
const gameCmd = program.command('game').description('Game info commands')

gameCmd
  .command('list')
  .description('List joinable games')
  .action(async () => {
    try {
      initReadOnly()
      await gameList()
    } catch (err) { die(err) }
  })

gameCmd
  .command('status <gameId>')
  .description('Show game phase and seat counts')
  .action(async (gameId) => {
    try {
      logger.init(gameId)
      initReadOnly()
      await gameStatus(gameId)
    } catch (err) { die(err) }
  })

gameCmd
  .command('snapshot <gameId>')
  .description('Quick game state check with next-action')
  .action(async (gameId) => {
    try {
      logger.init(gameId)
      const { address } = initSigner()

      const [pub, snap, entry, settle] = await Promise.allSettled([
        dealer.getPublicInfo(gameId),
        dealer.getPublicSnapshot(gameId, 1),
        dealer.recoverEntry(gameId, address),
        dealer.getSettlement(gameId),
      ])

      const pubData    = pub.status    === 'fulfilled' ? pub.value    : null
      const snapData   = snap.status   === 'fulfilled' ? snap.value   : null
      const entryData  = entry.status  === 'fulfilled' ? entry.value  : null
      const settleData = settle.status === 'fulfilled' ? settle.value : null

      const gamePhase = pubData?.status ?? snapData?.game?.status ?? 'UNKNOWN'
      const maxSeats  = pubData?.maxSeats ?? '?'
      const joined    = pubData?.joinedSeats ?? snapData?.seatStates?.length ?? '?'

      const seatStates = snapData?.seatStates ?? []
      const mySeat = seatStates.find(
        s => (s.address ?? '').toLowerCase() === address.toLowerCase()
      )
      const seatId = entryData?.seatId ?? mySeat?.seatId ?? null
      const roundStarted = snapData?.round?.roundStartMs != null
      const cardDealt = mySeat && Boolean(mySeat.initialCardCiphertextHash)
      const finalized = mySeat?.finalized ?? false
      const settled = settleData && settleData.finalizeConfirmed === true
      const endedWhileWaiting = isEndedWaitPhase(gamePhase) && !cardDealt && !finalized && !settled

      let next
      if (settled) {
        next = null
      } else if (endedWhileWaiting) {
        next = `${CLI} join`
      } else if (finalized) {
        next = `${CLI} settlement ${gameId}`
      } else if (cardDealt && roundStarted) {
        next = `${CLI} read-card ${gameId} 1`
      } else if (seatId == null) {
        next = `${CLI} join ${gameId}`
      } else {
        next = `${CLI} wait ${gameId}`
      }

      console.log(`SNAPSHOT game=${gameId} phase=${gamePhase} seats=${joined}/${maxSeats} mySeat=${seatId ?? 'NONE'} round=${roundStarted ? 'Y' : 'N'} card=${cardDealt ? 'Y' : 'N'} final=${finalized ? 'Y' : 'N'} settled=${settled ? 'Y' : 'N'}${next ? ' NEXT: ' + next : ''}`)

      if (settled) printResult(settleData, seatId ?? null)
    } catch (err) { die(err) }
  })

// ── challenge-answer ────────────────────────────────────────────────────────
program
  .command('challenge-answer <gameId> <challengeId> <answer...>')
  .description('Submit challenge answer, then auto-join until card is shown')
  .action(async (gameId, challengeId, answerParts) => {
    try {
      logger.init(gameId)
      const { address, agentId } = await initSession()
      const answer = answerParts.join(' ')
      const result = await dealer.answerChallenge(gameId, challengeId, {
        address, agentId: String(agentId), answer: answer.trim()
      })
      await run(gameId, { joinKey: result.joinKey })
    } catch (err) { die(err) }
  })

// ── join (auto-challenge → agent solves → challenge-answer → full game) ─────
program
  .command('join [gameId]')
  .description('Challenge → solve → join → wait until card is shown')
  .action(async (gameId) => {
    try {
      if (gameId) logger.init(gameId)
      const result = await run(gameId)
      if (result?.gameId && !logger.current()) logger.init(result.gameId)
    } catch (err) { die(err) }
  })

// ── wait (poll until card dealt) ────────────────────────────────────────────
program
  .command('wait <gameId>')
  .description('Poll until round starts and card is dealt, or redirect when the game already ended')
  .action(async (gameId) => {
    try {
      logger.init(gameId)
      const { address } = initSigner()
      const waitResult = await waitForCard(gameId, address)
      if (waitResult.terminal) {
        printEndedWait(gameId, waitResult.terminal)
      } else if (waitResult.checkpoint) {
        printCheckpoint(gameId, waitResult.snap, waitResult.mySeat)
      } else {
        console.log(`NEXT: ${CLI} read-card ${gameId} 1`)
      }
    } catch (err) { die(err) }
  })

// ── read-card ───────────────────────────────────────────────────────────────
program
  .command('read-card <gameId> <round>')
  .description('Read your card for a round')
  .action(async (gameId, roundStr) => {
    try {
      logger.init(gameId)
      const { signer, address } = initSigner()
      const result = await roundCmds.readCard(gameId, Number(roundStr), { signer, address })
      if (result.card) {
        console.log(`CARD: ${describeCard(result.card)}`)
        console.log(`KEEP -> ${CLI} finalize ${gameId} ${roundStr}`)
        console.log(`SWAP -> ${CLI} swap ${gameId} ${roundStr}`)
      } else {
        console.log('CARD: not available yet')
      }
    } catch (err) { die(err) }
  })

// ── swap → finalize → settle ────────────────────────────────────────────────
program
  .command('swap <gameId> <round>')
  .description('Swap card → finalize → settlement')
  .action(async (gameId, roundStr) => {
    try {
      logger.init(gameId)
      const { signer, address } = initSigner()
      const rn = Number(roundStr)
      let oldCard = null
      try {
        const before = await roundCmds.readCard(gameId, rn, { signer, address })
        oldCard = before.card
      } catch { /* best-effort */ }

      const result = await roundCmds.swap(gameId, rn, { signer, address })
      const swapStatus = result.swapResult?.result
      if (swapStatus === 'APPROVED') {
        const after = await roundCmds.readCard(gameId, rn, { signer, address })
        const summary = oldCard ? ' ' + swapSummary(oldCard, after.card) : ''
        console.log(`SWAPPED: ${describeCard(after.card)}${summary}`)
      } else {
        console.log(`Swap REJECTED (${result.swapResult?.denyReason || swapStatus || 'unknown'})`)
      }

      await _finalizeAndWaitSettlement(gameId, rn, signer, address)
    } catch (err) { die(err) }
  })

// ── finalize ────────────────────────────────────────────────────────────────
program
  .command('finalize <gameId> <round>')
  .description('Finalize seat → settlement')
  .action(async (gameId, roundStr) => {
    try {
      logger.init(gameId)
      const { signer, address } = initSigner()
      await _finalizeAndWaitSettlement(gameId, Number(roundStr), signer, address)
    } catch (err) { die(err) }
  })

// ── settlement ──────────────────────────────────────────────────────────────
program
  .command('settlement <gameId>')
  .description('Poll and display settlement result')
  .action(async (gameId) => {
    try {
      logger.init(gameId)
      const { signer } = initSigner()
      let seatId = null
      try {
        const entry = await dealer.recoverEntry(gameId, signer.address)
        if (entry?.seatId != null) seatId = entry.seatId
      } catch { /* best-effort */ }
      const settleResult = await pollSettlement(gameId)
      if (settleResult.ready) {
        printResult(settleResult.data, seatId)
      }
    } catch (err) { die(err) }
  })

// ── history / summary ───────────────────────────────────────────────────────
program
  .command('history')
  .description('Match history')
  .action(async () => {
    try {
      const { signer } = initSigner()
      const data = await dealer.getMatchHistory(signer.address)
      const matches = data.matches || data.items || data || []
      if (!Array.isArray(matches) || matches.length === 0) {
        console.log('No match history.')
        return
      }
      for (const m of matches) {
        console.log(`${m.gameId} rank=${m.rank ?? '?'}${m.swapped ? ' swapped' : ''} status=${m.status ?? '?'}`)
      }
    } catch (err) { die(err) }
  })

program
  .command('summary')
  .description('Lifetime stats')
  .action(async () => {
    try {
      const { signer } = initSigner()
      console.log(JSON.stringify(await dealer.getUserSummary(signer.address)))
    } catch (err) { die(err) }
  })

// ── faucet (claim GAS + GLD) ─────────────────────────────────────────────────
program
  .command('faucet')
  .description('Request faucet challenge to claim GAS + GLD')
  .option('-c, --invitation-code <code>', 'Invitation code from another player')
  .action(async (opts) => {
    try {
      await faucetChallenge({ invitationCode: opts.invitationCode })
    } catch (err) { die(err) }
  })

program
  .command('faucet-answer <challengeId> <answer...>')
  .description('Submit faucet answer and wait for final funding result (put -c BEFORE answer if needed)')
  .option('-c, --invitation-code <code>', 'Invitation code from another player')
  .action(async (challengeId, answerParts, opts) => {
    try {
      const answer = answerParts.join(' ')
      await faucetAnswer(challengeId, answer.trim(), { invitationCode: opts.invitationCode })
    } catch (err) { die(err) }
  })

program
  .command('invitation-code')
  .alias('invite-code')
  .description('Show your faucet invitation code and shareable invite copy')
  .action(async () => {
    try {
      await showInvitationCode()
    } catch (err) { die(err) }
  })

// ── Error handler ───────────────────────────────────────────────────────────
let _exiting = false
function die(err) {
  if (_exiting) return
  _exiting = true
  console.error(err.message || String(err))
  process.exit(1)
}

program.parseAsync(process.argv).catch(die)
