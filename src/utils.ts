import { BlockInfo, Position, PositionMetrics } from "./types";

export const CONSTANTS = {
  ORACLE_PRICE_SCALE: BigInt(1e36),
  WAD: BigInt(1e18),
  WARNING_THRESHOLD: 0.95,
  HIGH_RISK_THRESHOLD: 0.98,
  MAX_LIQUIDATION_INCENTIVE_FACTOR: 1.15,
} as const;

export const formatTimestamp = (timestamp: bigint): string => {
  const date = new Date(Number(timestamp) * 1000);
  return date.toLocaleString("en-US", { timeZone: "America/Halifax" });
};

export const calculatePositionMetrics = (
  position: Position
): PositionMetrics => {
  const borrowed =
    (position.borrowShares * position.totalBorrowAssets) /
    position.totalBorrowShares;
  const collateralValue =
    (position.collateral * position.price) / CONSTANTS.ORACLE_PRICE_SCALE;
  const maxBorrow = (collateralValue * position.lltv) / CONSTANTS.WAD;
  const ltv = (borrowed * CONSTANTS.WAD) / collateralValue;
  const ltvPercentage = Number(ltv) / 1e16;
  const maxLtvPercentage = Number(position.lltv) / 1e16;

  return {
    borrowed,
    collateralValue,
    maxBorrow,
    ltv,
    ltvPercentage,
    maxLtvPercentage,
    isHealthy: maxBorrow >= borrowed,
  };
};

export const calculateLiquidationIncentive = (
  maxLtvPercentage: number
): number => {
  return Math.min(
    CONSTANTS.MAX_LIQUIDATION_INCENTIVE_FACTOR,
    1 / ((0.3 * maxLtvPercentage) / 100 + 0.7)
  );
};

export const logPositionDetails = (
  position: Position,
  metrics: PositionMetrics,
  blockInfo: BlockInfo
) => {
  console.log(
    `Position details at block ${blockInfo.blockNumber} (${formatTimestamp(
      blockInfo.timestamp
    )}):`
  );
  console.log({
    borrowShares: position.borrowShares.toString(),
    borrowed: metrics.borrowed.toString(),
    collateral: position.collateral.toString(),
    collateralValue: metrics.collateralValue.toString(),
    currentLTV: `${metrics.ltvPercentage.toFixed(2)}%`,
    maxLTV: `${metrics.maxLtvPercentage.toFixed(2)}%`,
    isHealthy: metrics.isHealthy,
  });
};

export const logHealthMetrics = (
  metrics: PositionMetrics,
  position: Position,
  blockInfo: BlockInfo
) => {
  console.log(
    `Position Health Metrics at block ${
      blockInfo.blockNumber
    } (${formatTimestamp(blockInfo.timestamp)}):`
  );
  console.log({
    collateralValue: metrics.collateralValue.toString(),
    borrowedValue: metrics.borrowed.toString(),
    maxBorrowValue: metrics.maxBorrow.toString(),
    healthBuffer: (metrics.maxBorrow - metrics.borrowed).toString(),
    oraclePrice: position.price.toString(),
  });
};

export const logLiquidationAlert = (
  position: Position,
  metrics: PositionMetrics,
  liquidationIncentiveFactor: number,
  blockInfo: BlockInfo
) => {
  console.log(
    `🚨 LIQUIDATION ALERT at block ${blockInfo.blockNumber} (${formatTimestamp(
      blockInfo.timestamp
    )}) 🚨`
  );
  console.log({
    marketId: position.marketId,
    borrower: position.borrower,
    currentLTV: `${metrics.ltvPercentage.toFixed(2)}%`,
    maxLTV: `${metrics.maxLtvPercentage.toFixed(2)}%`,
    borrowed: metrics.borrowed.toString(),
    collateral: position.collateral.toString(),
    possibleSeizure:
      (metrics.borrowed *
        BigInt(Math.floor(liquidationIncentiveFactor * 1e18))) /
      CONSTANTS.WAD,
    liquidationIncentive: `${((liquidationIncentiveFactor - 1) * 100).toFixed(
      2
    )}%`,
  });
};

export const logRiskWarning = (
  type: "HIGH" | "MEDIUM",
  position: Position,
  metrics: PositionMetrics,
  ltvRatio: number,
  blockInfo: BlockInfo
) => {
  const baseInfo = {
    marketId: position.marketId,
    borrower: position.borrower,
    currentLTV: `${metrics.ltvPercentage.toFixed(2)}%`,
    maxLTV: `${metrics.maxLtvPercentage.toFixed(2)}%`,
    buffer: `${(metrics.maxLtvPercentage - metrics.ltvPercentage).toFixed(2)}%`,
    block: blockInfo.blockNumber,
    timestamp: formatTimestamp(blockInfo.timestamp),
  };

  if (type === "HIGH") {
    console.log(
      `⚠️ HIGH RISK POSITION at block ${
        blockInfo.blockNumber
      } (${formatTimestamp(blockInfo.timestamp)}) ⚠️`
    );
    console.log({
      ...baseInfo,
      riskLevel: `${(ltvRatio * 100).toFixed(2)}%`,
    });
  } else {
    console.log(
      `📊 RISK WARNING at block ${blockInfo.blockNumber} (${formatTimestamp(
        blockInfo.timestamp
      )})`
    );
    console.log(baseInfo);
  }
};
