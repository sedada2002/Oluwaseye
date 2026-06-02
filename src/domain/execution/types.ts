import type { IBrokerageAdapter } from "../brokerage/IBrokerageAdapter.js";
import type { BrokerOrderResult, OrderPayload } from "../brokerage/types.js";
import type { Money } from "../../shared/money.js";

export type OrderLifecycleState =
  | "PENDING"
  | "ROUTING"
  | "TRANSMITTED"
  | "PARTIAL"
  | "FILLED"
  | "FAILED"
  | "SLIPPAGE_REJECTED";

export interface MarketQuote {
  readonly ticker: string;
  readonly bid: Money;
  readonly ask: Money;
  readonly last: Money;
  readonly asOf: Date;
}

export interface QuoteProvider {
  getLatestQuote(ticker: string): Promise<MarketQuote>;
}

export interface OrderLedgerRepository {
  createPendingOrder(sequenceId: string, order: OrderPayload): Promise<void>;
  transitionOrder(clientOrderId: string, from: OrderLifecycleState, to: OrderLifecycleState, metadata: OrderMetadata): Promise<boolean>;
  markOrderState(clientOrderId: string, state: OrderLifecycleState, metadata: OrderMetadata): Promise<void>;
  appendBrokerResult(clientOrderId: string, result: BrokerOrderResult): Promise<void>;
  markSequenceAlert(sequenceId: string, reason: string, metadata: OrderMetadata): Promise<void>;
}

export interface DistributedLock {
  acquire(key: string, ttlMs: number): Promise<LockLease | null>;
}

export interface LockLease {
  readonly key: string;
  release(): Promise<void>;
}

export interface OrderMetadata {
  readonly [key: string]: string | number | boolean | null;
}

export interface ExecutionRequest {
  readonly sequenceId: string;
  readonly userId: string;
  readonly adapter: IBrokerageAdapter;
  readonly orders: readonly OrderPayload[];
  readonly signalPrices: ReadonlyMap<string, Money>;
  readonly maxSlippageBps: number;
  readonly lockTtlMs: number;
}

export interface ExecutionOrderOutcome {
  readonly clientOrderId: string;
  readonly state: OrderLifecycleState;
  readonly brokerOrderId?: string;
  readonly message?: string;
}

export interface ExecutionSummary {
  readonly sequenceId: string;
  readonly acquiredLock: boolean;
  readonly outcomes: readonly ExecutionOrderOutcome[];
}

export interface BrokerExecutionReport {
  readonly clientOrderId: string;
  readonly brokerOrderId: string;
  readonly filledQuantity: string;
  readonly remainingQuantity: string;
  readonly averageFillPrice: Money | null;
  readonly terminalStatus: "PARTIAL" | "FILLED" | "FAILED";
  readonly receivedAt: Date;
  readonly message?: string;
}
