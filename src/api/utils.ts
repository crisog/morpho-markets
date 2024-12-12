import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import NodeCache from "node-cache";
import * as schema from "../../ponder.schema";
import { apiSdk } from "@morpho-org/blue-sdk-ethers-liquidation";

const CONFIG = {
  TOKEN_PRICE_URL: "https://api.coingecko.com/api/v3/coins/ethereum/contract",
  CHAIN_ID: 1,
  ORACLE_PRICE_SCALE: BigInt(1e36),
  DEFAULT_DECIMALS: 18,
  ZERO_ADDRESS: "0x0000000000000000000000000000000000000000",
} as const;

const caches = {
  tokenInfo: new NodeCache({ stdTTL: 24 * 60 * 60, checkperiod: 60 * 60 }), // 24h TTL, 1h check
  prices: new NodeCache({ stdTTL: 5 * 60, checkperiod: 60 }), // 5m TTL, 1m check
  markets: new NodeCache({ stdTTL: 2 * 60 * 60, checkperiod: 15 * 60 }), // 2h TTL, 15m check
};

export interface TokenPrices {
  [address: string]: {
    price: number;
    decimals: number;
    symbol: string;
  };
}

interface TokenInfo {
  decimals: number;
  symbol: string;
}

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
  {
    name: "symbol",
    type: "function",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

async function fetchTokenPrice(tokenAddress: string): Promise<number> {
  if (tokenAddress === CONFIG.ZERO_ADDRESS) return 0;

  const cacheKey = `price_${tokenAddress.toLowerCase()}`;
  const cachedPrice = caches.prices.get<number>(cacheKey);
  if (cachedPrice !== undefined) return cachedPrice;

  try {
    const response = await fetch(
      `${CONFIG.TOKEN_PRICE_URL}/${tokenAddress}/market_chart?vs_currency=usd&days=7&interval=daily`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-cg-demo-api-key": process.env.COINGECKO_API_KEY ?? "",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!data?.prices?.length) {
      throw new Error("Invalid data structure from API");
    }

    const price = data.prices[data.prices.length - 1]?.[1] ?? 0;
    caches.prices.set(cacheKey, price);
    return price;
  } catch (error) {
    console.error(`[Price] Error fetching price for ${tokenAddress}:`, error);
    return 0;
  }
}

async function fetchTokenInfo(tokenAddress: string): Promise<TokenInfo> {
  if (tokenAddress === CONFIG.ZERO_ADDRESS) {
    return { decimals: 0, symbol: "" };
  }

  const cacheKey = `info_${tokenAddress.toLowerCase()}`;
  const cachedInfo = caches.tokenInfo.get<TokenInfo>(cacheKey);
  if (cachedInfo) return cachedInfo;

  try {
    const [decimals, symbol] = await Promise.all([
      publicClient.readContract({
        address: tokenAddress as `0x${string}`,
        abi: tokenAbi,
        functionName: "decimals",
      }),
      publicClient.readContract({
        address: tokenAddress as `0x${string}`,
        abi: tokenAbi,
        functionName: "symbol",
      }),
    ]);

    if (typeof decimals !== "number" || typeof symbol !== "string") {
      throw new Error("Invalid contract response");
    }

    const tokenInfo = { decimals, symbol };
    caches.tokenInfo.set(cacheKey, tokenInfo);
    return tokenInfo;
  } catch (error) {
    console.error(`[Token] Error fetching info for ${tokenAddress}:`, error);
    return { decimals: CONFIG.DEFAULT_DECIMALS, symbol: "Unknown" };
  }
}

export async function getTokenPrices(
  markets: Array<{ loanToken: string; collateralToken: string }>
): Promise<TokenPrices> {
  const uniqueTokens = new Set([
    ...markets.map((m) => m.loanToken.toLowerCase()),
    ...markets.map((m) => m.collateralToken.toLowerCase()),
  ]);

  console.log("[Tokens] Processing unique tokens:", [...uniqueTokens]);
  const prices: TokenPrices = {};

  await Promise.all(
    [...uniqueTokens].map(async (address) => {
      try {
        const [price, tokenInfo] = await Promise.all([
          fetchTokenPrice(address),
          fetchTokenInfo(address),
        ]);

        prices[address] = {
          price,
          decimals: tokenInfo.decimals,
          symbol: tokenInfo.symbol,
        };
      } catch (error) {
        console.error(`[Token] Failed to process ${address}:`, error);
      }
    })
  );

  console.log("\n[Tokens] Final price data:", prices);
  return prices;
}

export async function getWhitelistedMarkets(): Promise<string[]> {
  const cachedMarkets = caches.markets.get<string[]>("whitelisted_markets");
  if (cachedMarkets) return cachedMarkets;

  try {
    const {
      markets: { items },
    } = await apiSdk.getWhitelistedMarketIds({
      chainId: CONFIG.CHAIN_ID,
    });

    const marketIds = items?.map(({ uniqueKey }) => uniqueKey) ?? [];
    caches.markets.set("whitelisted_markets", marketIds);
    return marketIds;
  } catch (error) {
    console.error("[Markets] Error fetching whitelisted markets:", error);
    return [];
  }
}
