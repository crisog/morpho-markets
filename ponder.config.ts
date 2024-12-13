import { createConfig } from "@ponder/core";
import { rateLimit } from "@ponder/utils";
import { http } from "viem";

import { MorphoAbi } from "./abis/Morpho";

export default createConfig({
  networks: {
    mainnet: {
      chainId: 1,
      transport: rateLimit(
        http(process.env.ETH_RPC_URL, { retryCount: 1, timeout: 1_000 }),
        {
          requestsPerSecond: 100,
        }
      ),
    },
    base: {
      chainId: 8453,
      transport: rateLimit(
        http(process.env.BASE_RPC_URL, { retryCount: 1, timeout: 1_000 }),
        {
          requestsPerSecond: 100,
        }
      ),
    },
    sepolia: {
      chainId: 11155111,
      transport: rateLimit(
        http(process.env.SEPOLIA_RPC_URL, { retryCount: 1, timeout: 1_000 }),
        {
          requestsPerSecond: 10,
        }
      ),
    },
  },
  contracts: {
    Morpho: {
      network: "mainnet",
      abi: MorphoAbi,
      startBlock: 18883124,
      address: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
    },
    MorphoBase: {
      network: "base",
      abi: MorphoAbi,
      startBlock: 13977148,
      address: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
    },
    MorphoSepolia: {
      network: "sepolia",
      abi: MorphoAbi,
      startBlock: 7265150,
      address: "0xd011EE229E7459ba1ddd22631eF7bF528d424A14",
    },
  },
  blocks: {
    OracleUpdates: {
      network: "mainnet",
      startBlock: 21395378,
      interval: 1,
    },
    MarketStateUpdates: {
      network: "mainnet",
      startBlock: 21395378,
      interval: 1,
    },
    OracleUpdatesBase: {
      network: "base",
      startBlock: 23662642,
      interval: 1,
    },
    MarketStateUpdatesBase: {
      network: "base",
      startBlock: 23662642,
      interval: 1,
    },
    OracleUpdatesSepolia: {
      network: "sepolia",
      startBlock: 7271981,
      interval: 1,
    },
    MarketStateUpdatesSepolia: {
      network: "sepolia",
      startBlock: 7271981,
      interval: 1,
    },
  },
});
