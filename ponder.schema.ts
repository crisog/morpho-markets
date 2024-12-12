import { onchainTable, primaryKey } from "@ponder/core";

export const markets = onchainTable("markets", (t) => ({
  id: t.text().primaryKey(),
  oracle: t.text().notNull(),
  lltv: t.bigint().notNull(),
  totalBorrowAssets: t.bigint().notNull(),
  totalBorrowShares: t.bigint().notNull(),
}));

export const positions = onchainTable(
  "positions",
  (t) => ({
    marketId: t.text().notNull(),
    borrower: t.text().notNull(),
    borrowShares: t.bigint().notNull(),
    collateral: t.bigint().notNull(),
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
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.oracleAddress, table.blockNumber] }),
  })
);