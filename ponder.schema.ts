import { onchainTable } from "@ponder/core";

export const createMarketEvent = onchainTable("createMarketEvent", (t) => ({
  id: t.text().primaryKey(),
  loanToken: t.text().notNull(),
  collateralToken: t.text().notNull(),
  oracle: t.text().notNull(),
  irm: t.text().notNull(),
  lltv: t.bigint().notNull(),
}));
