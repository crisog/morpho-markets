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
  },
  blocks: {
    OracleUpdates: {
      network: "mainnet",
      startBlock: 21281319,
      interval: 1,
    },
    Liquidations: {
      network: "mainnet",
      startBlock: 21281319,
      interval: 1,
    },
  },
});
