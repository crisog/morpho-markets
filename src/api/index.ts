import { ponder } from "@/generated";
import * as schema from "../../ponder.schema";
import { eq, desc, inArray } from "@ponder/core";
import { MorphoAbi } from "../../abis/Morpho";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { getChainAddresses, SharesMath } from "@morpho-org/blue-sdk";
import { apiSdk } from "@morpho-org/blue-sdk-ethers-liquidation";
import NodeCache from "node-cache";
import { performance } from "perf_hooks";

const ORACLE_PRICE_SCALE = 10n ** 36n;
const WAD = 1_000_000_000_000_000_000n;
const BATCH_SIZE = 300;

type MarketConfig = typeof schema.markets.$inferSelect;

const cache = new NodeCache({
  stdTTL: 300,
  checkperiod: 60,
  useClones: false,
});

const CACHE_KEYS = {
  WHITELISTED_MARKETS: "whitelisted_markets",
  MARKET_CONFIGS: "market_configs",
} as const;

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(process.env.ETH_RPC_URL),
});

async function batchPositionCalls(positions: any[], marketId: string) {
  const batches = [];

  for (let i = 0; i < positions.length; i += BATCH_SIZE) {
    const batchPositions = positions.slice(i, i + BATCH_SIZE);
    const calls = batchPositions.map((position) => ({
      address: process.env.MORPHO_ADDRESS as `0x${string}`,
      abi: MorphoAbi,
      functionName: "position",
      args: [marketId as `0x${string}`, position.borrower as `0x${string}`],
    }));
    batches.push(calls);
  }

  const results = await Promise.all(
    batches.map((batch) => publicClient.multicall({ contracts: batch }))
  );

  return results.flat();
}

async function getWhitelistedMarkets(): Promise<string[]> {
  const cachedMarkets = cache.get<string[]>(CACHE_KEYS.WHITELISTED_MARKETS);
  if (cachedMarkets) {
    return cachedMarkets;
  }

  const {
    markets: { items },
  } = await apiSdk.getWhitelistedMarketIds({
    chainId: 1,
  });

  const marketIds = items?.map(({ uniqueKey }) => uniqueKey) ?? [];
  cache.set(CACHE_KEYS.WHITELISTED_MARKETS, marketIds);

  return marketIds;
}

async function getMarketConfigs(c: any): Promise<Map<string, MarketConfig>> {
  const cachedConfigs = cache.get<Map<string, MarketConfig>>(
    CACHE_KEYS.MARKET_CONFIGS
  );
  if (cachedConfigs) {
    return cachedConfigs;
  }

  const markets = await c.db
    .select()
    .from(schema.markets)
    .where(inArray(schema.markets.id, await getWhitelistedMarkets()));

  const marketConfigMap = new Map<string, MarketConfig>(
    markets.map((market: { id: string }) => [market.id, market])
  );

  cache.set(CACHE_KEYS.MARKET_CONFIGS, marketConfigMap);

  return marketConfigMap;
}

ponder.get("/liquidatable", async (c) => {
  try {
    const liquidatablePositions = [];

    const marketConfigsStart = performance.now();
    const marketConfigs = await getMarketConfigs(c);
    const marketConfigsTime = performance.now() - marketConfigsStart;
    console.debug(
      `Fetching market configs took ${marketConfigsTime.toFixed(2)}ms`
    );

    for (const [marketId, marketConfig] of marketConfigs.entries()) {
      const [latestPrice] = await c.db
        .select()
        .from(schema.oraclePrices)
        .where(eq(schema.oraclePrices.oracleAddress, marketConfig.oracle))
        .orderBy(desc(schema.oraclePrices.blockNumber))
        .limit(1);

      if (!latestPrice) continue;

      const positions = await c.db
        .select()
        .from(schema.positions)
        .where(eq(schema.positions.marketId, marketId));

      // Skip markets with no positions
      if (positions.length === 0) {
        console.debug(`Skipping market ${marketId} - no positions found`);
        continue;
      }

      console.debug(
        `Processing ${positions.length} positions in market ${marketId}`
      );

      const marketStateStart = performance.now();
      const marketStateCall = await publicClient.multicall({
        contracts: [
          {
            address: process.env.MORPHO_ADDRESS as `0x${string}`,
            abi: MorphoAbi,
            functionName: "market",
            args: [marketId as `0x${string}`],
          },
        ],
      });
      const marketStateTime = performance.now() - marketStateStart;
      console.debug(`Market state call took ${marketStateTime.toFixed(2)}ms`);

      if (!marketStateCall[0].result) continue;

      const [, , totalBorrowAssets, totalBorrowShares] =
        marketStateCall[0].result;

      const positionDataStart = performance.now();
      const positionData = await batchPositionCalls(positions, marketId);

      const processStart = performance.now();
      const results = positionData.map((data, index) => {
        if (!data.result) return null;

        const [, borrowSharesStr, collateralStr] = data.result;
        const borrowShares = BigInt(borrowSharesStr || "0");
        const collateral = BigInt(collateralStr || "0");

        if (borrowShares === 0n) return null;

        const borrowedAssets = SharesMath.toAssets(
          borrowShares,
          totalBorrowAssets,
          totalBorrowShares,
          "Up"
        );

        const borrowedAssetsBigInt = BigInt(borrowedAssets.toString());
        const priceBigInt = BigInt(latestPrice.price);

        const ltv =
          (borrowedAssetsBigInt * priceBigInt * WAD) /
          (collateral * ORACLE_PRICE_SCALE);

        if (ltv <= marketConfig.lltv) return null;

        return {
          marketId,
          borrower: positions[index]?.borrower,
          ltv: ltv.toString(),
          maxLtv: marketConfig.lltv.toString(),
          collateral: collateral.toString(),
          borrowShares: borrowShares.toString(),
          borrowedAssets: borrowedAssetsBigInt.toString(),
        };
      });

      const processTime = performance.now() - processStart;
      const positionDataTime = performance.now() - positionDataStart;

      console.debug(
        `Fetching position data took ${positionDataTime.toFixed(2)}ms`
      );
      console.debug(
        `Processing position checks took ${processTime.toFixed(2)}ms`
      );

      liquidatablePositions.push(
        ...results.filter(
          (result): result is NonNullable<typeof result> => result !== null
        )
      );
    }

    return c.json(liquidatablePositions);
  } catch (error) {
    console.error("Error fetching liquidatable positions:", error);
    return c.text(
      `Failed to fetch liquidatable positions: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      500
    );
  }
});

ponder.get("/liq", async (c) => {
  const chainId = 1;
  const { wNative } = getChainAddresses(chainId);
  const marketIds = await getWhitelistedMarkets();

  const {
    assetByAddress: { priceUsd: wethPriceUsd },
    marketPositions: { items: positions },
  } = await apiSdk.getLiquidatablePositions({
    chainId,
    wNative,
    marketIds,
  });

  return c.json(positions);
});
