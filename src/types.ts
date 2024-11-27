export type Position = {
  marketId: string;
  borrower: string;
  borrowShares: bigint;
  collateral: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lltv: bigint;
  oracle: string;
  price: bigint;
};

export type PositionMetrics = {
  borrowed: bigint;
  collateralValue: bigint;
  maxBorrow: bigint;
  ltv: bigint;
  ltvPercentage: number;
  maxLtvPercentage: number;
  isHealthy: boolean;
};

export type BlockInfo = {
  timestamp: bigint;
  blockNumber: bigint;
};
