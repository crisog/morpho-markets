import { Chain, createPublicClient, http } from "viem";
import { mainnet, sepolia, base } from "viem/chains";
import NodeCache from "node-cache";
import { apiSdk } from "@morpho-org/blue-sdk-ethers-liquidation";
import { CONFIG, IGNORED_TOKENS, CHAIN_TOKENS } from "../constants";
import { IOracleAbi } from "../../abis/IOracle";

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

function getPublicClient(chainId: number) {
  const chain = getChainConfig(chainId);
  return createPublicClient({
    chain,
    transport: http(process.env.ETH_RPC_URL),
  });
}

function getChainConfig(chainId: number): Chain {
  switch (chainId) {
    case 1:
      return mainnet;
    case 11155111:
      return sepolia;
    case 8453:
      return base;
    default:
      throw new Error(`Unsupported chain ID: ${chainId}`);
  }
}

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

async function fetchTokenPrice(
  tokenAddress: string,
  chainId: number
): Promise<number> {
  if (IGNORED_TOKENS.includes(tokenAddress)) return 0;

  // Morpho Sepolia Mock Prices
  if (chainId === 11155111) {
    if (
      tokenAddress.toLowerCase() ===
      "0x990ab7BD0AD072926Fa422862F628356d4328656".toLowerCase()
    ) {
      return 100;
    }
    if (
      tokenAddress.toLowerCase() ===
      "0x6e9101634dfd5ef90d5a50b07ce085b7758ed0eb".toLowerCase()
    ) {
      return 93.75;
    }

    if (
      tokenAddress.toLowerCase() ===
      "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9".toLowerCase()
    ) {
      return 3800;
    }
  }

  const cacheKey = `price_${chainId}_${tokenAddress.toLowerCase()}`;
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

async function fetchTokenInfo(
  tokenAddress: string,
  chainId: number
): Promise<TokenInfo> {
  if (IGNORED_TOKENS.includes(tokenAddress)) return { decimals: 0, symbol: "" };

  // Morpho Sepolia Mock Info
  if (chainId === 11155111) {
    if (
      tokenAddress.toLowerCase() ===
      "0x990ab7BD0AD072926Fa422862F628356d4328656".toLowerCase()
    ) {
      return { decimals: 18, symbol: "LNT" };
    }
    if (
      tokenAddress.toLowerCase() ===
      "0x6e9101634dfd5ef90d5a50b07ce085b7758ed0eb".toLowerCase()
    ) {
      return { decimals: 18, symbol: "CLT" };
    }
  }

  const cacheKey = `info_${chainId}_${tokenAddress.toLowerCase()}`;
  const cachedInfo = caches.tokenInfo.get<TokenInfo>(cacheKey);
  if (cachedInfo) return cachedInfo;

  try {
    const publicClient = getPublicClient(chainId);
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
  markets: Array<{ loanToken: string; collateralToken: string }>,
  chainId: number
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
          fetchTokenPrice(address, chainId),
          fetchTokenInfo(address, chainId),
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

export async function getWhitelistedMarkets(
  chainId: number
): Promise<string[]> {
  const cachedMarkets = caches.markets.get<string[]>("whitelisted_markets");
  if (cachedMarkets) return cachedMarkets;

  try {
    const {
      markets: { items },
    } = await apiSdk.getWhitelistedMarketIds({
      chainId,
    });

    const marketIds = items?.map(({ uniqueKey }) => uniqueKey) ?? [];
    caches.markets.set("whitelisted_markets", marketIds);
    return marketIds;
  } catch (error) {
    console.error("[Markets] Error fetching whitelisted markets:", error);
    return [];
  }
}

export async function getWethPriceUsd(chainId: number): Promise<number> {
  const wethAddress = CHAIN_TOKENS[chainId as keyof typeof CHAIN_TOKENS]?.WETH;
  if (!wethAddress) {
    throw new Error(`No WETH address configured for chain ${chainId}`);
  }
  return await fetchTokenPrice(wethAddress, chainId);
}

export const getOraclePrice = async (
  oracleAddress: string,
  chainId: number
): Promise<{ price: bigint; blockNumber: bigint } | null> => {
  try {
    const client = getPublicClient(chainId);

    const blockNumber = await client.getBlockNumber();
    const price = await client.readContract({
      address: oracleAddress as `0x${string}`,
      abi: IOracleAbi,
      functionName: "price",
      blockNumber,
    });
    return { price, blockNumber };
  } catch (error) {
    console.error(
      `Failed to fetch live price from oracle ${oracleAddress}:`,
      error
    );
    return null;
  }
};
