import { ponder } from "@/generated";
import * as schema from "../../ponder.schema";
import { eq, graphql } from "@ponder/core";
import { getWhitelistedMarkets } from "./utils";

ponder.use("/", graphql());
ponder.use("/graphql", graphql());

const WAD = 1000000000000000000n; // 1e18
const ORACLE_PRICE_SCALE = 1000000000000000000000000000000000000n; // 1e36

interface LiquidatablePosition {
  borrower: string;
  marketId: string;
  collateral: string;
  borrowShares: string;
  marketPrice: string;
  lltv: string;
  totalBorrowAssets: string;
  totalBorrowShares: string;
  currentLtv: string;
}

ponder.get("/liquidatable", async (c) => {
  const marketIds = await getWhitelistedMarkets();

  if (!marketIds.length) {
    return c.json({
      timestamp: Date.now(),
      positions: [],
    });
  }

  const liquidatablePositions: LiquidatablePosition[] = [];

  for (const marketId of marketIds) {
    const market = await c.db.query.markets.findFirst({
      where: eq(schema.markets.id, marketId),
    });

    if (!market) {
      console.log(`Market ${marketId} not found in database`);
      continue;
    }

    const latestPrice = await c.db.query.oraclePrices.findFirst({
      where: eq(schema.oraclePrices.oracleAddress, market.oracle),
      orderBy: (oraclePrices, { desc }) => [desc(oraclePrices.blockNumber)],
    });

    if (!latestPrice) {
      console.log(`No price found for oracle ${market.oracle}`);
      continue;
    }

    const positions = await c.db.query.positions.findMany({
      where: (positions, { and, gt }) =>
        and(eq(positions.marketId, market.id), gt(positions.borrowShares, 0n)),
    });

    for (const position of positions) {
      const maxBorrow =
        (((position.collateral * latestPrice.price) / ORACLE_PRICE_SCALE) *
          market.lltv) /
        WAD;
      const borrowed =
        (position.borrowShares * market.totalBorrowAssets) /
        market.totalBorrowShares;

      const collateralValueInLoanAssets =
        (position.collateral * latestPrice.price) / ORACLE_PRICE_SCALE;
      const currentLtv = (borrowed * WAD) / collateralValueInLoanAssets;

      if (borrowed > maxBorrow) {
        liquidatablePositions.push({
          borrower: position.borrower,
          marketId: market.id,
          collateral: position.collateral.toString(),
          borrowShares: position.borrowShares.toString(),
          marketPrice: latestPrice.price.toString(),
          lltv: market.lltv.toString(),
          currentLtv: currentLtv.toString(),
          totalBorrowAssets: market.totalBorrowAssets.toString(),
          totalBorrowShares: market.totalBorrowShares.toString(),
        });
      }
    }
  }

  console.log(
    `\nFound ${liquidatablePositions.length} liquidatable positions in total`
  );

  return c.json({
    timestamp: Date.now(),
    positions: liquidatablePositions,
  });
});
