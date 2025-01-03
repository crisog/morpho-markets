export const WAD = 1000000000000000000n; // 1e18
export const ORACLE_PRICE_SCALE = 1000000000000000000000000000000000000n; // 1e36

export const IGNORED_ORACLES = [
  "0x3A7bB36Ee3f3eE32A60e9f2b33c1e5f2E83ad766",
  "0x94C2DfA8917F1657a55D1d604fd31C930A10Bca3",
  "0x0000000000000000000000000000000000000000",
];

export const IGNORED_TOKENS = [
  "0x0000000000000000000000000000000000000000",
  "0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2", // Not found on Coingecko
  "0x1d08e7adc263cfc70b1babe6dc5bb339c16eec52", // Not found on Coingecko
];

export const CONFIG = {
  TOKEN_PRICE_URL: "https://api.coingecko.com/api/v3/coins/ethereum/contract",
  CHAIN_ID: 1,
  ORACLE_PRICE_SCALE: BigInt(1e36),
  DEFAULT_DECIMALS: 18,
} as const;

export const CHAIN_TOKENS = {
  1: {
    WETH: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  },
  11155111: {
    WETH: "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9",
  },
  8453: {
    WETH: "0x4200000000000000000000000000000000000006",
  },
} as const;

export const MORPHO_CONTRACT_ADDRESSES = {
  1: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb", // mainnet
  11155111: "0xd011EE229E7459ba1ddd22631eF7bF528d424A14", // sepolia
  8453: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb", // base
};
