import { onchainTable, primaryKey } from "@ponder/core";

export const markets = onchainTable("markets", (t) => ({
  id: t.text().primaryKey(),
  loanToken: t.text().notNull(),
  collateralToken: t.text().notNull(),
  oracle: t.text().notNull(),
  irm: t.text().notNull(),
  lltv: t.bigint().notNull(),
  totalSupplyAssets: t.bigint().notNull(),
  totalBorrowAssets: t.bigint().notNull(),
  totalBorrowShares: t.bigint().notNull(),
  lastUpdate: t.bigint().notNull(),
}));

export const positions = onchainTable(
  "positions",
  (t) => ({
    marketId: t.text().notNull(),
    borrower: t.text().notNull(),
    borrowShares: t.bigint().notNull(),
    collateral: t.bigint().notNull(),
    lastUpdated: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.marketId, table.borrower] }),
  })
);

export const oraclePrices = onchainTable(
  "oracle_prices",
  (t) => ({
    oracleAddress: t.text().notNull(),
    price: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.oracleAddress, table.blockNumber] }),
  })
);

export const marketStates = onchainTable(
  "market_states",
  (t) => ({
    marketId: t.text().notNull(),
    totalBorrowAssets: t.bigint().notNull(),
    totalBorrowShares: t.bigint().notNull(),
    logIndex: t.integer().notNull(),
    blockNumber: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({
      columns: [table.marketId, table.blockNumber, table.logIndex],
    }),
  })
);
