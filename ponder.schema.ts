import { onchainTable, primaryKey, relations } from "@ponder/core";

export const markets = onchainTable("markets", (t) => ({
  id: t.text().primaryKey(),
  loanToken: t.text().notNull(),
  collateralToken: t.text().notNull(),
  oracle: t.text().notNull(),
  irm: t.text().notNull(),
  lltv: t.bigint().notNull(),
  totalSupplyAssets: t.bigint().notNull(),
  totalSupplyShares: t.bigint().notNull(),
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

export const feeCollections = onchainTable(
  "fee_collections",
  (t) => ({
    marketId: t.text().notNull(),
    feeShares: t.bigint().notNull(),
    totalSupplyAssets: t.bigint().notNull(),
    totalSupplyShares: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
    logIndex: t.integer().notNull(),
  }),
  (table) => ({
    pk: primaryKey({
      columns: [table.marketId, table.blockNumber, table.logIndex],
    }),
  })
);

export const marketsRelations = relations(markets, ({ many }) => ({
  positions: many(positions),
  marketStates: many(marketStates),
  feeCollections: many(feeCollections),
}));

export const positionsRelations = relations(positions, ({ one }) => ({
  market: one(markets, {
    fields: [positions.marketId],
    references: [markets.id],
  }),
}));

export const marketStatesRelations = relations(marketStates, ({ one }) => ({
  market: one(markets, {
    fields: [marketStates.marketId],
    references: [markets.id],
  }),
}));

export const oraclePricesRelations = relations(oraclePrices, ({ one }) => ({
  market: one(markets, {
    fields: [oraclePrices.oracleAddress],
    references: [markets.oracle],
  }),
}));

export const feeCollectionsRelations = relations(feeCollections, ({ one }) => ({
  market: one(markets, {
    fields: [feeCollections.marketId],
    references: [markets.id],
  }),
}));
