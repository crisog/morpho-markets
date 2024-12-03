import { ponder } from "@/generated";
import * as schema from "../../ponder.schema";
import { eq } from "@ponder/core";
import { createPublicClient, http, formatUnits } from "viem";
import { mainnet } from "viem/chains";

const TOKEN_PRICE_URL =
  "https://api.coingecko.com/api/v3/coins/ethereum/contract";

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(process.env.ETH_RPC_URL),
});

const tokenAbi = [
  {
    name: "decimals",
    type: "function",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
] as const;

interface TokenPrices {
  [address: string]: {
    price: number;
    decimals: number;
  };
}

async function fetchTokenPrice(tokenAddress: string): Promise<number> {
  try {
    console.log(`[Price] Fetching for ${tokenAddress}`);

    const response = await fetch(
      `${TOKEN_PRICE_URL}/${tokenAddress}/market_chart?vs_currency=usd&days=7&interval=daily`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-cg-demo-api-key": process.env.COINGECKO_API_KEY ?? "",
        },
      }
    );

    if (!response.ok) {
      console.error(`[Price] HTTP error for ${tokenAddress}:`, {
        status: response.status,
        statusText: response.statusText,
      });
      return 0;
    }

    const data = await response.json();
    console.log(`[Price] Raw data for ${tokenAddress}:`, data);
    if (
      !data ||
      typeof data !== "object" ||
      !("prices" in data) ||
      !Array.isArray(data.prices) ||
      data.prices.length === 0
    ) {
      console.error(`[Price] Invalid data structure for ${tokenAddress}`);
      return 0;
    }

    const price = data.prices[data.prices.length - 1]?.[1] ?? 0;
    console.log(`[Price] Final price for ${tokenAddress}: ${price}`);
    return price;
  } catch (error) {
    console.error(`[Price] Error for ${tokenAddress}:`, error);
    return 0;
  }
}

async function getTokenDecimals(tokenAddress: string): Promise<number> {
  try {
    console.log(`[Decimals] Fetching for ${tokenAddress}`);
    const decimals = await publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: tokenAbi,
      functionName: "decimals",
    });
    console.log(`[Decimals] Got ${decimals} for ${tokenAddress}`);
    return decimals;
  } catch (error) {
    console.error(`[Decimals] Error for ${tokenAddress}:`, error);
    return 18;
  }
}

async function getTokenPrices(
  markets: Array<{ loanToken: string; collateralToken: string }>
): Promise<TokenPrices> {
  const uniqueTokens = new Set([
    ...markets.map((m) => m.loanToken.toLowerCase()),
    ...markets.map((m) => m.collateralToken.toLowerCase()),
  ]);

  console.log("[Tokens] Processing unique tokens:", [...uniqueTokens]);
  const prices: TokenPrices = {};

  for (const address of uniqueTokens) {
    console.log(`\n[Token] Processing ${address}`);

    try {
      const [price, decimals] = await Promise.all([
        fetchTokenPrice(address),
        getTokenDecimals(address),
      ]);

      prices[address] = { price, decimals };
      console.log(`[Token] Completed ${address}:`, prices[address]);
    } catch (error) {
      console.error(`[Token] Failed ${address}:`, error);
    }
  }

  console.log("\n[Tokens] Final price data:", prices);
  return prices;
}

ponder.get("/tvl", async (c) => {
  try {
    console.log("\n[Start] Fetching markets");
    const markets = await c.db.select().from(schema.markets);
    console.log(
      `[Markets] Found ${markets.length}:`,
      markets.map((m) => m.id)
    );

    console.log("\n[Start] Fetching token data");
    const tokenPrices = await getTokenPrices(markets);

    let totalMetrics = {
      totalSupplyUSD: 0,
      totalCollateralUSD: 0,
      totalBorrowedUSD: 0,
    };

    for (const market of markets) {
      console.log(`\n[Market ${market.id}] Processing`);

      const loanTokenData = tokenPrices[market.loanToken.toLowerCase()];
      const collateralTokenData =
        tokenPrices[market.collateralToken.toLowerCase()];

      console.log(`[Market ${market.id}] Token data:`, {
        loanToken: {
          address: market.loanToken,
          data: loanTokenData,
        },
        collateralToken: {
          address: market.collateralToken,
          data: collateralTokenData,
        },
      });

      if (!loanTokenData?.price || !collateralTokenData?.price) {
        console.log(`[Market ${market.id}] Skipping - Missing price data`);
        continue;
      }

      const supplyUnits = Number(
        formatUnits(market.totalSupplyAssets, loanTokenData.decimals)
      );
      const supplyUSD = supplyUnits * loanTokenData.price;
      console.log(`[Market ${market.id}] Supply:`, {
        raw: market.totalSupplyAssets.toString(),
        units: supplyUnits,
        usd: supplyUSD,
        decimals: loanTokenData.decimals,
        price: loanTokenData.price,
      });

      const positions = await c.db
        .select()
        .from(schema.positions)
        .where(eq(schema.positions.marketId, market.id));

      const totalCollateral = positions.reduce(
        (sum, pos) => sum + pos.collateral,
        0n
      );
      const collateralUnits = Number(
        formatUnits(totalCollateral, collateralTokenData.decimals)
      );
      const collateralUSD = collateralUnits * collateralTokenData.price;

      console.log(`[Market ${market.id}] Collateral:`, {
        positions: positions.length,
        raw: totalCollateral.toString(),
        units: collateralUnits,
        usd: collateralUSD,
        decimals: collateralTokenData.decimals,
        price: collateralTokenData.price,
      });

      const borrowUnits = Number(
        formatUnits(market.totalBorrowAssets, loanTokenData.decimals)
      );
      const borrowUSD = borrowUnits * loanTokenData.price;
      console.log(`[Market ${market.id}] Borrow:`, {
        raw: market.totalBorrowAssets.toString(),
        units: borrowUnits,
        usd: borrowUSD,
        decimals: loanTokenData.decimals,
        price: loanTokenData.price,
      });

      totalMetrics.totalSupplyUSD += supplyUSD;
      totalMetrics.totalCollateralUSD += collateralUSD;
      totalMetrics.totalBorrowedUSD += borrowUSD;

      console.log(`[Market ${market.id}] Running totals:`, totalMetrics);
    }

    const tvlIncludingBorrows =
      totalMetrics.totalSupplyUSD + totalMetrics.totalCollateralUSD;
    const tvlExcludingBorrows =
      totalMetrics.totalSupplyUSD +
      (totalMetrics.totalCollateralUSD - totalMetrics.totalBorrowedUSD);

    console.log("\n[Final] Metrics:", {
      tvlIncludingBorrows,
      tvlExcludingBorrows,
      totalBorrowed: totalMetrics.totalBorrowedUSD,
    });

    return c.json({
      tvlIncludingBorrows: tvlIncludingBorrows.toString(),
      tvlExcludingBorrows: tvlExcludingBorrows.toString(),
      totalBorrowed: totalMetrics.totalBorrowedUSD.toString(),
    });
  } catch (error) {
    console.error("[Fatal] Error:", error);
    return c.text(
      `Failed to calculate metrics: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      500
    );
  }
});
