'use strict'

const { ethers } = require('ethers')

const GAME_ABI = [
  'function getGameInfo(uint256 gameId) external view returns (bool exists, uint256 status, address dealer, uint8 seatCount, uint256 pot, bytes32 seedHash)',
  'function token() external view returns (address)',
  'function joinGame(uint256 gameId, uint256 agentId) external',
  'function joined(uint256 gameId, address player) external view returns (bool)',
  'event GameCreated(address indexed creator, uint256 indexed gameId, bytes32 seedHash, uint256 entryFee, uint256 swapFee)',
  'event PlayerJoined(uint256 indexed gameId, address indexed player, uint8 seatIndex)',
]

const IDENTITY_ABI = [
  'function getUserAgentId(address user) view returns (uint256)',
  'function register() returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
]

// ── Multi-provider state ────────────────────────────────────────────────────
let _providers = []
let _rpcUrls   = []
let _primaryIdx = 0
let _game, _token, _gameAddr, _tokenAddr, _identityAddr
let _gameStartBlock = 0
let _tokenResolvePromise = null

const MAX_RETRIES  = 5
const TX_TIMEOUT   = 60_000   // 1 minute per attempt
const TX_POLL_MS   = 3_000    // poll every 3s

function init({ rpcUrls, rpcUrl, jokerGameAddress, jokerGameStartBlock, tokenAddress, identityAddress }) {
  _rpcUrls   = rpcUrls || [rpcUrl]
  _providers = _rpcUrls.map(url => new ethers.JsonRpcProvider(url))
  _primaryIdx = 0
  _gameAddr     = jokerGameAddress
  _gameStartBlock = Number.isInteger(jokerGameStartBlock) && jokerGameStartBlock >= 0 ? jokerGameStartBlock : 0
  _tokenAddr    = tokenAddress
  _identityAddr = identityAddress
  _tokenResolvePromise = null
  _rebindContracts(0)
}

function getProvider() {
  return _providers[_primaryIdx]
}

// Rebind read-only contract objects to a specific provider index
function _rebindContracts(idx) {
  _primaryIdx = idx
  _game  = new ethers.Contract(_gameAddr, GAME_ABI,  _providers[idx])
  _token = _tokenAddr ? new ethers.Contract(_tokenAddr, ERC20_ABI, _providers[idx]) : null
}

function _rpcHost(url) {
  try { return new URL(url).hostname } catch { return url }
}

// ── Read-only ──────────────────────────────────────────────────────────────────

async function getGameInfo(gameId) {
  const [exists, status, , seatCount] = await _game.getGameInfo(BigInt(gameId))
  return { exists, status: Number(status), seatCount: Number(seatCount) }
}

async function _resolveTokenAddress() {
  if (_tokenAddr) return _tokenAddr
  if (_tokenResolvePromise) return _tokenResolvePromise

  _tokenResolvePromise = (async () => {
    let lastError = null
    let idx = _primaryIdx

    for (let attempt = 1; attempt <= _providers.length; attempt++) {
      try {
        const game = new ethers.Contract(_gameAddr, GAME_ABI, _providers[idx])
        const tokenAddr = ethers.getAddress(await game.token())
        _tokenAddr = tokenAddr
        if (idx !== _primaryIdx) _rebindContracts(idx)
        _token = new ethers.Contract(_tokenAddr, ERC20_ABI, _providers[_primaryIdx])
        return _tokenAddr
      } catch (err) {
        lastError = err
        idx = (idx + 1) % _providers.length
      }
    }

    if (_tokenAddr) return _tokenAddr
    throw new Error(`Failed to resolve GLD token from JokerGame contract: ${_simplifyEthersError(lastError)}`)
  })()

  try {
    return await _tokenResolvePromise
  } finally {
    _tokenResolvePromise = null
  }
}

async function _getTokenContract() {
  await _resolveTokenAddress()
  if (!_token) {
    _token = new ethers.Contract(_tokenAddr, ERC20_ABI, _providers[_primaryIdx])
  }
  return _token
}

async function getAllowance(ownerAddress) {
  const token = await _getTokenContract()
  return token.allowance(ownerAddress, _gameAddr)
}

async function getTokenBalance(ownerAddress) {
  const token = await _getTokenContract()
  return token.balanceOf(ownerAddress)
}

async function getNativeBalance(address) {
  return _providers[_primaryIdx].getBalance(address)
}

async function isJoined(gameId, address) {
  return _game.joined(BigInt(gameId), address)
}

async function getJoinTxByPlayer(gameId, address) {
  const id = BigInt(gameId)
  let fromBlock = _gameStartBlock
  try {
    const created = await _game.queryFilter(_game.filters.GameCreated(null, id), _gameStartBlock, 'latest')
    if (created.length > 0) {
      fromBlock = created[created.length - 1].blockNumber || _gameStartBlock
    }
  } catch {
    fromBlock = _gameStartBlock
  }

  const events = await _game.queryFilter(_game.filters.PlayerJoined(id, address), fromBlock, 'latest')
  if (!events || events.length === 0) return null
  return events[events.length - 1].transactionHash || null
}

// ── Tx confirmation (polls ALL providers, 60s timeout) ─────────────────────

async function _waitForTx(txHash) {
  const start = Date.now()
  while (Date.now() - start < TX_TIMEOUT) {
    for (const p of _providers) {
      try {
        const receipt = await p.getTransactionReceipt(txHash)
        if (receipt && receipt.blockNumber) {
          if (Number(receipt.status) !== 1) {
            throw new Error(`Transaction reverted: ${txHash}`)
          }
          return receipt
        }
      } catch (e) {
        if (e.message?.includes('reverted')) throw e
      }
    }
    await new Promise(r => setTimeout(r, TX_POLL_MS))
  }
  throw new Error(`TX_TIMEOUT: not confirmed within ${TX_TIMEOUT / 1000}s: ${txHash}`)
}

// ── Send + confirm with auto-retry across RPCs ──────────────────────────────

function _simplifyEthersError(err) {
  const msg = err.message || String(err)
  if (/insufficient funds/i.test(msg)) return `${msg.split('\n')[0]} — wallet needs more GAS`
  if (/gas required exceeds/i.test(msg)) return 'Gas estimation failed — wallet may not have enough GAS'
  if (/nonce.*too (low|high)/i.test(msg)) return 'Nonce conflict — a previous tx may be pending. Wait and retry.'
  if (/replacement.*underpriced/i.test(msg)) return 'Replacement tx underpriced — wait for pending tx to confirm'
  if (msg.length > 200) return msg.slice(0, 200) + '...'
  return msg
}

async function _sendWithRetry(signer, to, calldata, value = '0', label = 'tx') {
  let lastError
  let idx = _primaryIdx
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const rpcUrl = _rpcUrls[idx]
    const host   = _rpcHost(rpcUrl)
    try {
      if (attempt > 1) {
        console.log(`Retry ${attempt}/${MAX_RETRIES} via ${host}`)
      }
      const txHash = await signer.sendTx(to, calldata, value, rpcUrl)
      const receipt = await _waitForTx(txHash)
      if (idx !== _primaryIdx) _rebindContracts(idx)
      return receipt
    } catch (err) {
      lastError = err
      if (err.message?.includes('reverted')) {
        throw new Error(`${label} reverted: ${_simplifyEthersError(err)}`)
      }
      console.log(`${label} attempt ${attempt} failed: ${_simplifyEthersError(err)}`)
      if (attempt < MAX_RETRIES) {
        idx = (idx + 1) % _providers.length
      }
    }
  }
  throw new Error(`${label} failed after ${MAX_RETRIES} attempts: ${_simplifyEthersError(lastError)}`)
}

// ── Write (delegate to signer, with retry) ───────────────────────────────────

async function approve(signer, amount) {
  await _resolveTokenAddress()
  const iface    = new ethers.Interface(ERC20_ABI)
  const calldata = iface.encodeFunctionData('approve', [_gameAddr, amount])
  const receipt = await _sendWithRetry(signer, _tokenAddr, calldata, '0', 'Approve')
  return receipt
}

async function joinGame(signer, gameId, agentId) {
  const iface    = new ethers.Interface(GAME_ABI)
  const calldata = iface.encodeFunctionData('joinGame', [BigInt(gameId), BigInt(agentId)])
  const receipt = await _sendWithRetry(signer, _gameAddr, calldata, '0', 'Join')
  return receipt
}

async function registerIdentity(signer) {
  const iface    = new ethers.Interface(IDENTITY_ABI)
  const calldata = iface.encodeFunctionData('register')
  const receipt = await _sendWithRetry(signer, _identityAddr, calldata, '0', 'Register')

  // Parse Transfer event (mint: from=0x0) to get the new token ID
  const transferTopic = ethers.id('Transfer(address,address,uint256)')
  const transferLog = receipt.logs.find(l => l.topics[0] === transferTopic)
  if (!transferLog) throw new Error('No Transfer event in register tx — registration may have failed')
  const agentId = BigInt(transferLog.topics[3]).toString()
  return agentId
}

// ── Identity registry lookup ────────────────────────────────────────────────

async function lookupAgentId(address) {
  let lastError = null
  let idx = _primaryIdx

  for (let attempt = 1; attempt <= _providers.length; attempt++) {
    try {
      const identity = new ethers.Contract(_identityAddr, IDENTITY_ABI, _providers[idx])
      const agentId = await identity.getUserAgentId(address)
      if (idx !== _primaryIdx) _rebindContracts(idx)
      return agentId === 0n ? null : agentId.toString()
    } catch (err) {
      lastError = err
      idx = (idx + 1) % _providers.length
    }
  }

  throw new Error(`Failed to lookup AGENT_ID: ${_simplifyEthersError(lastError)}`)
}

module.exports = {
  init, getProvider,
  getGameInfo, getAllowance, getTokenBalance, getNativeBalance,
  isJoined, getJoinTxByPlayer,
  approve, joinGame, registerIdentity,
  lookupAgentId,
}
