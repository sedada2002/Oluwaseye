import type { BrokerOrderResult, OrderPayload } from "../brokerage/types.js";
import type {
  BrokerExecutionReport,
  DistributedLock,
  ExecutionOrderOutcome,
  ExecutionRequest,
  ExecutionSummary,
  MarketQuote,
  OrderLedgerRepository,
  OrderMetadata,
  QuoteProvider
} from "./types.js";
import { compareMoney, subtractMoney, type Money } from "../../shared/money.js";

export class OrderExecutionCoordinator {
  private readonly lock: DistributedLock;
  private readonly ledger: OrderLedgerRepository;
  private readonly quoteProvider: QuoteProvider;

  public constructor(lock: DistributedLock, ledger: OrderLedgerRepository, quoteProvider: QuoteProvider) {
    this.lock = lock;
    this.ledger = ledger;
    this.quoteProvider = quoteProvider;
  }

  public async execute(request: ExecutionRequest): Promise<ExecutionSummary> {
    const lockKey = `omnivest:execution:user:${request.userId}`;
    const lease = await this.lock.acquire(lockKey, request.lockTtlMs);
    if (!lease) {
      return {
        sequenceId: request.sequenceId,
        acquiredLock: false,
        outcomes: request.orders.map((order) => ({
          clientOrderId: order.clientOrderId,
          state: "FAILED",
          message: "Execution lock already held for user."
        }))
      };
    }

    try {
      await Promise.all(request.orders.map((order) => this.ledger.createPendingOrder(request.sequenceId, order)));
      const eligibleOrders = await this.rejectSlippageBreaches(request);
      const routedOutcomes = await Promise.all(eligibleOrders.map((order) => this.routeSingleOrder(request, order)));
      const rejectedClientOrderIds = new Set(eligibleOrders.map((order) => order.clientOrderId));
      const skippedOutcomes = request.orders
        .filter((order) => !rejectedClientOrderIds.has(order.clientOrderId))
        .map((order): ExecutionOrderOutcome => ({
          clientOrderId: order.clientOrderId,
          state: "SLIPPAGE_REJECTED",
          message: "Rejected before routing because slippage exceeded configured threshold."
        }));

      return {
        sequenceId: request.sequenceId,
        acquiredLock: true,
        outcomes: [...skippedOutcomes, ...routedOutcomes]
      };
    } finally {
      await lease.release();
    }
  }

  public async reconcileBrokerExecutionReport(report: BrokerExecutionReport): Promise<void> {
    const metadata: OrderMetadata = {
      brokerOrderId: report.brokerOrderId,
      filledQuantity: report.filledQuantity,
      remainingQuantity: report.remainingQuantity,
      receivedAt: report.receivedAt.toISOString(),
      averageFillPriceMinor: report.averageFillPrice?.minor.toString() ?? null,
      message: report.message ?? null
    };

    if (report.terminalStatus === "PARTIAL") {
      const transitioned = await this.ledger.transitionOrder(report.clientOrderId, "TRANSMITTED", "PARTIAL", metadata);
      if (!transitioned) {
        await this.ledger.markOrderState(report.clientOrderId, "PARTIAL", metadata);
      }
      return;
    }

    if (report.terminalStatus === "FILLED") {
      const fromPartial = await this.ledger.transitionOrder(report.clientOrderId, "PARTIAL", "FILLED", metadata);
      if (!fromPartial) {
        const fromTransmitted = await this.ledger.transitionOrder(report.clientOrderId, "TRANSMITTED", "FILLED", metadata);
        if (!fromTransmitted) {
          await this.ledger.markOrderState(report.clientOrderId, "FILLED", metadata);
        }
      }
      return;
    }

    const failedFromRouting = await this.ledger.transitionOrder(report.clientOrderId, "ROUTING", "FAILED", metadata);
    if (!failedFromRouting) {
      const failedFromTransmitted = await this.ledger.transitionOrder(report.clientOrderId, "TRANSMITTED", "FAILED", metadata);
      if (!failedFromTransmitted) {
        await this.ledger.markOrderState(report.clientOrderId, "FAILED", metadata);
      }
    }
  }

  private async rejectSlippageBreaches(request: ExecutionRequest): Promise<readonly OrderPayload[]> {
    const eligible: OrderPayload[] = [];

    await Promise.all(request.orders.map(async (order) => {
      const signalPrice = request.signalPrices.get(order.ticker);
      if (!signalPrice) {
        await this.ledger.markOrderState(order.clientOrderId, "FAILED", { reason: "missing_signal_price" });
        await this.ledger.markSequenceAlert(request.sequenceId, "Missing signal price for order.", {
          clientOrderId: order.clientOrderId,
          ticker: order.ticker
        });
        return;
      }

      try {
        const quote = await this.quoteProvider.getLatestQuote(order.ticker);
        const slippageBps = this.calculateSlippageBps(signalPrice, this.executionReferencePrice(order, quote));
        if (slippageBps > request.maxSlippageBps) {
          await this.ledger.markOrderState(order.clientOrderId, "SLIPPAGE_REJECTED", {
            ticker: order.ticker,
            slippageBps,
            maxSlippageBps: request.maxSlippageBps
          });
          await this.ledger.markSequenceAlert(request.sequenceId, "Order rejected by slippage guard.", {
            clientOrderId: order.clientOrderId,
            ticker: order.ticker,
            slippageBps,
            maxSlippageBps: request.maxSlippageBps
          });
          return;
        }

        eligible.push(order);
      } catch (error: unknown) {
        await this.ledger.markOrderState(order.clientOrderId, "FAILED", {
          reason: "quote_lookup_failed",
          message: error instanceof Error ? error.message : "Unknown quote provider failure."
        });
        await this.ledger.markSequenceAlert(request.sequenceId, "Quote lookup failed before order routing.", {
          clientOrderId: order.clientOrderId,
          ticker: order.ticker
        });
      }
    }));

    return eligible;
  }

  private async routeSingleOrder(request: ExecutionRequest, order: OrderPayload): Promise<ExecutionOrderOutcome> {
    try {
      const movedToRouting = await this.ledger.transitionOrder(order.clientOrderId, "PENDING", "ROUTING", {
        ticker: order.ticker
      });
      if (!movedToRouting) {
        return {
          clientOrderId: order.clientOrderId,
          state: "FAILED",
          message: "Order was not in PENDING state at routing time."
        };
      }

      const [result] = await request.adapter.executeBatchOrders([order]);
      if (!result) {
        await this.ledger.markOrderState(order.clientOrderId, "FAILED", { reason: "empty_broker_response" });
        return {
          clientOrderId: order.clientOrderId,
          state: "FAILED",
          message: "Broker returned no response for order."
        };
      }

      await this.ledger.appendBrokerResult(order.clientOrderId, result);
      const transmittedState = result.status === "ACCEPTED" ? "TRANSMITTED" : "FAILED";
      await this.ledger.markOrderState(order.clientOrderId, transmittedState, this.metadataFromBrokerResult(result));
      const outcome: ExecutionOrderOutcome = {
        clientOrderId: order.clientOrderId,
        state: transmittedState
      };
      return {
        ...outcome,
        ...(result.brokerOrderId ? { brokerOrderId: result.brokerOrderId } : {}),
        ...(result.message ? { message: result.message } : {})
      };
    } catch (error: unknown) {
      await this.ledger.markOrderState(order.clientOrderId, "FAILED", {
        reason: "broker_route_exception",
        message: error instanceof Error ? error.message : "Unknown broker routing failure."
      });
      await this.ledger.markSequenceAlert(request.sequenceId, "Broker route exception isolated to one order.", {
        clientOrderId: order.clientOrderId,
        ticker: order.ticker
      });
      return {
        clientOrderId: order.clientOrderId,
        state: "FAILED",
        message: error instanceof Error ? error.message : "Unknown broker routing failure."
      };
    }
  }

  private executionReferencePrice(order: OrderPayload, quote: MarketQuote): Money {
    if (order.side === "BUY") {
      return quote.ask;
    }
    if (compareMoney(quote.bid, { currency: quote.bid.currency, minor: 0n }) > 0) {
      return quote.bid;
    }
    return quote.last;
  }

  private calculateSlippageBps(signalPrice: Money, currentPrice: Money): number {
    if (signalPrice.minor <= 0n) {
      return Number.MAX_SAFE_INTEGER;
    }
    const delta = subtractMoney(currentPrice, signalPrice);
    const absoluteDelta = delta.minor < 0n ? -delta.minor : delta.minor;
    return Number((absoluteDelta * 10_000n) / signalPrice.minor);
  }

  private metadataFromBrokerResult(result: BrokerOrderResult): OrderMetadata {
    return {
      brokerStatus: result.status,
      brokerOrderId: result.brokerOrderId ?? null,
      brokerMessage: result.message ?? null
    };
  }
}
