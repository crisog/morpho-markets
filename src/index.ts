import { ponder } from "@/generated";
import { and, eq, gt } from "drizzle-orm";
import * as schema from "../ponder.schema";
import { IOracleAbi } from "../abis/IOracle";
import {
  calculatePositionMetrics,
  logPositionDetails,
  logLiquidationAlert,
  calculateLiquidationIncentive,
  logRiskWarning,
  logHealthMetrics,
  CONSTANTS,
} from "./utils";

ponder.on("Liquidations:block", async ({ event, context }) => {
  console.time("Total block processing time");

  console.time("Database query");
  const riskPositions = await context.db.sql
    .select({
      marketId: schema.positions.marketId,
      borrower: schema.positions.borrower,
      borrowShares: schema.positions.borrowShares,
      collateral: schema.positions.collateral,
      totalBorrowAssets: schema.markets.totalBorrowAssets,
      totalBorrowShares: schema.markets.totalBorrowShares,
      lltv: schema.markets.lltv,
      oracle: schema.markets.oracle,
      price: schema.oraclePrices.price,
    })
    .from(schema.positions)
    .innerJoin(schema.markets, eq(schema.positions.marketId, schema.markets.id))
    .innerJoin(
      schema.oraclePrices,
      and(
        eq(schema.markets.oracle, schema.oraclePrices.oracleAddress),
        eq(schema.oraclePrices.blockNumber, event.block.number)
      )
    )
    .where(
      and(
        gt(schema.positions.borrowShares, 0n),
        gt(schema.positions.collateral, 0n)
      )
    );
  console.timeEnd("Database query");

  const blockInfo = {
    timestamp: event.block.timestamp,
    blockNumber: event.block.number,
  };

  console.time("Position processing");
  console.log(`Processing ${riskPositions.length} positions`);

  console.time("Position iteration");
  for (const position of riskPositions) {
    const metrics = calculatePositionMetrics(position);
    const ltvRatio = metrics.ltvPercentage / metrics.maxLtvPercentage;

    // Only process positions that are near liquidation or liquidatable
    if (ltvRatio >= CONSTANTS.WARNING_THRESHOLD) {
      logPositionDetails(position, metrics, blockInfo);

      if (!metrics.isHealthy) {
        const liquidationIncentiveFactor = calculateLiquidationIncentive(
          metrics.maxLtvPercentage
        );
        logLiquidationAlert(
          position,
          metrics,
          liquidationIncentiveFactor,
          blockInfo
        );
      } else if (ltvRatio >= CONSTANTS.HIGH_RISK_THRESHOLD) {
        logRiskWarning("HIGH", position, metrics, ltvRatio, blockInfo);
      } else {
        logRiskWarning("MEDIUM", position, metrics, ltvRatio, blockInfo);
      }

      logHealthMetrics(metrics, position, blockInfo);
    }
  }
  console.timeEnd("Position iteration");
  console.timeEnd("Position processing");

  console.timeEnd("Total block processing time");
});

const IGNORED_ORACLES = [
  "0x3A7bB36Ee3f3eE32A60e9f2b33c1e5f2E83ad766",
  "0x94C2DfA8917F1657a55D1d604fd31C930A10Bca3",
  "0x0000000000000000000000000000000000000000",
];

ponder.on("OracleUpdates:block", async ({ event, context }) => {
  const markets = await context.db.sql.select().from(schema.markets);

  for (const market of markets) {
    if (IGNORED_ORACLES.includes(market.oracle)) continue;

    try {
      const price = await context.client.readContract({
        address: market.oracle as `0x${string}`,
        abi: IOracleAbi,
        functionName: "price",
      });

      await context.db
        .insert(schema.oraclePrices)
        .values({
          oracleAddress: market.oracle,
          price,
          blockNumber: event.block.number,
          timestamp: event.block.timestamp,
        })
        .onConflictDoNothing();
    } catch (error) {
      console.error(`Failed to fetch price for oracle ${market.oracle}`);
    }
  }
});

ponder.on("Morpho:CreateMarket", async ({ event, context }) => {
  await context.db.insert(schema.markets).values({
    id: event.args.id,
    loanToken: event.args.marketParams.loanToken,
    collateralToken: event.args.marketParams.collateralToken,
    oracle: event.args.marketParams.oracle,
    irm: event.args.marketParams.irm,
    lltv: event.args.marketParams.lltv,
    totalBorrowAssets: 0n,
    totalBorrowShares: 0n,
    lastUpdate: event.block.timestamp,
  });
});

ponder.on("Morpho:SupplyCollateral", async ({ event, context }) => {
  await context.db
    .insert(schema.positions)
    .values({
      marketId: event.args.id,
      borrower: event.args.onBehalf,
      borrowShares: 0n,
      collateral: event.args.assets,
      lastUpdated: event.block.timestamp,
    })
    .onConflictDoUpdate((position) => ({
      collateral: position.collateral + event.args.assets,
      lastUpdated: event.block.timestamp,
    }));
});

ponder.on("Morpho:WithdrawCollateral", async ({ event, context }) => {
  await context.db
    .insert(schema.positions)
    .values({
      marketId: event.args.id,
      borrower: event.args.onBehalf,
      borrowShares: 0n,
      collateral: 0n,
      lastUpdated: event.block.timestamp,
    })
    .onConflictDoUpdate((position) => ({
      collateral: position.collateral - event.args.assets,
      lastUpdated: event.block.timestamp,
    }));
});

ponder.on("Morpho:Borrow", async ({ event, context }) => {
  await context.db
    .insert(schema.positions)
    .values({
      marketId: event.args.id,
      borrower: event.args.onBehalf,
      borrowShares: event.args.shares,
      collateral: 0n,
      lastUpdated: event.block.timestamp,
    })
    .onConflictDoUpdate((position) => ({
      borrowShares: position.borrowShares + event.args.shares,
      lastUpdated: event.block.timestamp,
    }));

  await context.db.insert(schema.marketStates).values({
    marketId: event.args.id,
    totalBorrowAssets: event.args.assets,
    totalBorrowShares: event.args.shares,
    logIndex: event.log.logIndex,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });

  const market = await context.db.find(schema.markets, { id: event.args.id });
  if (market) {
    await context.db.update(schema.markets, { id: event.args.id }).set({
      totalBorrowAssets: market.totalBorrowAssets + event.args.assets,
      totalBorrowShares: market.totalBorrowShares + event.args.shares,
      lastUpdate: event.block.timestamp,
    });
  }
});

ponder.on("Morpho:Repay", async ({ event, context }) => {
  await context.db
    .insert(schema.positions)
    .values({
      marketId: event.args.id,
      borrower: event.args.onBehalf,
      borrowShares: 0n,
      collateral: 0n,
      lastUpdated: event.block.timestamp,
    })
    .onConflictDoUpdate((position) => ({
      borrowShares: position.borrowShares - event.args.shares,
      lastUpdated: event.block.timestamp,
    }));

  await context.db.insert(schema.marketStates).values({
    marketId: event.args.id,
    totalBorrowAssets: -event.args.assets,
    totalBorrowShares: -event.args.shares,
    logIndex: event.log.logIndex,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });

  const market = await context.db.find(schema.markets, { id: event.args.id });
  if (market) {
    await context.db.update(schema.markets, { id: event.args.id }).set({
      totalBorrowAssets: market.totalBorrowAssets - event.args.assets,
      totalBorrowShares: market.totalBorrowShares - event.args.shares,
      lastUpdate: event.block.timestamp,
    });
  }
});

ponder.on("Morpho:AccrueInterest", async ({ event, context }) => {
  await context.db.insert(schema.marketStates).values({
    marketId: event.args.id,
    totalBorrowAssets: event.args.interest,
    totalBorrowShares: 0n,
    logIndex: event.log.logIndex,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });

  const market = await context.db.find(schema.markets, { id: event.args.id });
  if (market) {
    await context.db.update(schema.markets, { id: event.args.id }).set({
      totalBorrowAssets: market.totalBorrowAssets + event.args.interest,
      lastUpdate: event.block.timestamp,
    });
  }
});

ponder.on("Morpho:Liquidate", async ({ event, context }) => {
  await context.db
    .insert(schema.positions)
    .values({
      marketId: event.args.id,
      borrower: event.args.borrower,
      borrowShares: 0n,
      collateral: 0n,
      lastUpdated: event.block.timestamp,
    })
    .onConflictDoUpdate((position) => ({
      borrowShares:
        position.borrowShares -
        event.args.repaidShares -
        event.args.badDebtShares,
      collateral: position.collateral - event.args.seizedAssets,
      lastUpdated: event.block.timestamp,
    }));

  await context.db.insert(schema.marketStates).values({
    marketId: event.args.id,
    totalBorrowAssets: -(event.args.repaidAssets + event.args.badDebtAssets),
    totalBorrowShares: -(event.args.repaidShares + event.args.badDebtShares),
    logIndex: event.log.logIndex,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });

  const market = await context.db.find(schema.markets, { id: event.args.id });
  if (market) {
    await context.db.update(schema.markets, { id: event.args.id }).set({
      totalBorrowAssets:
        market.totalBorrowAssets -
        event.args.repaidAssets -
        event.args.badDebtAssets,
      totalBorrowShares:
        market.totalBorrowShares -
        event.args.repaidShares -
        event.args.badDebtShares,
      lastUpdate: event.block.timestamp,
    });
  }
});
