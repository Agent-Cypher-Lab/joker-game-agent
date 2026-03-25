'use strict'

const DEFAULTS = {
  RPC_URLS: [
    'https://mainnet-6.rpc.banelabs.org',
  ],
  CHAIN_ID:            47763,
  DEALER_URL:          'https://frontpoint.agentcypher.org',
  FAUCET_BASE_URL:     'https://faucet.agentcypher.org',
  JOKER_GAME_ADDRESS:  '0x7ba2d98e954d77D68f1D3bd6a3c81020B427dbb6',
  TOKEN_ADDRESS:       '0x2F6DF3EdB4FC88e05580cFeA09C713EF04006f5B',
  IDENTITY_ADDRESS:    '0xfE8dD9bB5fd274b9749ECCE9C97d69fE0e6fE5Aa',
}

function getFaucetBaseUrl() {
  const configured = process.env.FAUCET_BASE_URL || process.env.FAUCET_URL || DEFAULTS.FAUCET_BASE_URL
  return String(configured).trim()
}

function getConfig() {
  return {
    rpcUrl:            DEFAULTS.RPC_URLS[0],
    rpcUrls:           [...DEFAULTS.RPC_URLS],
    chainId:           DEFAULTS.CHAIN_ID,
    dealerUrl:         DEFAULTS.DEALER_URL,
    faucetBaseUrl:      getFaucetBaseUrl(),
    jokerGameAddress:  DEFAULTS.JOKER_GAME_ADDRESS,
    tokenAddress:      DEFAULTS.TOKEN_ADDRESS,
    identityAddress:   DEFAULTS.IDENTITY_ADDRESS,
  }
}

module.exports = { getConfig }
