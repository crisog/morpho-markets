import { createConfig } from "@ponder/core";
import { http } from "viem";

import { MorphoAbi } from "./abis/Morpho";

export default createConfig({
  networks: {
    mainnet: {
      chainId: 1,
      transport: http(process.env.ETH_RPC_URL),
    },
  },
  contracts: {
    Morpho: {
      network: "mainnet",
      abi: MorphoAbi,
      address: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
      startBlock: 18883124,
      filter: {
        event: "CreateMarket",
      },
    },
  },
});
