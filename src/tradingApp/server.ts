import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { z } from "zod";

import type { IBrokerageAdapter } from "../domain/brokerage/IBrokerageAdapter.js";
import type {
  BrokerOrderResult,
  ConnectionValidation,
  OrderPayload,
  PortfolioBalance,
  Position
} from "../domain/brokerage/types.js";
import { PortfolioRebalanceService } from "../domain/engine/PortfolioRebalanceService.js";
import type { RebalanceConfig, TargetAllocation, UserPortfolio } from "../domain/engine/types.js";
import { OrderExecutionCoordinator } from "../domain/execution/OrderExecutionCoordinator.js";
import type {
  DistributedLock,
  ExecutionRequest,
  LockLease,
  MarketQuote,
  OrderLedgerRepository,
  OrderLifecycleState,
  OrderMetadata,
  QuoteProvider
} from "../domain/execution/types.js";
import { moneyToDecimalString, usdFromDecimal, weightFromDecimal, type Money } from "../shared/money.js";

const portArgument = process.argv.find((argument) => argument.startsWith("--port="));
const PORT = Number(portArgument?.slice("--port=".length) ?? process.env["OMNIVEST_TEST_PORT"] ?? "4174");

const targetAllocationSchema = z.object({
  ticker: z.string().trim().min(1).max(12).transform((value) => value.toUpperCase()),
  weight: z.number().min(0).max(1)
});

const rebalanceRequestSchema = z.object({
  cashBuffer: z.string().regex(/^\d+(\.\d{1,2})?$/),
  minimumTradeNotional: z.string().regex(/^\d+(\.\d{1,2})?$/),
  maxSlippageBps: z.number().int().min(0).max(10_000),
  targets: z.array(targetAllocationSchema).min(1)
});

const positions: readonly Position[] = [
  {
    ticker: "AAPL",
    assetClass: "EQUITY",
    quantity: "12",
    marketValue: usdFromDecimal("2400.00"),
    averagePrice: usdFromDecimal("185.00"),
    fractionalTradingAllowed: true
  },
  {
    ticker: "MSFT",
    assetClass: "EQUITY",
    quantity: "17",
    marketValue: usdFromDecimal("3400.00"),
    averagePrice: usdFromDecimal("160.00"),
    fractionalTradingAllowed: true
  },
  {
    ticker: "SPY",
    assetClass: "ETF",
    quantity: "6",
    marketValue: usdFromDecimal("3000.00"),
    averagePrice: usdFromDecimal("410.00"),
    fractionalTradingAllowed: false
  }
];

const portfolio: UserPortfolio = {
  userId: "demo-user-001",
  accountId: "demo-account-001",
  equityValue: usdFromDecimal("10000.00"),
  liquidCash: usdFromDecimal("1200.00"),
  positions,
  fractionalTradingAllowedByDefault: true
};

const referencePrices = new Map<string, Money>([
  ["AAPL", usdFromDecimal("200.00")],
  ["MSFT", usdFromDecimal("200.00")],
  ["SPY", usdFromDecimal("500.00")],
  ["NVDA", usdFromDecimal("125.00")]
]);

const signalPrices = new Map<string, Money>([
  ["AAPL", usdFromDecimal("200.00")],
  ["MSFT", usdFromDecimal("200.00")],
  ["SPY", usdFromDecimal("500.00")],
  ["NVDA", usdFromDecimal("125.00")]
]);

let lastOrders: readonly OrderPayload[] = [];
let lastMaxSlippageBps = 150;

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && requestUrl.pathname === "/") {
      sendHtml(response, renderHomePage());
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        service: "omnivest-stock-trading-harness",
        links: { dashboard: "/", portfolio: "/api/mock/portfolio", rebalance: "/api/rebalance", execute: "/api/execute" }
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/mock/portfolio") {
      sendJson(response, 200, serializePortfolio(portfolio));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/rebalance") {
      const body = rebalanceRequestSchema.parse(await readJson(request));
      const targets: readonly TargetAllocation[] = body.targets.map((target) => {
        const triggerPrice = signalPrices.get(target.ticker);
        return {
          ticker: target.ticker,
          weight: weightFromDecimal(target.weight),
          ...(triggerPrice ? { triggerPrice } : {})
        };
      });
      const config: RebalanceConfig = {
        cashBufferProtection: usdFromDecimal(body.cashBuffer),
        minimumTradeNotional: usdFromDecimal(body.minimumTradeNotional),
        referencePrices,
        orderType: "MARKET",
        timeInForce: "DAY"
      };
      const result = runtime.rebalanceService.calculate(targets, portfolio, config);
      lastMaxSlippageBps = body.maxSlippageBps;
      lastOrders = result.ok ? result.plan.orders : [];
      sendJson(response, result.ok ? 200 : 422, serializeRebalanceResult(result));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/execute") {
      if (lastOrders.length === 0) {
        sendJson(response, 409, { ok: false, message: "Create a successful rebalance plan before executing mock orders." });
        return;
      }
      const executionRequest: ExecutionRequest = {
        sequenceId: `demo-sequence-${String(Date.now())}`,
        userId: portfolio.userId,
        adapter: runtime.brokerageAdapter,
        orders: lastOrders,
        signalPrices,
        maxSlippageBps: lastMaxSlippageBps,
        lockTtlMs: 30_000
      };
      const summary = await runtime.coordinator.execute(executionRequest);
      sendJson(response, 200, { ...summary, ledger: runtime.ledger.snapshot() });
      return;
    }

    sendJson(response, 404, { ok: false, message: "Route not found in trading app." });
  } catch (error: unknown) {
    sendJson(response, error instanceof z.ZodError ? 400 : 500, {
      ok: false,
      message: error instanceof Error ? error.message : "Unknown stock trading app error."
    });
  }
}

function renderHomePage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OmniVest Stock Trading Harness</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f4f7f9; color: #17212b; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    header { padding: 24px 32px 18px; background: #0f1f2e; color: white; }
    main { max-width: 1180px; margin: 0 auto; padding: 24px; display: grid; gap: 18px; }
    h1 { margin: 0 0 6px; font-size: 28px; letter-spacing: 0; }
    section { background: white; border: 1px solid #dce4ea; border-radius: 8px; padding: 18px; }
    label { display: grid; gap: 6px; font-weight: 650; }
    input, textarea { width: 100%; border: 1px solid #b8c5cf; border-radius: 6px; padding: 10px 12px; font: inherit; }
    textarea { min-height: 156px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    button { border: 0; border-radius: 6px; padding: 10px 14px; background: #116149; color: white; font-weight: 700; cursor: pointer; }
    button.secondary { background: #28445c; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .controls { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 14px; }
    pre { margin: 0; min-height: 180px; white-space: pre-wrap; overflow-wrap: anywhere; background: #101820; color: #e8f2f2; border-radius: 8px; padding: 14px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; border-bottom: 1px solid #e1e8ed; padding: 10px 8px; }
    @media (max-width: 820px) { main { padding: 16px; } .grid, .controls { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <h1>OmniVest Stock Trading Harness</h1>
    <p>Mock portfolio, rebalance math, slippage guard, order routing, and ledger state transitions.</p>
  </header>
  <main>
    <section>
      <h2>Mock Portfolio</h2>
      <div id="portfolio"></div>
    </section>
    <section class="grid">
      <div>
        <h2>Target Allocation</h2>
        <div class="controls">
          <label>Cash Buffer <input id="cashBuffer" value="500.00"></label>
          <label>Minimum Trade <input id="minimumTradeNotional" value="25.00"></label>
          <label>Max Slippage Bps <input id="maxSlippageBps" type="number" value="150"></label>
        </div>
        <label>Targets JSON
          <textarea id="targets">[
  { "ticker": "AAPL", "weight": 0.40 },
  { "ticker": "MSFT", "weight": 0.45 },
  { "ticker": "NVDA", "weight": 0.15 }
]</textarea>
        </label>
        <div style="display:flex; gap:10px; margin-top: 14px;">
          <button id="rebalanceButton">Calculate Rebalance</button>
          <button id="executeButton" class="secondary" disabled>Run Mock Execution</button>
        </div>
      </div>
      <div>
        <h2>Response</h2>
        <pre id="output">Ready.</pre>
      </div>
    </section>
  </main>
  <script>
    const output = document.getElementById("output");
    const executeButton = document.getElementById("executeButton");
    async function requestJson(url, options) {
      const response = await fetch(url, options);
      const payload = await response.json();
      output.textContent = JSON.stringify(payload, null, 2);
      if (!response.ok) throw new Error(payload.message || "Request failed");
      return payload;
    }
    async function loadPortfolio() {
      const portfolio = await fetch("/api/mock/portfolio").then((response) => response.json());
      document.getElementById("portfolio").innerHTML = "<table><thead><tr><th>Ticker</th><th>Quantity</th><th>Market Value</th><th>Fractional</th></tr></thead><tbody>" +
        portfolio.positions.map((position) => "<tr><td>" + position.ticker + "</td><td>" + position.quantity + "</td><td>$" + position.marketValue.amount + "</td><td>" + position.fractionalTradingAllowed + "</td></tr>").join("") +
        "</tbody></table>";
    }
    document.getElementById("rebalanceButton").addEventListener("click", async () => {
      executeButton.disabled = true;
      const body = {
        cashBuffer: document.getElementById("cashBuffer").value,
        minimumTradeNotional: document.getElementById("minimumTradeNotional").value,
        maxSlippageBps: Number(document.getElementById("maxSlippageBps").value),
        targets: JSON.parse(document.getElementById("targets").value)
      };
      const payload = await requestJson("/api/rebalance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      executeButton.disabled = !(payload.ok && payload.plan.orders.length > 0);
    });
    executeButton.addEventListener("click", async () => { await requestJson("/api/execute", { method: "POST" }); });
    loadPortfolio().catch((error) => { output.textContent = error.message; });
  </script>
</body>
</html>`;
}

function serializePortfolio(value: UserPortfolio): Record<string, unknown> {
  return {
    userId: value.userId,
    accountId: value.accountId,
    equityValue: serializeMoney(value.equityValue),
    liquidCash: serializeMoney(value.liquidCash),
    positions: value.positions.map((position) => ({
      ...position,
      marketValue: serializeMoney(position.marketValue),
      averagePrice: serializeMoney(position.averagePrice)
    }))
  };
}

function serializeRebalanceResult(result: ReturnType<PortfolioRebalanceService["calculate"]>): Record<string, unknown> {
  if (!result.ok) {
    return { ok: false, fault: result.fault };
  }

  return {
    ok: true,
    plan: {
      ...result.plan,
      projectedCashAfterBuys: serializeMoney(result.plan.projectedCashAfterBuys),
      totalBuyNotional: serializeMoney(result.plan.totalBuyNotional),
      totalSellNotional: serializeMoney(result.plan.totalSellNotional),
      orders: result.plan.orders.map((order) => ({
        ...order,
        notional: order.notional ? serializeMoney(order.notional) : null,
        limitPrice: order.limitPrice ? serializeMoney(order.limitPrice) : null
      }))
    }
  };
}

function serializeMoney(value: Money): Record<string, string> {
  return {
    currency: value.currency,
    amount: moneyToDecimalString(value),
    minor: value.minor.toString()
  };
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody.length === 0 ? {} : JSON.parse(rawBody);
}

class MockBrokerageAdapter implements IBrokerageAdapter {
  public constructor(
    private readonly userPortfolio: UserPortfolio,
    private readonly accountPositions: readonly Position[]
  ) {}

  public validateConnection(): Promise<ConnectionValidation> {
    return Promise.resolve({ status: "VALID", provider: "AGGREGATION", checkedAt: new Date() });
  }

  public getPortfolioBalance(): Promise<PortfolioBalance> {
    return Promise.resolve({
      accountId: this.userPortfolio.accountId,
      equityValue: this.userPortfolio.equityValue,
      liquidCash: this.userPortfolio.liquidCash,
      buyingPower: this.userPortfolio.liquidCash,
      asOf: new Date()
    });
  }

  public getCurrentPositions(): Promise<readonly Position[]> {
    return Promise.resolve(this.accountPositions);
  }

  public executeBatchOrders(orders: readonly OrderPayload[]): Promise<readonly BrokerOrderResult[]> {
    return Promise.resolve(orders.map((order) => ({
      clientOrderId: order.clientOrderId,
      brokerOrderId: `mock-${order.clientOrderId.slice(0, 8)}`,
      status: "ACCEPTED",
      acceptedAt: new Date(),
      message: "Accepted by local mock broker."
    })));
  }
}

class StaticQuoteProvider implements QuoteProvider {
  public constructor(private readonly prices: ReadonlyMap<string, Money>) {}

  public getLatestQuote(ticker: string): Promise<MarketQuote> {
    const price = this.prices.get(ticker);
    if (!price) {
      return Promise.reject(new Error(`No mock quote configured for ${ticker}.`));
    }
    return Promise.resolve({ ticker, bid: price, ask: price, last: price, asOf: new Date() });
  }
}

class InMemoryDistributedLock implements DistributedLock {
  private readonly activeLocks = new Set<string>();

  public acquire(key: string): Promise<LockLease | null> {
    if (this.activeLocks.has(key)) {
      return Promise.resolve(null);
    }
    this.activeLocks.add(key);
    return Promise.resolve({
      key,
      release: () => {
        this.activeLocks.delete(key);
        return Promise.resolve();
      }
    });
  }
}

class InMemoryOrderLedgerRepository implements OrderLedgerRepository {
  private readonly records = new Map<string, Record<string, unknown>>();
  private readonly alerts: Record<string, unknown>[] = [];

  public createPendingOrder(sequenceId: string, order: OrderPayload): Promise<void> {
    if (this.records.has(order.clientOrderId)) {
      return Promise.resolve();
    }
    this.records.set(order.clientOrderId, {
      sequenceId,
      clientOrderId: order.clientOrderId,
      ticker: order.ticker,
      side: order.side,
      state: "PENDING",
      metadata: {}
    });
    return Promise.resolve();
  }

  public transitionOrder(clientOrderId: string, from: OrderLifecycleState, to: OrderLifecycleState, metadata: OrderMetadata): Promise<boolean> {
    const record = this.records.get(clientOrderId);
    if (!record || record["state"] !== from) {
      return Promise.resolve(false);
    }
    this.records.set(clientOrderId, this.withState(record, to, metadata));
    return Promise.resolve(true);
  }

  public markOrderState(clientOrderId: string, state: OrderLifecycleState, metadata: OrderMetadata): Promise<void> {
    const record = this.records.get(clientOrderId) ?? { clientOrderId, metadata: {} };
    this.records.set(clientOrderId, this.withState(record, state, metadata));
    return Promise.resolve();
  }

  public appendBrokerResult(clientOrderId: string, result: BrokerOrderResult): Promise<void> {
    const record = this.records.get(clientOrderId) ?? { clientOrderId, metadata: {} };
    this.records.set(clientOrderId, {
      ...record,
      brokerOrderId: result.brokerOrderId ?? null,
      brokerStatus: result.status,
      brokerMessage: result.message ?? null
    });
    return Promise.resolve();
  }

  public markSequenceAlert(sequenceId: string, reason: string, metadata: OrderMetadata): Promise<void> {
    this.alerts.push({ sequenceId, reason, metadata, createdAt: new Date().toISOString() });
    return Promise.resolve();
  }

  public snapshot(): Record<string, unknown> {
    return { orders: Array.from(this.records.values()), alerts: this.alerts };
  }

  private withState(record: Record<string, unknown>, state: OrderLifecycleState, metadata: OrderMetadata): Record<string, unknown> {
    const existingMetadata = isRecord(record["metadata"]) ? record["metadata"] : {};
    return { ...record, state, metadata: { ...existingMetadata, ...metadata }, updatedAt: new Date().toISOString() };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ledger = new InMemoryOrderLedgerRepository();
const runtime = {
  rebalanceService: new PortfolioRebalanceService(),
  ledger,
  coordinator: new OrderExecutionCoordinator(new InMemoryDistributedLock(), ledger, new StaticQuoteProvider(referencePrices)),
  brokerageAdapter: new MockBrokerageAdapter(portfolio, positions)
};

server.listen(PORT, "127.0.0.1", () => {
  console.log(`OmniVest Stock Trading Harness: http://127.0.0.1:${String(PORT)}/`);
});
