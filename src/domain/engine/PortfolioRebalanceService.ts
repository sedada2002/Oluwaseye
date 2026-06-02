import { v7 as uuidv7 } from "uuid";
import type { OrderPayload } from "../brokerage/types.js";
import type { RebalanceConfig, RebalanceFault, RebalancePlan, RebalanceResult, TargetAllocation, UserPortfolio } from "./types.js";
import {
  addMoney,
  allocateByWeight,
  compareMoney,
  subtractMoney,
  USD_ZERO,
  type AllocationWeight,
  type Money
} from "../../shared/money.js";

interface PositionValue {
  readonly ticker: string;
  readonly marketValue: Money;
  readonly quantityMicros: bigint;
  readonly fractionalTradingAllowed: boolean;
}

export class PortfolioRebalanceService {
  public calculate(targetAllocations: readonly TargetAllocation[], portfolio: UserPortfolio, config: RebalanceConfig): RebalanceResult {
    if (compareMoney(portfolio.equityValue, USD_ZERO) <= 0) {
      return {
        ok: false,
        fault: { code: "NO_EQUITY", message: "Cannot rebalance an account with zero or negative equity value." }
      };
    }

    const weightFault = this.validateWeights(targetAllocations.map((allocation) => allocation.weight));
    if (weightFault) {
      return { ok: false, fault: weightFault };
    }

    const currentValues = this.currentPositionMap(portfolio);
    const targetTickers = new Set(targetAllocations.map((allocation) => allocation.ticker));
    const desiredByTicker = new Map<string, Money>();

    for (const allocation of targetAllocations) {
      desiredByTicker.set(allocation.ticker, allocateByWeight(portfolio.equityValue, allocation.weight));
    }
    for (const position of currentValues.values()) {
      if (!targetTickers.has(position.ticker)) {
        desiredByTicker.set(position.ticker, USD_ZERO);
      }
    }

    const orders: OrderPayload[] = [];
    let totalBuyNotional = USD_ZERO;
    let totalSellNotional = USD_ZERO;

    for (const [ticker, desiredValue] of desiredByTicker.entries()) {
      const currentValue = currentValues.get(ticker)?.marketValue ?? USD_ZERO;
      const delta = subtractMoney(desiredValue, currentValue);
      const absoluteDelta = delta.minor < 0n ? { currency: delta.currency, minor: -delta.minor } : delta;
      const fractionalTradingAllowed = currentValues.get(ticker)?.fractionalTradingAllowed ?? portfolio.fractionalTradingAllowedByDefault;
      const adjustedOrder = this.adjustForFractionalTradingLimit(
        ticker,
        delta.minor > 0n ? "BUY" : "SELL",
        absoluteDelta,
        currentValues.get(ticker)?.quantityMicros ?? 0n,
        fractionalTradingAllowed,
        config
      );

      if (!adjustedOrder.ok) {
        return { ok: false, fault: adjustedOrder.fault };
      }

      if (compareMoney(adjustedOrder.notional, config.minimumTradeNotional) < 0) {
        continue;
      }

      const order: OrderPayload = {
        clientOrderId: uuidv7(),
        userId: portfolio.userId,
        accountId: portfolio.accountId,
        ticker,
        side: delta.minor > 0n ? "BUY" : "SELL",
        type: config.orderType,
        timeInForce: config.timeInForce,
        notional: adjustedOrder.notional,
        ...(adjustedOrder.quantity ? { quantity: adjustedOrder.quantity } : {})
      };
      orders.push(order);

      if (order.side === "BUY") {
        totalBuyNotional = addMoney(totalBuyNotional, adjustedOrder.notional);
      } else {
        totalSellNotional = addMoney(totalSellNotional, adjustedOrder.notional);
      }
    }

    const projectedCashAfterBuys = subtractMoney(portfolio.liquidCash, totalBuyNotional);
    if (compareMoney(projectedCashAfterBuys, config.cashBufferProtection) < 0) {
      return {
        ok: false,
        fault: {
          code: "CASH_BUFFER_VIOLATION",
          message: "Rebalance requires buy orders that would breach the configured cash buffer protection."
        }
      };
    }

    const plan: RebalancePlan = {
      userId: portfolio.userId,
      accountId: portfolio.accountId,
      orders,
      projectedCashAfterBuys,
      totalBuyNotional,
      totalSellNotional
    };

    return { ok: true, plan };
  }

  private validateWeights(weights: readonly AllocationWeight[]): RebalanceFault | null {
    const totalParts = weights.reduce((sum, weight) => sum + weight.partsPerMillion, 0);
    if (totalParts !== 1_000_000) {
      return {
        code: "INVALID_TARGET_WEIGHTS",
        message: `Target allocation weights must sum to exactly 1.000000; received ${String(totalParts)} parts per million.`
      };
    }
    return null;
  }

  private currentPositionMap(portfolio: UserPortfolio): Map<string, PositionValue> {
    const map = new Map<string, PositionValue>();
    for (const position of portfolio.positions) {
      const existing = map.get(position.ticker);
      if (!existing) {
        map.set(position.ticker, {
          ticker: position.ticker,
          marketValue: position.marketValue,
          quantityMicros: this.parseQuantityMicros(position.quantity),
          fractionalTradingAllowed: position.fractionalTradingAllowed || portfolio.fractionalTradingAllowedByDefault
        });
        continue;
      }
      map.set(position.ticker, {
        ticker: position.ticker,
        marketValue: addMoney(existing.marketValue, position.marketValue),
        quantityMicros: existing.quantityMicros + this.parseQuantityMicros(position.quantity),
        fractionalTradingAllowed: existing.fractionalTradingAllowed || position.fractionalTradingAllowed
      });
    }
    return map;
  }

  private adjustForFractionalTradingLimit(
    ticker: string,
    side: "BUY" | "SELL",
    requestedNotional: Money,
    heldQuantityMicros: bigint,
    fractionalTradingAllowed: boolean,
    config: RebalanceConfig
  ):
    | { readonly ok: true; readonly notional: Money; readonly quantity?: string }
    | { readonly ok: false; readonly fault: RebalanceFault } {
    if (fractionalTradingAllowed) {
      return { ok: true, notional: requestedNotional };
    }

    const referencePrice = config.referencePrices.get(ticker);
    if (!referencePrice || referencePrice.minor <= 0n) {
      return {
        ok: false,
        fault: {
          code: "FRACTIONAL_RESTRICTION_PRICE_REQUIRED",
          message: `Reference price is required to calculate a whole-share ${side} order for ${ticker}.`
        }
      };
    }

    const requestedWholeShares = requestedNotional.minor / referencePrice.minor;
    const heldWholeShares = heldQuantityMicros / 1_000_000n;
    const executableWholeShares = side === "SELL" && requestedWholeShares > heldWholeShares ? heldWholeShares : requestedWholeShares;
    const adjustedNotional: Money = {
      currency: requestedNotional.currency,
      minor: executableWholeShares * referencePrice.minor
    };

    return {
      ok: true,
      notional: adjustedNotional,
      ...(executableWholeShares > 0n ? { quantity: executableWholeShares.toString() } : {})
    };
  }

  private parseQuantityMicros(quantity: string): bigint {
    if (!/^-?\d+(\.\d{1,6})?$/.test(quantity)) {
      throw new Error(`Invalid share quantity: ${quantity}`);
    }
    const negative = quantity.startsWith("-");
    const normalized = negative ? quantity.slice(1) : quantity;
    const parts = normalized.split(".");
    const wholePart = parts[0] ?? "0";
    const fractionalPart = parts[1] ?? "";
    const micros = BigInt(wholePart) * 1_000_000n + BigInt(`${fractionalPart}000000`.slice(0, 6));
    return negative ? -micros : micros;
  }
}
