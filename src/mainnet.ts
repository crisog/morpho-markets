import { ponder } from "@/generated";
import * as schema from "../ponder.schema";
import { MorphoAbi } from "../abis/Morpho";
import { IOracleAbi } from "../abis/IOracle";
import { IGNORED_ORACLES } from "./constants";

// Morpho (ETH Mainnet)
ponder.on("Morpho:CreateMarket", async ({ event, context }) => {
  const { db } = context;

  await db
    .insert(schema.markets)
    .values({
      id: event.args.id,
      chainId: context.network.chainId,
      oracle: event.args.marketParams.oracle,
      lltv: event.args.marketParams.lltv,
      irm: event.args.marketParams.irm,
      collateralToken: event.args.marketParams.collateralToken,
      loanToken: event.args.marketParams.loanToken,
      totalBorrowAssets: 0n,
      totalBorrowShares: 0n,
    })
    .onConflictDoNothing();
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

  const position = await db.find(schema.positions, {
    marketId: event.args.id,
    borrower: event.args.onBehalf,
  });

  if (!position) {
    throw new Error(
      `Position not found for withdrawal: market ${event.args.id}, borrower ${event.args.onBehalf}`
    );
  }

  await db
    .update(schema.positions, {
      marketId: event.args.id,
      borrower: event.args.onBehalf,
    })
    .set({
      collateral: position.collateral - event.args.assets,
    });
});

ponder.on("Morpho:Borrow", async ({ event, context }) => {
  const { db } = context;

  const position = await db.find(schema.positions, {
    marketId: event.args.id,
    borrower: event.args.onBehalf,
  });

  if (!position) {
    throw new Error(
      `Position not found for borrow: market ${event.args.id}, borrower ${event.args.onBehalf}`
    );
  }

  await db
    .update(schema.positions, {
      marketId: event.args.id,
      borrower: event.args.onBehalf,
    })
    .set({
      borrowShares: position.borrowShares + event.args.shares,
    });
});

ponder.on("Morpho:Repay", async ({ event, context }) => {
  const { db } = context;

  const position = await db.find(schema.positions, {
    marketId: event.args.id,
    borrower: event.args.onBehalf,
  });

  if (!position) {
    throw new Error(
      `Position not found for repay: market ${event.args.id}, borrower ${event.args.onBehalf}`
    );
  }

  await db
    .update(schema.positions, {
      marketId: event.args.id,
      borrower: event.args.onBehalf,
    })
    .set({
      borrowShares: position.borrowShares - event.args.shares,
    });
});

ponder.on("Morpho:Liquidate", async ({ event, context }) => {
  const { db } = context;

  await db
    .update(schema.positions, {
      marketId: event.args.id,
      borrower: event.args.borrower,
    })
    .set((position) => ({
      borrowShares:
        position.borrowShares -
        event.args.repaidShares -
        event.args.badDebtShares,
      collateral: position.collateral - event.args.seizedAssets,
    }));
});

ponder.on("MarketStateUpdates:block", async ({ event, context }) => {
  const { db } = context;

  const markets = await db.sql.select().from(schema.markets);

  for (const market of markets) {
    try {
      const marketState = await context.client.readContract({
        address: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" as `0x${string}`,
        abi: MorphoAbi,
        functionName: "market",
        args: [market.id as `0x${string}`],
      });

      await db
        .update(schema.markets, {
          id: market.id,
          chainId: context.network.chainId,
        })
        .set({
          totalBorrowAssets: marketState[2], // totalBorrowAssets is at index 2
          totalBorrowShares: marketState[3], // totalBorrowShares is at index 3
        });
    } catch (error) {
      console.error(
        `Failed to fetch market state for market ${market.id}:`,
        error
      );
    }
  }
});

ponder.on("OracleUpdates:block", async ({ event, context }) => {
  const { db } = context;

  const markets = await db.sql.select().from(schema.markets);

  for (const market of markets) {
    try {
      if (!IGNORED_ORACLES.includes(market.oracle)) {
        const price = await context.client.readContract({
          address: market.oracle as `0x${string}`,
          abi: IOracleAbi,
          functionName: "price",
        });

        await db
          .insert(schema.oraclePrices)
          .values({
            oracleAddress: market.oracle,
            price,
            blockNumber: event.block.number,
            timestamp: event.block.timestamp,
          })
          .onConflictDoNothing();
      }
    } catch (error) {
      console.error(
        `Failed to fetch oracle price for market ${market.id}:`,
        error
      );
    }
  }
});
