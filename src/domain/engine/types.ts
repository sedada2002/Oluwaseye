import type { OrderPayload, Position } from "../brokerage/types.js";
import type { AllocationWeight, Money } from "../../shared/money.js";

export interface TargetAllocation {
  readonly ticker: string;
  readonly weight: AllocationWeight;
  readonly triggerPrice?: Money;
}

export interface UserPortfolio {
  readonly userId: string;
  readonly accountId: string;
  readonly equityValue: Money;
  readonly liquidCash: Money;
  readonly positions: readonly Position[];
  readonly fractionalTradingAllowedByDefault: boolean;
}

export interface RebalanceConfig {
  readonly cashBufferProtection: Money;
  readonly minimumTradeNotional: Money;
  readonly referencePrices: ReadonlyMap<string, Money>;
  readonly orderType: "MARKET";
  readonly timeInForce: "DAY";
}

export type RebalanceFaultCode =
  | "INVALID_TARGET_WEIGHTS"
  | "CASH_BUFFER_VIOLATION"
  | "NO_EQUITY"
  | "CURRENCY_MISMATCH"
  | "FRACTIONAL_RESTRICTION_PRICE_REQUIRED";

export interface RebalanceFault {
  readonly code: RebalanceFaultCode;
  readonly message: string;
}

export interface RebalancePlan {
  readonly userId: string;
  readonly accountId: string;
  readonly orders: readonly OrderPayload[];
  readonly projectedCashAfterBuys: Money;
  readonly totalBuyNotional: Money;
  readonly totalSellNotional: Money;
}

export type RebalanceResult =
  | { readonly ok: true; readonly plan: RebalancePlan }
  | { readonly ok: false; readonly fault: RebalanceFault };
