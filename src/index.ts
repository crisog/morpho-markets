import { ponder } from "@/generated";
import * as schema from "../ponder.schema";

// Morpho (ETH Mainnet)
ponder.on("Morpho:CreateMarket", async ({ event, context }) => {
  const { db } = context;

  await db.insert(schema.markets).values({
    id: event.args.id,
    loanToken: event.args.marketParams.loanToken,
    collateralToken: event.args.marketParams.collateralToken,
    oracle: event.args.marketParams.oracle,
    irm: event.args.marketParams.irm,
    lltv: event.args.marketParams.lltv,
    totalBorrowAssets: 0n,
    totalBorrowShares: 0n,
    totalSupplyAssets: 0n,
    totalSupplyShares: 0n,
    lastUpdate: event.block.timestamp,
  });
});

ponder.on("Morpho:SupplyCollateral", async ({ event, context }) => {
  const { db } = context;

  const market = await db.find(schema.markets, { id: event.args.id });
  if (!market) {
    throw new Error(
      `Market ${event.args.id} not found during collateral supply`
    );
  }

  const existingPosition = await db.sql.query.positions.findFirst({
    where: (positions, { eq, and }) =>
      and(
        eq(positions.marketId, event.args.id),
        eq(positions.borrower, event.args.onBehalf)
      ),
    with: {
      market: true,
    },
  });

  await db
    .insert(schema.positions)
    .values({
      marketId: event.args.id,
      borrower: event.args.onBehalf,
      borrowShares: existingPosition?.borrowShares ?? 0n,
      collateral: event.args.assets,
      lastUpdated: event.block.timestamp,
    })
    .onConflictDoUpdate((position) => ({
      collateral: position.collateral + event.args.assets,
      lastUpdated: event.block.timestamp,
    }));

  await db.insert(schema.marketStates).values({
    marketId: event.args.id,
    totalBorrowAssets: 0n,
    totalBorrowShares: 0n,
    totalSupplyAssets: 0n,
    totalSupplyShares: 0n,
    collateralChange: event.args.assets,
    logIndex: event.log.logIndex,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });
});

ponder.on("Morpho:WithdrawCollateral", async ({ event, context }) => {
  const { db } = context;

  const existingPosition = await db.sql.query.positions.findFirst({
    where: (positions, { eq, and }) =>
      and(
        eq(positions.marketId, event.args.id),
        eq(positions.borrower, event.args.onBehalf)
      ),
  });

  await db
    .insert(schema.positions)
    .values({
      marketId: event.args.id,
      borrower: event.args.onBehalf,
      borrowShares: existingPosition?.borrowShares ?? 0n,
      collateral: existingPosition?.collateral ?? 0n,
      lastUpdated: event.block.timestamp,
    })
    .onConflictDoUpdate((position) => ({
      collateral: position.collateral - event.args.assets,
      lastUpdated: event.block.timestamp,
    }));

  await db.insert(schema.marketStates).values({
    marketId: event.args.id,
    totalSupplyAssets: 0n,
    totalSupplyShares: 0n,
    totalBorrowAssets: 0n,
    totalBorrowShares: 0n,
    collateralChange: -event.args.assets,
    logIndex: event.log.logIndex,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });
});

ponder.on("Morpho:Supply", async ({ event, context }) => {
  const { db } = context;

  const market = await db.find(schema.markets, { id: event.args.id });
  if (!market) {
    throw new Error(`Market ${event.args.id} not found during supply`);
  }

  await db.insert(schema.marketStates).values({
    marketId: event.args.id,
    totalSupplyAssets: event.args.assets,
    totalSupplyShares: event.args.shares,
    totalBorrowAssets: 0n,
    totalBorrowShares: 0n,
    collateralChange: 0n,
    logIndex: event.log.logIndex,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });

  await db.update(schema.markets, { id: event.args.id }).set({
    totalSupplyAssets: market.totalSupplyAssets + event.args.assets,
    totalSupplyShares: market.totalSupplyShares + event.args.shares,
    lastUpdate: event.block.timestamp,
  });
});

ponder.on("Morpho:Borrow", async ({ event, context }) => {
  const { db } = context;

  const market = await db.find(schema.markets, { id: event.args.id });
  if (!market) {
    throw new Error(`Market ${event.args.id} not found during borrow`);
  }

  const existingPosition = await db.sql.query.positions.findFirst({
    where: (positions, { eq, and }) =>
      and(
        eq(positions.marketId, event.args.id),
        eq(positions.borrower, event.args.onBehalf)
      ),
  });

  await db
    .insert(schema.positions)
    .values({
      marketId: event.args.id,
      borrower: event.args.onBehalf,
      borrowShares: event.args.shares,
      collateral: existingPosition?.collateral ?? 0n,
      lastUpdated: event.block.timestamp,
    })
    .onConflictDoUpdate((position) => ({
      borrowShares: position.borrowShares + event.args.shares,
      lastUpdated: event.block.timestamp,
    }));

  await db.insert(schema.marketStates).values({
    marketId: event.args.id,
    totalBorrowAssets: event.args.assets,
    totalBorrowShares: event.args.shares,
    totalSupplyAssets: 0n,
    totalSupplyShares: 0n,
    collateralChange: 0n,
    logIndex: event.log.logIndex,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });

  await db.update(schema.markets, { id: event.args.id }).set({
    totalBorrowAssets: market.totalBorrowAssets + event.args.assets,
    totalBorrowShares: market.totalBorrowShares + event.args.shares,
    lastUpdate: event.block.timestamp,
  });
});

ponder.on("Morpho:Repay", async ({ event, context }) => {
  const { db } = context;

  const market = await db.find(schema.markets, { id: event.args.id });
  if (!market) {
    throw new Error(`Market ${event.args.id} not found during repay`);
  }

  const existingPosition = await db.sql.query.positions.findFirst({
    where: (positions, { eq, and }) =>
      and(
        eq(positions.marketId, event.args.id),
        eq(positions.borrower, event.args.onBehalf)
      ),
  });

  await db
    .insert(schema.positions)
    .values({
      marketId: event.args.id,
      borrower: event.args.onBehalf,
      borrowShares: existingPosition?.borrowShares ?? 0n,
      collateral: existingPosition?.collateral ?? 0n,
      lastUpdated: event.block.timestamp,
    })
    .onConflictDoUpdate((position) => ({
      borrowShares: position.borrowShares - event.args.shares,
      lastUpdated: event.block.timestamp,
    }));

  await db.insert(schema.marketStates).values({
    marketId: event.args.id,
    totalBorrowAssets: -event.args.assets,
    totalBorrowShares: -event.args.shares,
    totalSupplyAssets: 0n,
    totalSupplyShares: 0n,
    collateralChange: 0n,
    logIndex: event.log.logIndex,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });

  await db.update(schema.markets, { id: event.args.id }).set({
    totalBorrowAssets: market.totalBorrowAssets - event.args.assets,
    totalBorrowShares: market.totalBorrowShares - event.args.shares,
    lastUpdate: event.block.timestamp,
  });
});

ponder.on("Morpho:AccrueInterest", async ({ event, context }) => {
  const { db } = context;

  const market = await db.find(schema.markets, { id: event.args.id });
  if (!market) {
    throw new Error(
      `Market ${event.args.id} not found during accruing interest`
    );
  }

  await db.insert(schema.marketStates).values({
    marketId: event.args.id,
    totalSupplyAssets: event.args.interest,
    totalSupplyShares: event.args.feeShares,
    totalBorrowAssets: event.args.interest,
    totalBorrowShares: 0n,
    collateralChange: 0n,
    logIndex: event.log.logIndex,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });

  const updatedTotalBorrowAssets =
    market.totalBorrowAssets + event.args.interest;
  const updatedTotalSupplyAssets =
    market.totalSupplyAssets + event.args.interest;
  const updatedTotalSupplyShares =
    market.totalSupplyShares + event.args.feeShares;

  await db.update(schema.markets, { id: event.args.id }).set({
    totalBorrowAssets: updatedTotalBorrowAssets,
    totalSupplyAssets: updatedTotalSupplyAssets,
    totalSupplyShares: updatedTotalSupplyShares,
    lastUpdate: event.block.timestamp,
  });

  if (event.args.feeShares > 0n) {
    await db.insert(schema.feeCollections).values({
      marketId: event.args.id,
      feeShares: event.args.feeShares,
      totalSupplyAssets: updatedTotalSupplyAssets,
      totalSupplyShares: updatedTotalSupplyShares,
      timestamp: event.block.timestamp,
      blockNumber: event.block.number,
      logIndex: event.log.logIndex,
    });
  }
});

ponder.on("Morpho:Liquidate", async ({ event, context }) => {
  const { db } = context;

  const market = await db.find(schema.markets, { id: event.args.id });
  if (!market) {
    throw new Error(`Market ${event.args.id} not found during liquidation`);
  }

  const position = await db.sql.query.positions.findFirst({
    where: (positions, { eq, and }) =>
      and(
        eq(positions.marketId, event.args.id),
        eq(positions.borrower, event.args.borrower)
      ),
  });

  if (!position) {
    throw new Error(
      `Position not found for borrower ${event.args.borrower} in market ${event.args.id}`
    );
  }

  await db
    .insert(schema.positions)
    .values({
      marketId: event.args.id,
      borrower: event.args.borrower,
      borrowShares: position?.borrowShares ?? 0n,
      collateral: position?.collateral ?? 0n,
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

  await db.insert(schema.marketStates).values({
    marketId: event.args.id,
    totalBorrowAssets: -(event.args.repaidAssets + event.args.badDebtAssets),
    totalBorrowShares: -(event.args.repaidShares + event.args.badDebtShares),
    totalSupplyAssets: -event.args.badDebtAssets,
    totalSupplyShares: 0n,
    collateralChange: -event.args.seizedAssets,
    logIndex: event.log.logIndex,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  });

  await db.update(schema.markets, { id: event.args.id }).set({
    totalBorrowAssets:
      market.totalBorrowAssets -
      event.args.repaidAssets -
      event.args.badDebtAssets,
    totalBorrowShares:
      market.totalBorrowShares -
      event.args.repaidShares -
      event.args.badDebtShares,
    totalSupplyAssets: market.totalSupplyAssets - event.args.badDebtAssets,
    lastUpdate: event.block.timestamp,
  });
});
