import { ponder } from "@/generated";
import * as schema from "../ponder.schema";
import { IOracleAbi } from "../abis/IOracle";
import { IGNORED_ORACLES } from "./constants";

// Morpho (ETH Mainnet)
ponder.on("Morpho:CreateMarket", async ({ event, context }) => {
  const { db } = context;

  await db.insert(schema.markets).values({
    id: event.args.id,
    chainId: context.network.chainId,
    oracle: event.args.marketParams.oracle,
    lltv: event.args.marketParams.lltv,
    irm: event.args.marketParams.irm,
    collateralToken: event.args.marketParams.collateralToken,
    loanToken: event.args.marketParams.loanToken,
    totalBorrowAssets: 0n,
    totalBorrowShares: 0n,
  });
});

ponder.on("Morpho:SupplyCollateral", async ({ event, context }) => {
  const { db } = context;

  await db
    .insert(schema.positions)
    .values({
      marketId: event.args.id,
      borrower: event.args.onBehalf,
      borrowShares: 0n,
      collateral: event.args.assets,
    })
    .onConflictDoUpdate((position) => ({
      collateral: position.collateral + event.args.assets,
    }));
});

ponder.on("Morpho:WithdrawCollateral", async ({ event, context }) => {
  const { db } = context;

  await db
    .insert(schema.positions)
    .values({
      marketId: event.args.id,
      borrower: event.args.onBehalf,
      borrowShares: 0n,
      collateral: 0n,
    })
    .onConflictDoUpdate((position) => ({
      collateral: position.collateral - event.args.assets,
    }));
});

ponder.on("Morpho:Borrow", async ({ event, context }) => {
  const { db } = context;

  const market = await db.find(schema.markets, {
    id: event.args.id,
    chainId: context.network.chainId,
  });
  if (!market)
    throw new Error(`Market ${event.args.id} not found during borrow`);

  await db
    .insert(schema.positions)
    .values({
      marketId: event.args.id,
      borrower: event.args.onBehalf,
      borrowShares: event.args.shares,
      collateral: 0n,
    })
    .onConflictDoUpdate((position) => ({
      borrowShares: position.borrowShares + event.args.shares,
    }));

  await db
    .update(schema.markets, {
      id: event.args.id,
      chainId: context.network.chainId,
    })
    .set({
      totalBorrowAssets: market.totalBorrowAssets + event.args.assets,
      totalBorrowShares: market.totalBorrowShares + event.args.shares,
    });
});

ponder.on("Morpho:Repay", async ({ event, context }) => {
  const { db } = context;

  const market = await db.find(schema.markets, {
    id: event.args.id,
    chainId: context.network.chainId,
  });
  if (!market)
    throw new Error(`Market ${event.args.id} not found during repay`);

  await db
    .insert(schema.positions)
    .values({
      marketId: event.args.id,
      borrower: event.args.onBehalf,
      borrowShares: 0n,
      collateral: 0n,
    })
    .onConflictDoUpdate((position) => ({
      borrowShares: position.borrowShares - event.args.shares,
    }));

  await db
    .update(schema.markets, {
      id: event.args.id,
      chainId: context.network.chainId,
    })
    .set({
      totalBorrowAssets: market.totalBorrowAssets - event.args.assets,
      totalBorrowShares: market.totalBorrowShares - event.args.shares,
    });
});

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
