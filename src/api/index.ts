import { ponder } from "@/generated";
import * as schema from "../../ponder.schema";
import { eq, graphql } from "@ponder/core";
import {
  getTokenPrices,
  getWhitelistedMarkets,
  isPositionLiquidatable,
} from "./utils";

ponder.use("/", graphql());
ponder.use("/graphql", graphql());

interface TokenInfo {
  address: string;
  decimals: number;
  symbol: string;
  priceUsd: number;
  spotPriceEth: number | null;
}

interface LiquidatablePosition {
  user: {
    address: string;
  };
  market: {
    oracleAddress: string;
    irmAddress: string;
    lltv: string;
    collateralAsset: TokenInfo;
    loanAsset: TokenInfo;
  };
}

ponder.get("/liquidatable", async (c) => {
  const marketIds = await getWhitelistedMarkets();

  if (!marketIds.length) {
    return c.json({
      timestamp: Date.now(),
      positions: [],
    });
  }

  const markets = [];
  for (const marketId of marketIds) {
    const market = await c.db.query.markets.findFirst({
      where: eq(schema.markets.id, marketId),
    });

    if (market && market.loanToken && market.collateralToken) {
      markets.push(market);
    }
  }

  if (!markets.length) {
    return c.json({
      timestamp: Date.now(),
      positions: [],
    });
  }

  const tokenPrices = await getTokenPrices(
    markets.map((market) => ({
      loanToken: market.loanToken,
      collateralToken: market.collateralToken,
    }))
  );

  const liquidatablePositions: LiquidatablePosition[] = [];

  for (const market of markets) {
    const latestPrice = await c.db.query.oraclePrices.findFirst({
      where: eq(schema.oraclePrices.oracleAddress, market.oracle),
      orderBy: (oraclePrices, { desc }) => [desc(oraclePrices.blockNumber)],
    });

    if (!latestPrice) continue;

    const positions = await c.db.query.positions.findMany({
      where: (positions, { and, gt }) =>
        and(eq(positions.marketId, market.id), gt(positions.borrowShares, 0n)),
    });

    for (const position of positions) {
      const isLiquidatable = await isPositionLiquidatable(
        market,
        position,
        latestPrice.price
      );

      if (isLiquidatable) {
        try {
          const collateralAddress = market.collateralToken.toLowerCase();
          const loanAddress = market.loanToken.toLowerCase();

          const collateralInfo = tokenPrices[collateralAddress];
          const loanInfo = tokenPrices[loanAddress];

          if (!collateralInfo || !loanInfo) {
            console.error(
              `Token price information not found for market ${market.id}`
            );
            continue;
          }

          liquidatablePositions.push({
            user: {
              address: position.borrower,
            },
            market: {
              oracleAddress: market.oracle,
              irmAddress: market.irm,
              lltv: market.lltv.toString(),
              collateralAsset: {
                address: market.collateralToken,
                decimals: collateralInfo.decimals,
                symbol: collateralInfo.symbol,
                priceUsd: collateralInfo.price,
                spotPriceEth: null,
              },
              loanAsset: {
                address: market.loanToken,
                decimals: loanInfo.decimals,
                symbol: loanInfo.symbol,
                priceUsd: loanInfo.price,
                spotPriceEth: null,
              },
            },
          });
        } catch (error) {
          console.error(
            `Error processing position for market ${market.id}:`,
            error
          );
          continue;
        }
      }
    }
  }

  return c.json({
    timestamp: Date.now(),
    positions: liquidatablePositions,
  });
});
