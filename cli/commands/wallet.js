'use strict'

const { ethers }                = require('ethers')
const { getConfig } = require('../lib/config')
const { createSigner }          = require('../lib/signer')
const chain                     = require('../lib/chain')

async function getWalletState() {
  const config  = getConfig()
  chain.init(config)
  const provider = chain.getProvider()
  const signer   = createSigner(provider)
  const address  = signer.address

  const [nativeBal, gldBal, chainAgentId] = await Promise.allSettled([
    chain.getNativeBalance(address),
    chain.getTokenBalance(address),
    chain.lookupAgentId(address),
  ])

  const gasWei = nativeBal.status === 'fulfilled' ? nativeBal.value : null
  const gldWei = gldBal.status === 'fulfilled' ? gldBal.value : null

  let agentId = null
  if (chainAgentId.status === 'fulfilled') {
    agentId = chainAgentId.value || null
  }

  return {
    address,
    gasWei,
    gldWei,
    gas: gasWei != null ? ethers.formatEther(gasWei) : '?',
    gld: gldWei != null ? ethers.formatEther(gldWei) : '?',
    agentId,
    hasGas: gasWei != null && gasWei > 0n,
    hasGld: gldWei != null && gldWei > 0n,
    hasAgentId: Boolean(agentId),
  }
}

// ── wallet info ──────────────────────────────────────────────────────────────

async function walletInfo() {
  const state = await getWalletState()
  const gasZero = state.gasWei != null && state.gasWei === 0n
  const gldZero = state.gldWei != null && state.gldWei === 0n

  console.log(`Wallet=${state.address} GAS=${state.gas} GLD=${state.gld} AgentID=${state.agentId || 'none'}`)

  if (gasZero || gldZero) {
    const missing = [gasZero ? 'GAS' : null, gldZero ? 'GLD' : null].filter(Boolean).join(' and ')
    console.log(`URGENT: ${missing} balance${gasZero && gldZero ? 's are' : ' is'} zero — read out loud: fund this wallet address: ${state.address}`)
  }
}

// ── register ERC-8004 identity ──────────────────────────────────────────────

async function register() {
  const config  = getConfig()
  chain.init(config)
  const provider = chain.getProvider()
  const signer   = createSigner(provider)
  const address  = signer.address

  const existingId = await chain.lookupAgentId(address)
  if (existingId) {
    console.log(`Already registered: AGENT_ID=${existingId}`)
    return existingId
  }

  const gasBal = await chain.getNativeBalance(address)
  if (gasBal < 100_000n * 10_000_000_000n) {
    throw new Error(
      `Not enough GAS. Balance: ${ethers.formatEther(gasBal)} GAS.\n` +
      'Get testnet GAS from the NeoX T4 faucet before registering.'
    )
  }

  let agentId
  try {
    agentId = await chain.registerIdentity(signer)
  } catch (err) {
    const msg = err.message || ''
    if (/insufficient funds|gas required exceeds/i.test(msg)) {
      throw new Error(
        `Transaction failed: not enough GAS.\n` +
        `Wallet: ${address}\n` +
        `GAS balance: ${ethers.formatEther(gasBal)} GAS\n` +
        'Get testnet GAS from the NeoX T4 faucet, then retry.'
      )
    }
    if (/reverted/i.test(msg)) {
      throw new Error(
        `Transaction reverted. Possible causes:\n` +
        '  - Already registered (run "wallet" to check)\n' +
        '  - Contract issue\n' +
        `Original error: ${msg}`
      )
    }
    throw err
  }
  console.log(`Registered AGENT_ID=${agentId}`)

  return agentId
}

module.exports = { walletInfo, register, getWalletState }
