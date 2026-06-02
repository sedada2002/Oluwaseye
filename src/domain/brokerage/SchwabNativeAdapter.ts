import axios, { AxiosError, type AxiosInstance } from "axios";
import type { IBrokerageAdapter } from "./IBrokerageAdapter.js";
import type { TokenRepository } from "./TokenRepository.js";
import type {
  BrokerOrderResult,
  BrokerageConnection,
  ConnectionValidation,
  OAuthTokenSet,
  OrderPayload,
  PortfolioBalance,
  Position
} from "./types.js";
import { ExternalServiceError } from "../../shared/errors.js";
import { moneyToDecimalString, usdFromDecimal } from "../../shared/money.js";

export interface SchwabAdapterConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly oauthBaseUrl: string;
  readonly traderApiBaseUrl: string;
  readonly tokenRefreshSkewMs: number;
}

interface SchwabTokenResponse {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly expires_in: number;
  readonly scope?: string;
}

interface SchwabAccountBalanceResponse {
  readonly securitiesAccount: {
    readonly accountNumber: string;
    readonly currentBalances: {
      readonly liquidationValue: number;
      readonly cashBalance: number;
      readonly buyingPower: number;
    };
    readonly positions?: readonly {
      readonly longQuantity?: number;
      readonly shortQuantity?: number;
      readonly averagePrice?: number;
      readonly marketValue?: number;
      readonly instrument: {
        readonly symbol: string;
        readonly assetType: string;
      };
    }[];
  };
}

interface SchwabOrderResponse {
  readonly orderId?: string;
  readonly status?: string;
}

export class SchwabNativeAdapter implements IBrokerageAdapter {
  private readonly connection: BrokerageConnection;
  private readonly tokenRepository: TokenRepository;
  private readonly config: SchwabAdapterConfig;
  private readonly http: AxiosInstance;

  public constructor(connection: BrokerageConnection, tokenRepository: TokenRepository, config: SchwabAdapterConfig, http?: AxiosInstance) {
    this.connection = connection;
    this.tokenRepository = tokenRepository;
    this.config = config;
    this.http = http ?? axios.create({ timeout: 10_000 });
  }

  public async exchangeAuthorizationCode(authorizationCode: string): Promise<OAuthTokenSet> {
    const response = await this.http.post<SchwabTokenResponse>(
      `${this.config.oauthBaseUrl}/token`,
      new URLSearchParams({
        grant_type: "authorization_code",
        code: authorizationCode,
        redirect_uri: this.config.redirectUri
      }),
      { auth: { username: this.config.clientId, password: this.config.clientSecret } }
    );

    const tokenSet = this.toTokenSet(response.data, undefined);
    await this.tokenRepository.saveOAuthTokenSet(this.connection.connectionId, tokenSet);
    return tokenSet;
  }

  public async validateConnection(): Promise<ConnectionValidation> {
    try {
      await this.getValidTokenSet();
      return { status: "VALID", provider: "SCHWAB", checkedAt: new Date() };
    } catch (error: unknown) {
      return {
        status: this.isUnauthorized(error) ? "REVOKED" : "UNAVAILABLE",
        provider: "SCHWAB",
        checkedAt: new Date(),
        reason: error instanceof Error ? error.message : "Unknown Schwab validation failure."
      };
    }
  }

  public async getPortfolioBalance(): Promise<PortfolioBalance> {
    const account = await this.fetchAccount();
    const balances = account.securitiesAccount.currentBalances;
    return {
      accountId: this.connection.accountId,
      equityValue: usdFromDecimal(balances.liquidationValue.toFixed(4)),
      liquidCash: usdFromDecimal(balances.cashBalance.toFixed(4)),
      buyingPower: usdFromDecimal(balances.buyingPower.toFixed(4)),
      asOf: new Date()
    };
  }

  public async getCurrentPositions(): Promise<readonly Position[]> {
    const account = await this.fetchAccount();
    return (account.securitiesAccount.positions ?? []).map((position) => {
      const signedQuantity = (position.longQuantity ?? 0) - (position.shortQuantity ?? 0);
      return {
        ticker: position.instrument.symbol,
        assetClass: position.instrument.assetType === "ETF" ? "ETF" : "EQUITY",
        quantity: signedQuantity.toString(),
        marketValue: usdFromDecimal((position.marketValue ?? 0).toFixed(4)),
        averagePrice: usdFromDecimal((position.averagePrice ?? 0).toFixed(4)),
        fractionalTradingAllowed: false
      };
    });
  }

  public async executeBatchOrders(orders: readonly OrderPayload[]): Promise<readonly BrokerOrderResult[]> {
    const tokenSet = await this.getValidTokenSet();
    const requests = orders.map(async (order): Promise<BrokerOrderResult> => {
      try {
        const response = await this.http.post<SchwabOrderResponse>(
          `${this.config.traderApiBaseUrl}/accounts/${encodeURIComponent(order.accountId)}/orders`,
          this.toSchwabOrder(order),
          { headers: { Authorization: `Bearer ${tokenSet.accessToken}` } }
        );
        const result: BrokerOrderResult = {
          clientOrderId: order.clientOrderId,
          status: response.data.status === "REJECTED" ? "REJECTED" : "ACCEPTED",
          acceptedAt: new Date()
        };
        return {
          ...result,
          ...(response.data.orderId ? { brokerOrderId: response.data.orderId } : {}),
          ...(response.data.status ? { message: response.data.status } : {})
        };
      } catch (error: unknown) {
        return {
          clientOrderId: order.clientOrderId,
          status: "UNKNOWN",
          message: this.describeAxiosError("Schwab order routing failed", error)
        };
      }
    });

    return Promise.all(requests);
  }

  private async fetchAccount(): Promise<SchwabAccountBalanceResponse> {
    const tokenSet = await this.getValidTokenSet();
    try {
      const response = await this.http.get<SchwabAccountBalanceResponse>(
        `${this.config.traderApiBaseUrl}/accounts/${encodeURIComponent(this.connection.accountId)}?fields=positions`,
        { headers: { Authorization: `Bearer ${tokenSet.accessToken}` } }
      );
      return response.data;
    } catch (error: unknown) {
      throw new ExternalServiceError("SCHWAB", this.describeAxiosError("Schwab account read failed", error), !this.isUnauthorized(error));
    }
  }

  private async getValidTokenSet(): Promise<OAuthTokenSet> {
    const tokenSet = await this.tokenRepository.loadOAuthTokenSet(this.connection.connectionId);
    if (!tokenSet) {
      throw new ExternalServiceError("SCHWAB", "No Schwab OAuth token set found.", false);
    }
    if (Date.now() + this.config.tokenRefreshSkewMs < tokenSet.expiresAtEpochMs) {
      return tokenSet;
    }
    return this.refreshTokenSet(tokenSet);
  }

  private async refreshTokenSet(existing: OAuthTokenSet): Promise<OAuthTokenSet> {
    try {
      const response = await this.http.post<SchwabTokenResponse>(
        `${this.config.oauthBaseUrl}/token`,
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: existing.refreshToken
        }),
        { auth: { username: this.config.clientId, password: this.config.clientSecret } }
      );
      const refreshed = this.toTokenSet(response.data, existing.refreshToken);
      await this.tokenRepository.saveOAuthTokenSet(this.connection.connectionId, refreshed);
      return refreshed;
    } catch (error: unknown) {
      throw new ExternalServiceError("SCHWAB", this.describeAxiosError("Schwab token refresh failed", error), !this.isUnauthorized(error));
    }
  }

  private toTokenSet(response: SchwabTokenResponse, fallbackRefreshToken: string | undefined): OAuthTokenSet {
    const refreshToken = response.refresh_token ?? fallbackRefreshToken;
    if (!refreshToken) {
      throw new ExternalServiceError("SCHWAB", "Schwab token response did not include a refresh token.", false);
    }

    return {
      accessToken: response.access_token,
      refreshToken,
      expiresAtEpochMs: Date.now() + response.expires_in * 1000,
      scope: response.scope ? response.scope.split(" ") : []
    };
  }

  private toSchwabOrder(order: OrderPayload): Record<string, unknown> {
    const instruction = order.side === "BUY" ? "BUY" : "SELL";
    const orderLegCollection = [{
      instruction,
      quantity: order.quantity ? Number(order.quantity) : undefined,
      instrument: { symbol: order.ticker, assetType: "EQUITY" }
    }];

    return {
      orderType: order.type,
      session: "NORMAL",
      duration: order.timeInForce,
      orderStrategyType: "SINGLE",
      price: order.limitPrice ? moneyToDecimalString(order.limitPrice) : undefined,
      orderLegCollection,
      childOrderStrategies: [],
      requestedDestination: "AUTO",
      clientOrderId: order.clientOrderId,
      notional: order.notional ? moneyToDecimalString(order.notional) : undefined
    };
  }

  private describeAxiosError(prefix: string, error: unknown): string {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const details = typeof error.response?.data === "string" ? error.response.data : JSON.stringify(error.response?.data ?? {});
      return `${prefix}: status=${String(status ?? "none")} message=${error.message} details=${details}`;
    }
    return error instanceof Error ? `${prefix}: ${error.message}` : `${prefix}: unknown error`;
  }

  private isUnauthorized(error: unknown): boolean {
    return error instanceof AxiosError && (error.response?.status === 401 || error.response?.status === 403);
  }
}
