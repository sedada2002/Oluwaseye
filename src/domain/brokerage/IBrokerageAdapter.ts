import type {
  BrokerOrderResult,
  ConnectionValidation,
  OrderPayload,
  PortfolioBalance,
  Position
} from "./types.js";

export interface IBrokerageAdapter {
  validateConnection(): Promise<ConnectionValidation>;
  getPortfolioBalance(): Promise<PortfolioBalance>;
  getCurrentPositions(): Promise<readonly Position[]>;
  executeBatchOrders(orders: readonly OrderPayload[]): Promise<readonly BrokerOrderResult[]>;
}
