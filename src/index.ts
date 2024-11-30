import { ponder } from "@/generated";
import * as schema from "../ponder.schema";

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
