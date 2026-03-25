'use strict'

const { ethers }    = require('ethers')
const { spawnSync } = require('child_process')
const dotenv        = require('dotenv')
const fs            = require('fs')
const path          = require('path')
const os            = require('os')

// ── Backend 1: Local private key ──────────────────────────────────────────────
class LocalSigner {
  constructor(privateKey, provider) {
    this._wallet = new ethers.Wallet(privateKey, provider)
  }

  get address() { return this._wallet.address }

  async signDigest(hexDigest) {
    return this._wallet.signMessage(Buffer.from(hexDigest.slice(2), 'hex'))
  }

  async sendTx(to, calldata, value = '0', rpcUrl) {
    let wallet = this._wallet
    if (rpcUrl) {
      const tmpProvider = new ethers.JsonRpcProvider(rpcUrl)
      wallet = this._wallet.connect(tmpProvider)
    }
    const tx = await wallet.sendTransaction({ to, data: calldata, value })
    return tx.hash
  }
}

// ── Backend 2: Keystore file (clawcast-wallet) ─────────────────────────────────
// Reads encrypted keystore JSON + password, decrypts once on first use.
// Password resolution: passwordFile > ~/.agent-wallet/pw.txt
const DEFAULT_PW_FILE = path.join(os.homedir(), '.agent-wallet', 'pw.txt')
let _expectedWallet = null

class KeystoreSigner {
  constructor(keystoreFile, passwordFile, address, provider) {
    this._keystoreFile = keystoreFile
    this._passwordFile = passwordFile
    this._address = address
    this._provider = provider
    this._wallet = null // lazy-decrypted
  }

  get address() { return ethers.getAddress(this._address) }

  async _getWallet(provider) {
    if (!this._wallet) {
      let json
      try {
        json = fs.readFileSync(this._keystoreFile, 'utf8')
      } catch (err) {
        throw new Error(
          `Cannot read keystore file: ${this._keystoreFile}\n` +
          '  DO NOT delete or recreate wallet files.\n' +
          '  Ask the user to check their clawcast-wallet setup.'
        )
      }
      // Resolve password: env > password file > default pw.txt
      const password = this._resolvePassword()
      try {
        this._wallet = await ethers.Wallet.fromEncryptedJson(json, password)
      } catch (err) {
        throw new Error(
          `Keystore decrypt failed: ${err.message}\n` +
          '  DO NOT delete, modify, or recreate wallet files.\n' +
          '  DO NOT run "cast wallet" commands.\n' +
          '  Ask the user to update the clawcast-wallet password file, then retry.'
        )
      }
      if (this._provider) this._wallet = this._wallet.connect(this._provider)
    }
    if (provider && provider !== this._provider) {
      return this._wallet.connect(provider)
    }
    return this._wallet
  }

  _resolvePassword() {
    // 1. Password file from state.env
    if (this._passwordFile) {
      try { return fs.readFileSync(this._passwordFile, 'utf8').trim() } catch {}
    }
    // 2. Default clawcast-wallet pw.txt
    try { return fs.readFileSync(DEFAULT_PW_FILE, 'utf8').trim() } catch {}
    // 3. Nothing found — tell agent to ask user
    throw new Error(
      'No keystore password found.\n' +
      '  Tried: password file, ~/.agent-wallet/pw.txt\n' +
      '  DO NOT delete or recreate wallet files.\n' +
      '  Ask the user to update the clawcast-wallet password file, then retry.'
    )
  }

  async signDigest(hexDigest) {
    const wallet = await this._getWallet()
    return wallet.signMessage(Buffer.from(hexDigest.slice(2), 'hex'))
  }

  async sendTx(to, calldata, value = '0', rpcUrl) {
    let provider = this._provider
    if (rpcUrl) provider = new ethers.JsonRpcProvider(rpcUrl)
    const wallet = await this._getWallet(provider)
    const tx = await wallet.sendTransaction({ to, data: calldata, value })
    return tx.hash
  }
}

// ── Backend 3: External script (generic escape hatch) ─────────────────────────
class ScriptSigner {
  constructor(walletAddress) {
    this._address = walletAddress || null
  }

  get address() {
    const addr = this._address
    if (!addr) throw new Error('BLOCKED: WALLET_ADDRESS required when using ScriptSigner')
    return ethers.getAddress(addr)
  }

  async signDigest(hexDigest) {
    return _spawnSigner({}, 'sign-message', hexDigest)
  }

  async sendTx(to, calldata, value = '0', rpcUrl) {
    const extraEnv = rpcUrl ? { OVERRIDE_RPC_URL: rpcUrl } : {}
    return _spawnSigner(extraEnv, 'send-tx', to, calldata, value)
  }
}

function _spawnSigner(extraEnv, ...extraArgs) {
  const script = process.env.SIGNER_SCRIPT
  const parts  = script.trim().split(/\s+/)
  const cmd    = parts[0]
  const args   = [...parts.slice(1), ...extraArgs]

  const opts = { encoding: 'utf8', timeout: 300_000 }
  if (Object.keys(extraEnv).length > 0) {
    opts.env = { ...process.env, ...extraEnv }
  }
  const result = spawnSync(cmd, args, opts)
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `Signer script failed (exit ${result.status}): ${(result.stderr || '').trim() || 'no error message'}`
    )
  }
  return result.stdout.trim()
}

// ── Parse ~/.agent-wallet/state.env ─────────────────────────────────────────

const AGENT_WALLET_DIR = path.join(os.homedir(), '.agent-wallet')

// Convert MSYS/Git-Bash paths (/c/Users/...) to Windows (C:\Users\...)
function _toNativePath(p) {
  if (!p || process.platform !== 'win32') return p
  const m = p.match(/^\/([a-zA-Z])\/(.*)$/)
  return m ? `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}` : p
}

function _loadAgentWalletState() {
  const stateFile = path.join(AGENT_WALLET_DIR, 'state.env')
  try {
    const content = fs.readFileSync(stateFile, 'utf8')
    const state = dotenv.parse(content)
    // Normalize file paths from Git Bash format
    if (state.KEYSTORE_FILE) state.KEYSTORE_FILE = _toNativePath(state.KEYSTORE_FILE)
    if (state.PASSWORD_FILE) state.PASSWORD_FILE = _toNativePath(state.PASSWORD_FILE)
    if (state.PRIVATE_KEY_FILE) state.PRIVATE_KEY_FILE = _toNativePath(state.PRIVATE_KEY_FILE)
    return state
  } catch {
    return null
  }
}

// ── Auto-detect from env → clawcast-wallet fallback ──────────────────────────
function createSigner(provider) {
  // 1. Explicit private key (highest priority)
  const key = process.env.PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY
  if (key) return _guardExpectedWallet(new LocalSigner(key, provider))

  // 2. Auto-detect clawcast-wallet at ~/.agent-wallet/
  const state = _loadAgentWalletState()
  if (state && state.ADDRESS && state.KEYSTORE_FILE) {
    return _guardExpectedWallet(
      new KeystoreSigner(state.KEYSTORE_FILE, state.PASSWORD_FILE || null, state.ADDRESS, provider)
    )
  }

  throw new Error(
    'No wallet configured.\n' +
    '  Install clawcast-wallet:  /install clawcast-wallet\n' +
    '  Or set PRIVATE_KEY=0x... in the shell environment'
  )
}

function setExpectedWallet(expectedWallet) {
  _expectedWallet = expectedWallet || null
}

// ── EXPECTED_WALLET guard — abort if detected address doesn't match ─────────
function _guardExpectedWallet(signer) {
  const expected = _expectedWallet
  if (!expected) return signer
  const actual = signer.address
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `WALLET MISMATCH: detected ${actual} but expected ${expected}\n` +
      '  The wrong wallet is being used. Check your CLI wallet selection or clawcast-wallet config.'
    )
  }
  return signer
}

module.exports = { createSigner, setExpectedWallet, LocalSigner, KeystoreSigner, ScriptSigner, _loadAgentWalletState, AGENT_WALLET_DIR }
