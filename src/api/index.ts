import { ponder } from "@/generated";
import * as schema from "../../ponder.schema";
import { apiSdk } from "@morpho-org/blue-sdk-ethers-liquidation";
import { eq, graphql } from "@ponder/core";
import NodeCache from "node-cache";

const cache = new NodeCache({
  stdTTL: 300,
  checkperiod: 60,
  useClones: false,
});

const CHAIN_ID = 1; // Ethereum Mainnet

ponder.use("/", graphql());
ponder.use("/graphql", graphql());

async function getWhitelistedMarkets(): Promise<string[]> {
  const CACHE_KEY = "whitelisted_markets";
  const cachedMarkets = cache.get<string[]>(CACHE_KEY);
  if (cachedMarkets) {
    return cachedMarkets;
  }

  const {
    markets: { items },
  } = await apiSdk.getWhitelistedMarketIds({
    chainId: CHAIN_ID,
  });

  const marketIds = items?.map(({ uniqueKey }) => uniqueKey) ?? [];
  cache.set(CACHE_KEY, marketIds);

  return marketIds;
}

ponder.get("/liquidatable", async (c) => {
  const marketIds = await getWhitelistedMarkets();

  return c.json(marketIds);
});
