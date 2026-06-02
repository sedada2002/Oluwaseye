import axios, { type AxiosInstance } from "axios";
import type { IBrokerageAdapter } from "./IBrokerageAdapter.js";
import type {
  BrokerOrderResult,
  BrokerageConnection,
  ConnectionValidation,
  OrderPayload,
  PortfolioBalance,
  Position
} from "./types.js";
import { ExternalServiceError } from "../../shared/errors.js";
import { moneyToDecimalString, usdFromDecimal } from "../../shared/money.js";

export interface AggregationAdapterConfig {
  readonly apiBaseUrl: string;
  readonly apiKey: string;
  readonly connectionSecret: string;
}

interface AggregatedBalanceResponse {
  readonly account_id: string;
  readonly total_equity: string;
  readonly cash: string;
  readonly buying_power: string;
}

interface AggregatedPositionResponse {
  readonly symbol: string;
  readonly asset_class: "equity" | "etf";
  readonly quantity: string;
  readonly market_value: string;
  readonly average_price: string;
  readonly supports_fractional: boolean;
}

interface AggregatedOrderResponse {
  readonly client_order_id: string;
  readonly downstream_order_id?: string;
  readonly status: "accepted" | "rejected" | "unknown";
  readonly message?: string;
}

export class UnifiedAggregationAdapter implements IBrokerageAdapter {
  private readonly connection: BrokerageConnection;
  private readonly config: AggregationAdapterConfig;
  private readonly http: AxiosInstance;

  public constructor(connection: BrokerageConnection, config: AggregationAdapterConfig, http?: AxiosInstance) {
    this.connection = connection;
    this.config = config;
    this.http = http ?? axios.create({ timeout: 10_000 });
  }

  public async validateConnection(): Promise<ConnectionValidation> {
    try {
      await this.http.get(`${this.config.apiBaseUrl}/connections/${encodeURIComponent(this.connection.connectionId)}`, {
        headers: this.headers()
      });
      return { status: "VALID", provider: "AGGREGATION", checkedAt: new Date() };
    } catch (error: unknown) {
      return {
        status: "UNAVAILABLE",
        provider: "AGGREGATION",
        checkedAt: new Date(),
        reason: this.describeError("Aggregation validation failed", error)
      };
    }
  }

  public async getPortfolioBalance(): Promise<PortfolioBalance> {
    try {
      const response = await this.http.get<AggregatedBalanceResponse>(
        `${this.config.apiBaseUrl}/accounts/${encodeURIComponent(this.connection.accountId)}/balance`,
        { headers: this.headers() }
      );
      return {
        accountId: response.data.account_id,
        equityValue: usdFromDecimal(response.data.total_equity),
        liquidCash: usdFromDecimal(response.data.cash),
        buyingPower: usdFromDecimal(response.data.buying_power),
        asOf: new Date()
      };
    } catch (error: unknown) {
      throw new ExternalServiceError("AGGREGATION", this.describeError("Aggregation balance read failed", error), true);
    }
  }

  public async getCurrentPositions(): Promise<readonly Position[]> {
    try {
      const response = await this.http.get<readonly AggregatedPositionResponse[]>(
        `${this.config.apiBaseUrl}/accounts/${encodeURIComponent(this.connection.accountId)}/positions`,
        { headers: this.headers() }
      );
      return response.data.map((position) => ({
        ticker: position.symbol,
        assetClass: position.asset_class === "etf" ? "ETF" : "EQUITY",
        quantity: position.quantity,
        marketValue: usdFromDecimal(position.market_value),
        averagePrice: usdFromDecimal(position.average_price),
        fractionalTradingAllowed: position.supports_fractional
      }));
    } catch (error: unknown) {
      throw new ExternalServiceError("AGGREGATION", this.describeError("Aggregation positions read failed", error), true);
    }
  }

  public async executeBatchOrders(orders: readonly OrderPayload[]): Promise<readonly BrokerOrderResult[]> {
    const routedOrders = orders.map((order) => ({
      client_order_id: order.clientOrderId,
      account_id: order.accountId,
      symbol: order.ticker,
      side: order.side.toLowerCase(),
      type: order.type.toLowerCase(),
      time_in_force: order.timeInForce.toLowerCase(),
      notional: order.notional ? moneyToDecimalString(order.notional) : undefined,
      quantity: order.quantity,
      limit_price: order.limitPrice ? moneyToDecimalString(order.limitPrice) : undefined
    }));

    try {
      const response = await this.http.post<readonly AggregatedOrderResponse[]>(
        `${this.config.apiBaseUrl}/orders/batch`,
        { orders: routedOrders },
        { headers: this.headers() }
      );
      return response.data.map((result) => {
        const mapped: BrokerOrderResult = {
          clientOrderId: result.client_order_id,
          status: result.status === "accepted" ? "ACCEPTED" : result.status === "rejected" ? "REJECTED" : "UNKNOWN"
        };
        return {
          ...mapped,
          ...(result.downstream_order_id ? { brokerOrderId: result.downstream_order_id } : {}),
          ...(result.status === "accepted" ? { acceptedAt: new Date() } : {}),
          ...(result.message ? { message: result.message } : {})
        };
      });
    } catch (error: unknown) {
      return orders.map((order) => ({
        clientOrderId: order.clientOrderId,
        status: "UNKNOWN",
        message: this.describeError("Aggregation batch order route failed", error)
      }));
    }
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      "X-Connection-Secret": this.config.connectionSecret,
      "Content-Type": "application/json"
    };
  }

  private describeError(prefix: string, error: unknown): string {
    if (axios.isAxiosError(error)) {
      return `${prefix}: status=${String(error.response?.status ?? "none")} message=${error.message}`;
    }
    return error instanceof Error ? `${prefix}: ${error.message}` : `${prefix}: unknown error`;
  }
}
