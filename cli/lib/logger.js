'use strict'

const fs   = require('fs')
const path = require('path')

const LOGS_DIR = path.resolve(__dirname, '..', 'logs')

let _stream  = null
let _gameId  = null
let _origLog = null
let _origErr = null
let _origWrite = null
let _origErrWrite = null
let _fromConsole = false  // suppress stdout/stderr patch when console patch is active

function _ts() {
  return new Date().toISOString()
}

function _writeLine(line) {
  if (_stream) _stream.write(line + '\n')
}

/**
 * Start logging to logs/{gameId}.log.
 * Safe to call multiple times — re-initializes if gameId changes.
 */
function init(gameId) {
  if (!gameId) return
  if (_gameId === String(gameId)) return // already logging this game

  // Close previous stream if switching games
  close()

  _gameId = String(gameId)
  fs.mkdirSync(LOGS_DIR, { recursive: true })

  const logPath = path.join(LOGS_DIR, `${_gameId}.log`)
  _stream = fs.createWriteStream(logPath, { flags: 'a' })
  _writeLine(`\n--- session started ${_ts()} ---`)

  // Patch console.log
  _origLog = console.log
  console.log = (...args) => {
    _fromConsole = true
    _origLog.apply(console, args)
    _fromConsole = false
    const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
    _writeLine(`${_ts()} [LOG] ${msg}`)
  }

  // Patch console.error
  _origErr = console.error
  console.error = (...args) => {
    _fromConsole = true
    _origErr.apply(console, args)
    _fromConsole = false
    const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
    _writeLine(`${_ts()} [ERR] ${msg}`)
  }

  // Patch process.stdout.write (for progress dots, etc.)
  // Only log here for raw writes (not from console.log which is handled above)
  _origWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk, encoding, cb) => {
    _origWrite(chunk, encoding, cb)
    if (_fromConsole) return true  // already logged by console.log patch
    const str = typeof chunk === 'string' ? chunk : chunk.toString()
    if (str.length > 0) {
      if (str.length <= 2 && !str.includes('\n')) {
        // Progress dots/chars — append inline
        if (_stream) _stream.write(str)
      } else {
        _writeLine(`${_ts()} [OUT] ${str.replace(/\n$/, '')}`)
      }
    }
    return true
  }

  // Patch process.stderr.write
  _origErrWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = (chunk, encoding, cb) => {
    _origErrWrite(chunk, encoding, cb)
    if (_fromConsole) return true  // already logged by console.error patch
    const str = typeof chunk === 'string' ? chunk : chunk.toString()
    if (str.length > 0) {
      _writeLine(`${_ts()} [STDERR] ${str.replace(/\n$/, '')}`)
    }
    return true
  }
}

/**
 * Close the log stream and restore console/process patches.
 */
function close() {
  if (_stream) {
    _writeLine(`--- session ended ${_ts()} ---`)
    _stream.end()
    _stream = null
  }
  if (_origLog)      { console.log = _origLog; _origLog = null }
  if (_origErr)      { console.error = _origErr; _origErr = null }
  if (_origWrite)    { process.stdout.write = _origWrite; _origWrite = null }
  if (_origErrWrite) { process.stderr.write = _origErrWrite; _origErrWrite = null }
  _gameId = null
}

/**
 * Return current gameId being logged (or null).
 */
function current() {
  return _gameId
}

module.exports = { init, close, current }
