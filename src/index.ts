import { ponder } from "@/generated";
import * as schema from "../ponder.schema";
import { IOracleAbi } from "../abis/IOracle";

const IGNORED_ORACLE_ADDRESSES = [
  "0x0000000000000000000000000000000000000000",
  "0x3A7bB36Ee3f3eE32A60e9f2b33c1e5f2E83ad766",
  "0x94C2DfA8917F1657a55D1d604fd31C930A10Bca3",
];

ponder.on("Morpho:CreateMarket", async ({ event, context }) => {
  const { db } = context;

  await db.insert(schema.markets).values({
    id: event.args.id,
    loanToken: event.args.marketParams.loanToken,
    collateralToken: event.args.marketParams.collateralToken,
    oracle: event.args.marketParams.oracle,
    irm: event.args.marketParams.irm,
    lltv: event.args.marketParams.lltv,
  });

  if (IGNORED_ORACLE_ADDRESSES.includes(event.args.marketParams.oracle)) {
    return;
  }

  const oraclePrice = await context.client.readContract({
    address: event.args.marketParams.oracle,
    abi: IOracleAbi,
    functionName: "price",
  });

  await db
    .insert(schema.oraclePrices)
    .values({
      oracleAddress: event.args.marketParams.oracle,
      price: oraclePrice,
      blockNumber: event.block.number,
    })
    .onConflictDoNothing();
});

ponder.on("Morpho:Supply", async ({ event, context }) => {
  const { db } = context;

  await db
    .insert(schema.positions)
    .values({
      marketId: event.args.id,
      borrower: event.args.onBehalf,
    })
    .onConflictDoNothing();
});

ponder.on("Morpho:Borrow", async ({ event, context }) => {
  const { db } = context;

  await db
    .insert(schema.positions)
    .values({
      marketId: event.args.id,
      borrower: event.args.onBehalf,
    })
    .onConflictDoNothing();
});
