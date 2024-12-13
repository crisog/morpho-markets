import { ponder } from "@/generated";
import * as schema from "../../ponder.schema";
import { eq, graphql } from "@ponder/core";
import {
  getOraclePrice,
  getTokenPrices,
  getWethPriceUsd,
  getWhitelistedMarkets,
} from "./utils";
import { MathLib, SharesMath } from "@morpho-org/blue-sdk";
import { ORACLE_PRICE_SCALE, IGNORED_ORACLES } from "../constants";
ponder.use("/", graphql());
ponder.use("/graphql", graphql());

interface Asset {
  address: string;
  decimals?: number;
  symbol?: string;
  priceUsd?: number;
}

interface UserData {
  address: string;
}

interface MarketData {
  id: string;
  irmAddress: string;
  lltv: string;
  oracleAddress: string;
  oraclePrice: string;
  collateralAsset: Asset;
  loanAsset: Asset;
  totalBorrowAssets: string;
  totalBorrowShares: string;
}

interface PositionData {
  collateral: string;
  borrowShares: string;
  currentLtv: string;
}

interface LiquidatablePosition {
  user: UserData;
  market: MarketData;
  position: PositionData;
}

ponder.get("/liquidatable", async (c) => {
  const chainId = Number(c.req.query("chainId")) || 1; // default to mainnet

  const marketIds = await getWhitelistedMarkets(chainId);

  if (chainId === 11155111) {
    marketIds.push(
      "0x7324da61dcc1954f58ee06104b7d966d80e807c81ff4950698853d15210d256e"
    );
  }

  if (!marketIds.length) {
    return c.json({
      chainId,
      timestamp: Date.now(),
      wethPriceUsd: 0,
      positions: [],
    });
  }

  console.info(`[Liquidatable] Processing ${marketIds.length} markets`);

  const liquidatablePositions: LiquidatablePosition[] = [];

  for (const marketId of marketIds) {
    const market = await c.db.query.markets.findFirst({
      where: (_markets, { and }) =>
        and(
          eq(schema.markets.id, marketId),
          eq(schema.markets.chainId, chainId)
        ),
    });

    if (!market) {
      console.info(`Market ${marketId} not found in database`);
      continue;
    }

    let latestPrice = await c.db.query.oraclePrices.findFirst({
      where: eq(schema.oraclePrices.oracleAddress, market.oracle),
      orderBy: (oraclePrices, { desc }) => [desc(oraclePrices.blockNumber)],
    });

    if (IGNORED_ORACLES.includes(market.oracle)) continue;

    if (!latestPrice) {
      const oraclePriceResponse = await getOraclePrice(market.oracle, chainId);
      if (oraclePriceResponse) {
        latestPrice = {
          oracleAddress: market.oracle,
          price: oraclePriceResponse.price,
          blockNumber: oraclePriceResponse.blockNumber,
        };
      }

      if (!latestPrice) {
        console.info(`No price found for oracle ${market.oracle}`);
        continue;
      }
    }

    const positions = await c.db.query.positions.findMany({
      where: (positions, { and, gt }) =>
        and(eq(positions.marketId, market.id), gt(positions.borrowShares, 0n)),
    });

    // These positions show up on Morpho Blue API as liquidatable, but for us they are healthy
    const missingPositions = [
      {
        user: "0xCC020c162AE6670C6F87F6bdA50fA694925663AA",
        collateral: "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3",
        loan: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      },
      {
        user: "0x71D30d13C8AC4Da640CC27c7c51EF717fBF6Ee70",
        collateral: "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3",
        loan: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      },
      {
        user: "0x5B6a25010A1740179eFd8756bBAbC8131D73a4Cb",
        collateral: "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3",
        loan: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      },
      {
        user: "0x52aEa9154F3F74B3cFEcd7D4Bc8f27414b6BeF73",
        collateral: "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3",
        loan: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      },
      {
        user: "0xC6F324f6CFEfafbf96C8072463521940b85DcfF4",
        collateral: "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3",
        loan: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
      },
      {
        user: "0xE482F04253E7B45fB69064E99dCf36A723c27D1F",
        collateral: "0x35D8949372D46B7a3D5A56006AE77B215fc69bC0",
        loan: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      },
      {
        user: "0x7BdFd77330510EA6a012bD595989DF7015fFC6c3",
        collateral: "0x35D8949372D46B7a3D5A56006AE77B215fc69bC0",
        loan: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      },
      {
        user: "0xCEB76DB7beDb581e0CD2Bb7d3E3f3f4EC0D6c3A5",
        collateral: "0x35D8949372D46B7a3D5A56006AE77B215fc69bC0",
        loan: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      },
      {
        user: "0xdc5118E4f80DA892e33d78A3EFbe58fa53132F2d",
        collateral: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        loan: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      },
      {
        user: "0xb6Bf87251dA39f108c5717f1c1Ba38D0702fD618",
        collateral: "0x8236a87084f8B84306f72007F36F2618A5634494",
        loan: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      },
    ];

    for (const position of positions) {
      if (position.collateral == 0n) {
        console.info(
          `Skipping position ${position.borrower} in market ${market.id} - appears to be fully liquidated (zero collateral with ${position.borrowShares} borrowShares)`
        );
        continue;
      }

      const borrowed = SharesMath.toAssets(
        position.borrowShares,
        market.totalBorrowAssets,
        market.totalBorrowShares,
        "Up"
      );
      const collateralValueInLoanAssets = MathLib.mulDivDown(
        position.collateral,
        latestPrice.price,
        ORACLE_PRICE_SCALE
      );
      const maxBorrow = MathLib.wMulDown(
        collateralValueInLoanAssets,
        market.lltv
      );
      const isLiquidatable = borrowed > maxBorrow;
      const currentLtv = MathLib.wDivUp(borrowed, collateralValueInLoanAssets);

      if (
        missingPositions.some(
          (pos) =>
            pos.user === position.borrower &&
            pos.loan === market.loanToken &&
            pos.collateral === market.collateralToken
        )
      ) {
        console.info(
          `\nDebug Missing Position:`,
          JSON.stringify(
            {
              user: position.borrower,
              market: market.id,
              oracle: market.oracle,
              collateral: position.collateral.toString(),
              borrowShares: position.borrowShares.toString(),
              borrowed: borrowed.toString(),
              currentLtv: currentLtv.toString(),
              lltv: market.lltv.toString(),
              isLiquidatable: isLiquidatable,
              oraclePrice: latestPrice.price.toString(),
              marketTotalBorrowAssets: market.totalBorrowAssets.toString(),
              marketTotalBorrowShares: market.totalBorrowShares.toString(),
            },
            null,
            2
          )
        );
      }

      if (isLiquidatable) {
        liquidatablePositions.push({
          user: {
            address: position.borrower,
          },
          market: {
            id: market.id,
            oracleAddress: market.oracle,
            irmAddress: market.irm,
            lltv: market.lltv.toString(),
            totalBorrowAssets: market.totalBorrowAssets.toString(),
            totalBorrowShares: market.totalBorrowShares.toString(),
            oraclePrice: latestPrice.price.toString(),
            collateralAsset: {
              address: market.collateralToken,
            },
            loanAsset: {
              address: market.loanToken,
            },
          },
          position: {
            collateral: position.collateral.toString(),
            borrowShares: position.borrowShares.toString(),
            currentLtv: currentLtv.toString(),
          },
        });
      }
    }
  }

  if (liquidatablePositions.length) {
    const tokenPrices = await getTokenPrices(
      liquidatablePositions.map(({ market }) => ({
        loanToken: market.loanAsset.address,
        collateralToken: market.collateralAsset.address,
      })),
      chainId
    );

    for (const position of liquidatablePositions) {
      const collateralInfo =
        tokenPrices[position.market.collateralAsset.address];
      const loanInfo = tokenPrices[position.market.loanAsset.address];

      if (collateralInfo) {
        position.market.collateralAsset = {
          ...position.market.collateralAsset,
          decimals: collateralInfo.decimals,
          symbol: collateralInfo.symbol,
          priceUsd: collateralInfo.price,
        };
      }

      if (loanInfo) {
        position.market.loanAsset = {
          ...position.market.loanAsset,
          decimals: loanInfo.decimals,
          symbol: loanInfo.symbol,
          priceUsd: loanInfo.price,
        };
      }
    }
  }

  console.info(
    `\nFound ${liquidatablePositions.length} liquidatable positions in total`
  );

  const wethPriceUsd = await getWethPriceUsd(chainId);

  return c.json({
    chainId,
    timestamp: Date.now(),
    wethPriceUsd,
    positions: liquidatablePositions,
  });
});
