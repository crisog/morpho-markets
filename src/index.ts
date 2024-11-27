import { ponder } from "@/generated";
import { and, eq, gt } from "drizzle-orm";
import * as schema from "../ponder.schema";

import { IOracleAbi } from "../abis/IOracle";

ponder.on("Liquidations:block", async ({ event, context }) => {
  const ORACLE_PRICE_SCALE = BigInt(1e36);
  const WAD = BigInt(1e18);
  const WARNING_THRESHOLD = 0.95; // 95% of max LTV
  const HIGH_RISK_THRESHOLD = 0.98; // 98% of max LTV

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

  for (const position of riskPositions) {
    const borrowed =
      (position.borrowShares * position.totalBorrowAssets) /
      position.totalBorrowShares;

    // Collateral value in loan token terms
    const collateralValue =
      (position.collateral * position.price) / ORACLE_PRICE_SCALE;

    const maxBorrow = (collateralValue * position.lltv) / WAD;

    const ltv = (borrowed * WAD) / collateralValue;
    const ltvPercentage = Number(ltv) / 1e16;
    const maxLtvPercentage = Number(position.lltv) / 1e16;

    const isHealthy = maxBorrow >= borrowed;

    console.log("Position details:");
    console.log({
      borrowShares: position.borrowShares.toString(),
      borrowed: borrowed.toString(),
      collateral: position.collateral.toString(),
      collateralValue: collateralValue.toString(),
      currentLTV: `${ltvPercentage.toFixed(2)}%`,
      maxLTV: `${maxLtvPercentage.toFixed(2)}%`,
      isHealthy,
    });

    const ltvRatio = ltvPercentage / maxLtvPercentage;

    if (!isHealthy) {
      const liquidationIncentiveFactor = Math.min(
        1.15, // MAX_LIF
        1 / ((0.3 * maxLtvPercentage) / 100 + 0.7)
      );

      console.log(`🚨 LIQUIDATION ALERT 🚨`);
      console.log({
        marketId: position.marketId,
        borrower: position.borrower,
        currentLTV: `${ltvPercentage.toFixed(2)}%`,
        maxLTV: `${maxLtvPercentage.toFixed(2)}%`,
        borrowed: borrowed.toString(),
        collateral: position.collateral.toString(),
        possibleSeizure: (
          (borrowed * BigInt(Math.floor(liquidationIncentiveFactor * 1e18))) /
          WAD
        ).toString(),
        liquidationIncentive: `${(
          (liquidationIncentiveFactor - 1) *
          100
        ).toFixed(2)}%`,
      });
    } else if (ltvRatio >= HIGH_RISK_THRESHOLD) {
      console.log(`⚠️ HIGH RISK POSITION ⚠️`);
      console.log({
        marketId: position.marketId,
        borrower: position.borrower,
        currentLTV: `${ltvPercentage.toFixed(2)}%`,
        maxLTV: `${maxLtvPercentage.toFixed(2)}%`,
        buffer: `${(maxLtvPercentage - ltvPercentage).toFixed(2)}%`,
        riskLevel: `${(ltvRatio * 100).toFixed(2)}%`,
      });
    } else if (ltvRatio >= WARNING_THRESHOLD) {
      console.log(`📊 RISK WARNING`);
      console.log({
        marketId: position.marketId,
        borrower: position.borrower,
        currentLTV: `${ltvPercentage.toFixed(2)}%`,
        maxLTV: `${maxLtvPercentage.toFixed(2)}%`,
        buffer: `${(maxLtvPercentage - ltvPercentage).toFixed(2)}%`,
      });
    }

    console.log(`Position Health Metrics:`);
    console.log({
      collateralValue: collateralValue.toString(),
      borrowedValue: borrowed.toString(),
      maxBorrowValue: maxBorrow.toString(),
      healthBuffer: (maxBorrow - borrowed).toString(),
      oraclePrice: position.price.toString(),
    });
  }
});

ponder.on("OracleUpdates:block", async ({ event, context }) => {
  const markets = await context.db.sql.select().from(schema.markets);

  for (const market of markets) {
    if (
      market.oracle === "0x3A7bB36Ee3f3eE32A60e9f2b33c1e5f2E83ad766" ||
      market.oracle === "0x94C2DfA8917F1657a55D1d604fd31C930A10Bca3" ||
      market.oracle === "0x0000000000000000000000000000000000000000"
    ) {
      continue;
    }

    let price: bigint;

    try {
      price = await context.client.readContract({
        address: market.oracle as `0x${string}`,
        abi: IOracleAbi,
        functionName: "price",
      });
    } catch (error) {
      console.error(`Failed to fetch price for oracle ${market.oracle}`);
      continue;
    }

    await context.db
      .insert(schema.oraclePrices)
      .values({
        oracleAddress: market.oracle,
        price: price,
        blockNumber: event.block.number,
        timestamp: event.block.timestamp,
      })
      .onConflictDoNothing();
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
