import { ponder } from "@/generated";
import * as schema from "../ponder.schema";

ponder.on("Morpho:CreateMarket", async ({ event, context }) => {
  await context.db.insert(schema.createMarketEvent).values({
    id: event.log.id,
    loanToken: event.args.marketParams.loanToken,
    collateralToken: event.args.marketParams.collateralToken,
    oracle: event.args.marketParams.oracle,
    irm: event.args.marketParams.irm,
    lltv: event.args.marketParams.lltv,
  });
});
