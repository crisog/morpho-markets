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
import {
  ORACLE_PRICE_SCALE,
  IGNORED_ORACLES,
  CHAIN_TOKENS,
} from "../constants";
import { apiSdk } from "@morpho-org/blue-sdk-ethers-liquidation";
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

  const nonLiquidatablePositions: LiquidatablePosition[] = [];
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

      const positionData = {
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
      };

      if (isLiquidatable) {
        liquidatablePositions.push(positionData);
      } else {
        nonLiquidatablePositions.push(positionData);
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

  // Morpho Blue API does not support Sepolia
  if (chainId === 11155111) {
    const {
      marketPositions: { items: morphoBluePositions },
    } = await apiSdk.getLiquidatablePositions({
      chainId,
      wNative: CHAIN_TOKENS[chainId as keyof typeof CHAIN_TOKENS].WETH,
      marketIds,
    });

    // These positions show up on Morpho Blue API as liquidatable, but for us they are healthy
    const missingPositions = morphoBluePositions?.filter(
      (position) =>
        !liquidatablePositions.some(
          (p) =>
            p.user.address === position.user.address &&
            p.market.loanAsset.address === position.market.loanAsset.address &&
            p.market.collateralAsset?.address ===
              position.market.collateralAsset?.address
        )
    );

    if (missingPositions?.length) {
      console.info(
        `Found ${missingPositions.length} missing positions in Morpho Blue API`
      );

      for (const position of missingPositions) {
        const nonLiquidatable = nonLiquidatablePositions.find(
          (p) =>
            p.user.address === position.user.address &&
            p.market.loanAsset.address === position.market.loanAsset.address &&
            p.market.collateralAsset?.address ===
              position.market.collateralAsset?.address
        );

        if (!nonLiquidatable) continue;

        console.info(
          `Position details for ${nonLiquidatable?.user.address}:`,
          `\n- Collateral Token: ${nonLiquidatable?.market.collateralAsset?.address}`,
          `\n- Loan Token: ${nonLiquidatable?.market.loanAsset.address}`,
          `\n- Position Borrow Shares: ${nonLiquidatable?.position.borrowShares}`,
          `\n- Position Collateral: ${nonLiquidatable?.position.collateral}`,
          `\n- Position Current LTV: ${nonLiquidatable?.position.currentLtv}`,
          `\n- Market LLTV: ${nonLiquidatable?.market.lltv}`,
          `\n- Market Total Borrow Assets: ${nonLiquidatable?.market.totalBorrowAssets}`,
          `\n- Market Total Borrow Shares: ${nonLiquidatable?.market.totalBorrowShares}`,
          `\n`
        );
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
