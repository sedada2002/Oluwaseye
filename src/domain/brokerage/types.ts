import type { Money } from "../../shared/money.js";

export type BrokerProvider = "SCHWAB" | "AGGREGATION";
export type BrokerConnectionStatus = "VALID" | "EXPIRED" | "REVOKED" | "UNAVAILABLE";
export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT";
export type TimeInForce = "DAY" | "GTC";
export type AssetClass = "EQUITY" | "ETF";
export type BrokerOrderStatus = "ACCEPTED" | "REJECTED" | "UNKNOWN";

export interface BrokerageConnection {
  readonly connectionId: string;
  readonly userId: string;
  readonly provider: BrokerProvider;
  readonly accountId: string;
}

export interface OAuthTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAtEpochMs: number;
  readonly scope: readonly string[];
}

export interface ConnectionValidation {
  readonly status: BrokerConnectionStatus;
  readonly provider: BrokerProvider;
  readonly checkedAt: Date;
  readonly reason?: string;
}

export interface PortfolioBalance {
  readonly accountId: string;
  readonly equityValue: Money;
  readonly liquidCash: Money;
  readonly buyingPower: Money;
  readonly asOf: Date;
}

export interface Position {
  readonly ticker: string;
  readonly assetClass: AssetClass;
  readonly quantity: string;
  readonly marketValue: Money;
  readonly averagePrice: Money;
  readonly fractionalTradingAllowed: boolean;
}

export interface OrderPayload {
  readonly clientOrderId: string;
  readonly userId: string;
  readonly accountId: string;
  readonly ticker: string;
  readonly side: OrderSide;
  readonly type: OrderType;
  readonly timeInForce: TimeInForce;
  readonly notional?: Money;
  readonly quantity?: string;
  readonly limitPrice?: Money;
}

export interface BrokerOrderResult {
  readonly clientOrderId: string;
  readonly brokerOrderId?: string;
  readonly status: BrokerOrderStatus;
  readonly acceptedAt?: Date;
  readonly message?: string;
}
