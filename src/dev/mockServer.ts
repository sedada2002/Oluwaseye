import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { z } from "zod";
import {
  agentBlueprints,
  firmPositioning,
  promptFrameworks,
  servicePackages,
  sprintRoadmap
} from "../consultingFirm/firmAssets.js";
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
import { defaultIndustries, defaultVirginiaAreas, industryLabels } from "../prospecting/catalog.js";
import { ProspectStore } from "../prospecting/ProspectStore.js";
import { VirginiaProspectFinder } from "../prospecting/VirginiaProspectFinder.js";
import type { ProspectFinderOptions, ProspectIndustry, ProspectSearchArea, ProspectStoreRecord } from "../prospecting/types.js";
import { fortuneItCustomerFacingTargets } from "../recruiting/companyCatalog.js";
import { JobPostingFinder } from "../recruiting/JobPostingFinder.js";
import { JobPostingStore } from "../recruiting/JobPostingStore.js";
import {
  moneyToDecimalString,
  usdFromDecimal,
  weightFromDecimal,
  type Money
} from "../shared/money.js";

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

const prospectRunRequestSchema = z.object({
  cities: z.array(z.string().trim().min(1)).default([]),
  industries: z.array(z.string().trim().min(1)).default([]),
  maxResultsPerQuery: z.number().int().min(1).max(50).default(10),
  minScore: z.number().int().min(0).max(100).default(50),
  includeSeeds: z.boolean().default(true)
});

const recruitingRunRequestSchema = z.object({
  query: z.string().trim().min(2).default("AI IT cloud cybersecurity customer success support engineer"),
  maxJobsPerCompany: z.number().int().min(1).max(100).default(10)
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

interface RuntimeContext {
  readonly rebalanceService: PortfolioRebalanceService;
  readonly ledger: InMemoryOrderLedgerRepository;
  readonly coordinator: OrderExecutionCoordinator;
  readonly brokerageAdapter: MockBrokerageAdapter;
}

let lastOrders: readonly OrderPayload[] = [];
let lastMaxSlippageBps = 150;
const prospectStore = new ProspectStore();
const jobPostingStore = new JobPostingStore();

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

    if (request.method === "GET" && requestUrl.pathname === "/prospects") {
      sendHtml(response, renderProspectsPage());
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/consulting") {
      sendHtml(response, renderConsultingFirmPage());
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/recruiting") {
      sendHtml(response, renderRecruitingPage());
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        service: "omnivest-local-test-harness",
        links: {
          dashboard: "/",
          prospects: "/prospects",
          consulting: "/consulting",
          recruiting: "/recruiting",
          portfolio: "/api/mock/portfolio",
          rebalance: "/api/rebalance",
          execute: "/api/execute"
        }
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/prospects/store") {
      const records = await prospectStore.read();
      sendJson(response, 200, {
        ok: true,
        records,
        nextSuggestedPullAt: getNextSuggestedPullAt(records)
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/consulting/assets") {
      sendJson(response, 200, {
        ok: true,
        firmPositioning,
        servicePackages,
        agentBlueprints,
        promptFrameworks,
        sprintRoadmap
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/recruiting/jobs") {
      const records = await jobPostingStore.read();
      sendJson(response, 200, {
        ok: true,
        records,
        targetCompanies: fortuneItCustomerFacingTargets
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/recruiting/jobs/run") {
      const body = recruitingRunRequestSchema.parse(await readJson(request));
      const jobs = await new JobPostingFinder().find({
        companies: fortuneItCustomerFacingTargets,
        query: body.query,
        maxJobsPerCompany: body.maxJobsPerCompany
      });
      const store = await jobPostingStore.merge(jobs);
      sendJson(response, 200, {
        ok: true,
        pulled: jobs.length,
        newCount: store.newRecords.length,
        updatedCount: store.updatedRecords.length,
        totalStored: store.allRecords.length,
        storePath: store.storePath,
        records: store.allRecords
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/prospects/run") {
      const body = prospectRunRequestSchema.parse(await readJson(request));
      const options = toProspectFinderOptions(body);
      const result = await new VirginiaProspectFinder().run(options);
      sendJson(response, 200, {
        ok: true,
        runId: result.runId,
        pulled: result.prospects.length,
        newCount: result.store.newRecords.length,
        updatedCount: result.store.updatedRecords.length,
        totalStored: result.store.allRecords.length,
        csvPath: result.files.csvPath,
        jsonPath: result.files.jsonPath,
        storePath: result.store.storePath,
        nextSuggestedPullAt: getNextSuggestedPullAt(result.store.allRecords),
        records: result.store.allRecords
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
        sendJson(response, 409, {
          ok: false,
          message: "Create a successful rebalance plan before executing mock orders."
        });
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
      sendJson(response, 200, {
        ...summary,
        ledger: runtime.ledger.snapshot()
      });
      return;
    }

    sendJson(response, 404, { ok: false, message: "Route not found." });
  } catch (error: unknown) {
    const statusCode = error instanceof z.ZodError ? 400 : 500;
    sendJson(response, statusCode, {
      ok: false,
      message: error instanceof Error ? error.message : "Unknown local test server error."
    });
  }
}

function renderHomePage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OmniVest Local Test Harness</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f4f7f9;
      color: #17212b;
    }
    * { box-sizing: border-box; }
    body { margin: 0; }
    header { padding: 24px 32px 18px; background: #0f1f2e; color: #ffffff; }
    main { max-width: 1180px; margin: 0 auto; padding: 24px; display: grid; gap: 18px; }
    h1 { margin: 0 0 6px; font-size: 28px; font-weight: 700; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 18px; letter-spacing: 0; }
    p { margin: 0; color: #5d6b78; line-height: 1.5; }
    header p { color: #c7d5df; }
    section { background: #ffffff; border: 1px solid #dce4ea; border-radius: 8px; padding: 18px; }
    label { display: grid; gap: 6px; font-weight: 650; color: #26323d; }
    input, textarea { width: 100%; border: 1px solid #b8c5cf; border-radius: 6px; padding: 10px 12px; font: inherit; }
    textarea { min-height: 156px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    button { border: 0; border-radius: 6px; padding: 10px 14px; background: #116149; color: #ffffff; font-weight: 700; cursor: pointer; }
    button.secondary { background: #28445c; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .controls { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 14px; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .links { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
    .links a { color: #7ad3b4; font-weight: 700; }
    pre { margin: 0; min-height: 180px; white-space: pre-wrap; overflow-wrap: anywhere; background: #101820; color: #e8f2f2; border-radius: 8px; padding: 14px; font-size: 13px; line-height: 1.45; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; border-bottom: 1px solid #e1e8ed; padding: 10px 8px; }
    th { color: #52616d; font-size: 12px; text-transform: uppercase; }
    @media (max-width: 820px) {
      header { padding: 22px 20px 16px; }
      main { padding: 16px; }
      .grid, .controls { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>OmniVest Local Test Harness</h1>
    <p>Mock portfolio, rebalance math, slippage guard, order routing, and ledger state transitions.</p>
    <div class="links">
      <a href="/api/health">Health JSON</a>
      <a href="/api/mock/portfolio">Mock Portfolio JSON</a>
      <a href="/prospects">Virginia Prospect Finder</a>
      <a href="/consulting">Consulting Firm OS</a>
      <a href="/recruiting">Recruiting Intelligence</a>
    </div>
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
          <label>Cash Buffer
            <input id="cashBuffer" value="500.00">
          </label>
          <label>Minimum Trade
            <input id="minimumTradeNotional" value="25.00">
          </label>
          <label>Max Slippage Bps
            <input id="maxSlippageBps" type="number" value="150">
          </label>
        </div>
        <label>Targets JSON
          <textarea id="targets">[
  { "ticker": "AAPL", "weight": 0.40 },
  { "ticker": "MSFT", "weight": 0.45 },
  { "ticker": "NVDA", "weight": 0.15 }
]</textarea>
        </label>
        <div class="actions" style="margin-top: 14px;">
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
      if (!response.ok) {
        throw new Error(payload.message || "Request failed");
      }
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
      const payload = await requestJson("/api/rebalance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      executeButton.disabled = !(payload.ok && payload.plan.orders.length > 0);
    });

    executeButton.addEventListener("click", async () => {
      await requestJson("/api/execute", { method: "POST" });
    });

    loadPortfolio().catch((error) => {
      output.textContent = error.message;
    });
  </script>
</body>
</html>`;
}

function renderProspectsPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Virginia AI/IT Prospect Finder</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f5f7f8;
      color: #16212a;
    }
    * { box-sizing: border-box; }
    body { margin: 0; }
    header { padding: 22px 30px 16px; background: #10251f; color: #ffffff; }
    main { max-width: 1320px; margin: 0 auto; padding: 22px; display: grid; gap: 16px; }
    h1 { margin: 0 0 6px; font-size: 28px; font-weight: 750; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 18px; letter-spacing: 0; }
    h3 { margin: 0 0 8px; font-size: 15px; letter-spacing: 0; }
    p { margin: 0; color: #596875; line-height: 1.45; }
    header p { color: #c8d8d2; }
    a { color: inherit; }
    .links { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
    .links a { color: #9ee3c8; font-weight: 750; }
    section, aside { background: #ffffff; border: 1px solid #dbe4e7; border-radius: 8px; padding: 16px; }
    .layout { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(320px, 0.9fr); gap: 16px; align-items: start; }
    .controls { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    label { display: grid; gap: 6px; font-weight: 700; color: #27343d; font-size: 13px; }
    input, textarea, select { width: 100%; border: 1px solid #b8c6cc; border-radius: 6px; padding: 10px 11px; font: inherit; background: #ffffff; }
    textarea { min-height: 132px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; }
    button { border: 0; border-radius: 6px; padding: 10px 13px; background: #126049; color: #ffffff; font-weight: 800; cursor: pointer; }
    button.secondary { background: #2d4a63; }
    button:disabled { opacity: 0.55; cursor: wait; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 12px; }
    .status { font-size: 13px; color: #566672; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .metric { border: 1px solid #e0e8eb; border-radius: 8px; padding: 12px; background: #fbfcfd; }
    .metric strong { display: block; font-size: 24px; color: #15251f; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; border-bottom: 1px solid #e2e9ec; padding: 9px 8px; vertical-align: top; }
    th { color: #52616d; font-size: 11px; text-transform: uppercase; position: sticky; top: 0; background: #ffffff; }
    tr { cursor: pointer; }
    tr:hover { background: #f4faf7; }
    .table-wrap { max-height: 520px; overflow: auto; border: 1px solid #e0e8eb; border-radius: 8px; }
    .tier { display: inline-grid; min-width: 26px; height: 26px; place-items: center; border-radius: 999px; background: #dff4ea; color: #0c5a41; font-weight: 850; }
    .muted { color: #687883; }
    .email { color: #0f5d8c; font-weight: 750; overflow-wrap: anywhere; }
    .draft { display: grid; gap: 10px; }
    .draft-card { border: 1px solid #e0e8eb; border-radius: 8px; padding: 12px; background: #fbfcfd; }
    .draft-card textarea { min-height: 220px; }
    .industry-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
    .check { display: flex; gap: 8px; align-items: center; font-weight: 650; }
    .check input { width: auto; }
    @media (max-width: 980px) {
      header { padding: 20px; }
      main { padding: 14px; }
      .layout, .controls, .stats { grid-template-columns: 1fr; }
      .industry-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Virginia AI/IT Prospect Finder</h1>
    <p>Pull Virginia prospects weekly, score AI automation fit, discover public website emails, and prepare domain-specific outreach drafts.</p>
    <div class="links">
      <a href="/">OmniVest Dashboard</a>
      <a href="/consulting">Consulting Firm OS</a>
      <a href="/api/prospects/store">Prospect Store JSON</a>
      <a href="/api/health">Health JSON</a>
    </div>
  </header>
  <main>
    <section>
      <h2>Weekly Pull Controls</h2>
      <div class="controls">
        <label>Cities
          <input id="cities" value="Richmond,Norfolk,Chesapeake,Alexandria,Arlington,Fairfax">
        </label>
        <label>Results Per Query
          <input id="limit" type="number" min="1" max="50" value="10">
        </label>
        <label>Minimum Score
          <input id="minScore" type="number" min="0" max="100" value="50">
        </label>
        <label>Seed Examples
          <select id="includeSeeds">
            <option value="true">Include when no API key</option>
            <option value="false">Live data only</option>
          </select>
        </label>
      </div>
      <div class="industry-grid" id="industryGrid"></div>
      <div class="actions">
        <button id="runButton">Run Incremental Pull</button>
        <button id="refreshButton" class="secondary">Refresh Stored Prospects</button>
        <span class="status" id="status">Ready.</span>
      </div>
    </section>
    <section class="stats">
      <div class="metric"><span class="muted">Stored Prospects</span><strong id="storedCount">0</strong></div>
      <div class="metric"><span class="muted">With Emails</span><strong id="emailCount">0</strong></div>
      <div class="metric"><span class="muted">A/B Tier</span><strong id="hotCount">0</strong></div>
      <div class="metric"><span class="muted">Next Pull</span><strong id="nextPull" style="font-size: 15px;">Not scheduled</strong></div>
    </section>
    <div class="layout">
      <section>
        <h2>Prospects</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Tier</th><th>Business</th><th>Industry</th><th>Email</th><th>Offer</th><th>Signals</th></tr>
            </thead>
            <tbody id="prospectRows"></tbody>
          </table>
        </div>
      </section>
      <aside>
        <h2>Daily Outreach Drafts</h2>
        <div id="draftPanel" class="draft">
          <p>Select a prospect to preview the daily email sequence. Review each draft before sending and honor opt-out requests.</p>
        </div>
      </aside>
    </div>
  </main>
  <script>
    const industries = ${JSON.stringify(defaultIndustries.map((industry) => ({ id: industry, label: industryLabels[industry] })))};
    let records = [];
    const status = document.getElementById("status");

    function initIndustries() {
      const grid = document.getElementById("industryGrid");
      grid.innerHTML = industries.map((industry) =>
        '<label class="check"><input type="checkbox" value="' + industry.id + '" checked> ' + industry.label + '</label>'
      ).join("");
    }

    async function requestJson(url, options) {
      const response = await fetch(url, options);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || "Request failed");
      }
      return payload;
    }

    function selectedIndustries() {
      return Array.from(document.querySelectorAll('#industryGrid input:checked')).map((input) => input.value);
    }

    function runBody() {
      return {
        cities: document.getElementById("cities").value.split(",").map((city) => city.trim()).filter(Boolean),
        industries: selectedIndustries(),
        maxResultsPerQuery: Number(document.getElementById("limit").value),
        minScore: Number(document.getElementById("minScore").value),
        includeSeeds: document.getElementById("includeSeeds").value === "true"
      };
    }

    async function runPull() {
      const button = document.getElementById("runButton");
      button.disabled = true;
      status.textContent = "Pulling prospects, checking websites, and extracting emails...";
      try {
        const payload = await requestJson("/api/prospects/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(runBody())
        });
        records = payload.records;
        renderRecords(payload.nextSuggestedPullAt);
        status.textContent = "Done. New: " + payload.newCount + ", updated: " + payload.updatedCount + ". CSV: " + payload.csvPath;
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    }

    async function loadStore() {
      status.textContent = "Loading stored prospects...";
      const payload = await requestJson("/api/prospects/store");
      records = payload.records;
      renderRecords(payload.nextSuggestedPullAt);
      status.textContent = "Ready.";
    }

    function renderRecords(nextSuggestedPullAt) {
      document.getElementById("storedCount").textContent = String(records.length);
      document.getElementById("emailCount").textContent = String(records.filter((record) => record.primaryEmail).length);
      document.getElementById("hotCount").textContent = String(records.filter((record) => record.fitTier === "A" || record.fitTier === "B").length);
      document.getElementById("nextPull").textContent = nextSuggestedPullAt ? new Date(nextSuggestedPullAt).toLocaleDateString() : "After first pull";
      document.getElementById("prospectRows").innerHTML = records.map((record, index) => {
        const signals = record.websiteProfile && record.websiteProfile.signals ? record.websiteProfile.signals.map((signal) => signal.keyword).join(", ") : "";
        return '<tr data-index="' + index + '"><td><span class="tier">' + record.fitTier + '</span><div class="muted">' + record.aiAutomationScore + '</div></td><td><strong>' + escapeHtml(record.name) + '</strong><div class="muted">' + escapeHtml(record.city) + ', VA</div><div><a href="' + escapeHtml(record.website || "#") + '" target="_blank">Website</a></div></td><td>' + escapeHtml(record.industry) + '</td><td class="email">' + escapeHtml(record.primaryEmail || record.primaryPhone || "No contact found") + '<div class="muted">' + escapeHtml(record.outreachChannel || "research-needed") + '</div></td><td>' + escapeHtml(record.recommendedOffer) + '</td><td>' + escapeHtml(signals || "Review needed") + '</td></tr>';
      }).join("");
      document.querySelectorAll("#prospectRows tr").forEach((row) => {
        row.addEventListener("click", () => renderDraft(records[Number(row.dataset.index)]));
      });
    }

    function renderDraft(record) {
      const emails = record.websiteProfile && record.websiteProfile.emails ? record.websiteProfile.emails.join(", ") : "No email found";
      const phones = record.websiteProfile && record.websiteProfile.phones ? record.websiteProfile.phones.join(", ") : "No phone found";
      const script = record.coldCallScript;
      const callPanel = script ? '<div class="draft-card"><h3>Cold Call Script</h3><label>Script<textarea>' + escapeHtml(script.objective + '\\n\\nOpener:\\n' + script.opener + '\\n\\nQuestions:\\n- ' + script.qualifyingQuestions.join('\\n- ') + '\\n\\nPitch:\\n' + script.valuePitch + '\\n\\nVoicemail:\\n' + script.voicemail + '\\n\\nFollow-up:\\n' + script.followUpNote) + '</textarea></label></div>' : '';
      document.getElementById("draftPanel").innerHTML =
        '<h3>' + escapeHtml(record.name) + '</h3>' +
        '<p><strong>Channel:</strong> ' + escapeHtml(record.outreachChannel || "research-needed") + '</p>' +
        '<p><strong>Email:</strong> <span class="email">' + escapeHtml(emails) + '</span></p>' +
        '<p><strong>Phone:</strong> <span class="email">' + escapeHtml(record.primaryPhone || phones) + '</span></p>' +
        '<p><strong>Website:</strong> <a href="' + escapeHtml(record.website || "#") + '" target="_blank">' + escapeHtml(record.website || "No website") + '</a></p>' +
        callPanel +
        record.outreachDrafts.map((draft) =>
          '<div class="draft-card"><h3>Day ' + draft.day + ': ' + escapeHtml(draft.serviceFocus) + '</h3>' +
          '<label>Subject<input value="' + escapeAttribute(draft.subject) + '"></label>' +
          '<label style="margin-top: 8px;">Body<textarea>' + escapeHtml(draft.body) + '</textarea></label></div>'
        ).join("");
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }

    function escapeAttribute(value) {
      return escapeHtml(value).replace(/\\n/g, " ");
    }

    document.getElementById("runButton").addEventListener("click", runPull);
    document.getElementById("refreshButton").addEventListener("click", loadStore);
    initIndustries();
    loadStore().catch((error) => {
      status.textContent = error.message;
    });
  </script>
</body>
</html>`;
}

function renderConsultingFirmPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${firmPositioning.name} Consulting OS</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f8f7;
      color: #17231f;
    }
    * { box-sizing: border-box; }
    body { margin: 0; }
    header { padding: 28px 32px 22px; background: #10241f; color: #ffffff; }
    main { max-width: 1320px; margin: 0 auto; padding: 22px; display: grid; gap: 16px; }
    h1 { margin: 0 0 8px; font-size: 32px; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 19px; letter-spacing: 0; }
    h3 { margin: 0 0 8px; font-size: 15px; letter-spacing: 0; }
    p { margin: 0; color: #596a63; line-height: 1.5; }
    header p { color: #c8d8d2; max-width: 900px; }
    section { background: #ffffff; border: 1px solid #dce6e1; border-radius: 8px; padding: 16px; }
    .links { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 14px; }
    .links a { color: #9de4c8; font-weight: 800; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .three { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .card { border: 1px solid #e1e9e5; border-radius: 8px; padding: 14px; background: #fbfcfc; }
    .price { color: #0d684c; font-weight: 850; margin-bottom: 8px; }
    ul, ol { margin: 10px 0 0; padding-left: 20px; color: #33423d; line-height: 1.5; }
    .pill-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .pill { background: #e3f4ec; color: #0d5e45; border: 1px solid #c5e6d8; border-radius: 999px; padding: 7px 10px; font-size: 13px; font-weight: 800; }
    textarea { width: 100%; min-height: 148px; border: 1px solid #bdcbc5; border-radius: 6px; padding: 10px; resize: vertical; font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; color: #17231f; background: #ffffff; }
    .hero-strip { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.6fr); gap: 16px; align-items: stretch; }
    .metric { display: grid; gap: 8px; align-content: center; border: 1px solid #d8e8df; background: #eef8f2; border-radius: 8px; padding: 16px; }
    .metric strong { font-size: 34px; color: #0d5e45; }
    @media (max-width: 900px) {
      header { padding: 22px 18px; }
      main { padding: 14px; }
      .grid, .three, .hero-strip { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>${firmPositioning.name}</h1>
    <p>${firmPositioning.headline}</p>
    <p style="margin-top: 8px;">${firmPositioning.subheadline}</p>
    <div class="links">
      <a href="/prospects">Prospect Finder</a>
      <a href="/recruiting">Recruiting Intelligence</a>
      <a href="/api/consulting/assets">Assets JSON</a>
      <a href="/">OmniVest Dashboard</a>
    </div>
  </header>
  <main>
    <section class="hero-strip">
      <div>
        <h2>Operating Thesis</h2>
        <p>Most businesses do not need vague AI hype. They need AI literacy, clear protocols, transparent agents, stronger customer experience, and implementation that reaches the market quickly.</p>
        <div class="pill-row">
          ${firmPositioning.principles.map((principle) => `<span class="pill">${escapeHtml(principle)}</span>`).join("")}
        </div>
      </div>
      <div class="metric">
        <span>First Client Offer Target</span>
        <strong>$5K-$20K</strong>
        <p>Audit, buildout, training, then monthly support.</p>
      </div>
    </section>
    <section>
      <h2>Premium Service Ladder</h2>
      <div class="grid">
        ${servicePackages.map((offer) => `
          <div class="card">
            <h3>${escapeHtml(offer.name)}</h3>
            <div class="price">${escapeHtml(offer.priceRange)}</div>
            <p>${escapeHtml(offer.promise)}</p>
            <ul>${offer.deliverables.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
            <p style="margin-top: 10px;"><strong>Best for:</strong> ${escapeHtml(offer.bestFor)}</p>
          </div>
        `).join("")}
      </div>
    </section>
    <section>
      <h2>Agent Blueprint Library</h2>
      <div class="grid">
        ${agentBlueprints.map((agent) => `
          <div class="card">
            <h3>${escapeHtml(agent.name)}</h3>
            <p>${escapeHtml(agent.purpose)}</p>
            <ol>${agent.protocol.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
            <p style="margin-top: 10px;"><strong>Transparency:</strong> ${escapeHtml(agent.transparencyMetric)}</p>
          </div>
        `).join("")}
      </div>
    </section>
    <section>
      <h2>Prompt Frameworks</h2>
      <div class="three">
        ${promptFrameworks.map((prompt) => `
          <div class="card">
            <h3>${escapeHtml(prompt.name)}</h3>
            <p>${escapeHtml(prompt.useCase)}</p>
            <textarea readonly>${escapeHtml(prompt.instruction)}</textarea>
          </div>
        `).join("")}
      </div>
    </section>
    <section>
      <h2>30-Day Execution Sprint</h2>
      <ol>${sprintRoadmap.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
    </section>
  </main>
</body>
</html>`;
}

function renderRecruitingPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Recruiting Intelligence Agent</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f8f9;
      color: #17212b;
    }
    * { box-sizing: border-box; }
    body { margin: 0; }
    header { padding: 24px 32px 18px; background: #142334; color: #ffffff; }
    main { max-width: 1320px; margin: 0 auto; padding: 22px; display: grid; gap: 16px; }
    h1 { margin: 0 0 8px; font-size: 30px; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 19px; letter-spacing: 0; }
    h3 { margin: 0 0 8px; font-size: 15px; letter-spacing: 0; }
    p { margin: 0; color: #5d6b78; line-height: 1.5; }
    header p { color: #cad7e2; }
    section, aside { background: #ffffff; border: 1px solid #dce5eb; border-radius: 8px; padding: 16px; }
    .links { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
    .links a { color: #9fd7ff; font-weight: 800; }
    .controls { display: grid; grid-template-columns: minmax(0, 1fr) 180px; gap: 12px; align-items: end; }
    label { display: grid; gap: 6px; font-weight: 750; color: #263542; }
    input, textarea { width: 100%; border: 1px solid #b8c6cf; border-radius: 6px; padding: 10px 11px; font: inherit; }
    textarea { min-height: 190px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; }
    button { border: 0; border-radius: 6px; padding: 10px 13px; background: #155f8a; color: #ffffff; font-weight: 850; cursor: pointer; }
    button.secondary { background: #2c485e; }
    button:disabled { opacity: 0.55; cursor: wait; }
    .layout { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(330px, 0.9fr); gap: 16px; align-items: start; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .metric { border: 1px solid #e0e8ee; border-radius: 8px; padding: 12px; background: #fbfcfd; }
    .metric strong { display: block; font-size: 24px; color: #164866; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; border-bottom: 1px solid #e1e9ef; padding: 9px 8px; vertical-align: top; }
    th { color: #52616d; font-size: 11px; text-transform: uppercase; position: sticky; top: 0; background: #ffffff; }
    tr { cursor: pointer; }
    tr:hover { background: #f4f9fc; }
    .table-wrap { max-height: 540px; overflow: auto; border: 1px solid #e0e8ee; border-radius: 8px; }
    .status { color: #596a76; font-size: 13px; margin-top: 10px; }
    .notice { border: 1px solid #d6e7f2; background: #eef7fc; border-radius: 8px; padding: 12px; }
    @media (max-width: 980px) {
      header { padding: 20px; }
      main { padding: 14px; }
      .layout, .controls, .stats { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Recruiting Intelligence Agent</h1>
    <p>Monitor approved company career sources, draft LinkedIn reposts, and prepare candidate outreach from opted-in talent lists.</p>
    <div class="links">
      <a href="/consulting">Consulting Firm OS</a>
      <a href="/prospects">Prospect Finder</a>
      <a href="/api/recruiting/jobs">Job Store JSON</a>
    </div>
  </header>
  <main>
    <section class="notice">
      <p><strong>Compliance guardrail:</strong> this system stores source URLs and drafts posts/messages for review. Use approved company career sources, official APIs/feeds where available, and candidate lists where people consented to recruiting outreach.</p>
    </section>
    <section>
      <h2>Real-Time Job Signal Pull</h2>
      <div class="controls">
        <label>Target Role Keywords
          <input id="query" value="AI IT cloud cybersecurity customer success support engineer">
        </label>
        <label>Max Per Company
          <input id="limit" type="number" min="1" max="100" value="10">
        </label>
      </div>
      <div style="display:flex; gap:10px; margin-top:12px; flex-wrap:wrap;">
        <button id="runButton">Run Job Pull</button>
        <button id="refreshButton" class="secondary">Refresh Store</button>
      </div>
      <div class="status" id="status">Ready.</div>
    </section>
    <section class="stats">
      <div class="metric"><span>Stored Roles</span><strong id="storedCount">0</strong></div>
      <div class="metric"><span>New/Drafted</span><strong id="draftedCount">0</strong></div>
      <div class="metric"><span>Target Companies</span><strong id="companyCount">0</strong></div>
      <div class="metric"><span>LinkedIn Drafts</span><strong id="postCount">0</strong></div>
    </section>
    <div class="layout">
      <section>
        <h2>Job Signals</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Company</th><th>Role</th><th>Location</th><th>Status</th></tr></thead>
            <tbody id="jobRows"></tbody>
          </table>
        </div>
      </section>
      <aside>
        <h2>LinkedIn Repost Draft</h2>
        <div id="draftPanel"><p>Select a role to preview the LinkedIn repost draft.</p></div>
      </aside>
    </div>
  </main>
  <script>
    let records = [];
    let targetCompanies = [];
    const status = document.getElementById("status");

    async function requestJson(url, options) {
      const response = await fetch(url, options);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Request failed");
      return payload;
    }

    async function runPull() {
      document.getElementById("runButton").disabled = true;
      status.textContent = "Checking career sources and drafting reposts...";
      try {
        const payload = await requestJson("/api/recruiting/jobs/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: document.getElementById("query").value,
            maxJobsPerCompany: Number(document.getElementById("limit").value)
          })
        });
        records = payload.records;
        render();
        status.textContent = "Done. New: " + payload.newCount + ", updated: " + payload.updatedCount + ".";
      } catch (error) {
        status.textContent = error.message;
      } finally {
        document.getElementById("runButton").disabled = false;
      }
    }

    async function loadStore() {
      const payload = await requestJson("/api/recruiting/jobs");
      records = payload.records;
      targetCompanies = payload.targetCompanies;
      render();
    }

    function render() {
      document.getElementById("storedCount").textContent = String(records.length);
      document.getElementById("draftedCount").textContent = String(records.filter((record) => record.repostStatus === "drafted").length);
      document.getElementById("companyCount").textContent = String(targetCompanies.length);
      document.getElementById("postCount").textContent = String(records.filter((record) => record.linkedInDraft).length);
      document.getElementById("jobRows").innerHTML = records.map((record, index) =>
        '<tr data-index="' + index + '"><td><strong>' + escapeHtml(record.company) + '</strong><div><a href="' + escapeHtml(record.url) + '" target="_blank">Source</a></div></td><td>' + escapeHtml(record.title) + '</td><td>' + escapeHtml(record.location) + '</td><td>' + escapeHtml(record.repostStatus) + '</td></tr>'
      ).join("");
      document.querySelectorAll("#jobRows tr").forEach((row) => {
        row.addEventListener("click", () => renderDraft(records[Number(row.dataset.index)]));
      });
    }

    function renderDraft(record) {
      document.getElementById("draftPanel").innerHTML =
        '<h3>' + escapeHtml(record.title) + '</h3>' +
        '<p><strong>' + escapeHtml(record.company) + '</strong> · ' + escapeHtml(record.location) + '</p>' +
        '<p style="margin:8px 0;"><a href="' + escapeHtml(record.url) + '" target="_blank">Original source</a></p>' +
        '<label>Draft<textarea>' + escapeHtml(record.linkedInDraft) + '</textarea></label>';
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }

    document.getElementById("runButton").addEventListener("click", runPull);
    document.getElementById("refreshButton").addEventListener("click", loadStore);
    loadStore().catch((error) => { status.textContent = error.message; });
  </script>
</body>
</html>`;
}

function toProspectFinderOptions(body: z.infer<typeof prospectRunRequestSchema>): ProspectFinderOptions {
  const requestedCities = new Set(body.cities.map((city) => city.toLowerCase()));
  const areas: readonly ProspectSearchArea[] =
    requestedCities.size === 0
      ? defaultVirginiaAreas
      : defaultVirginiaAreas.filter((area) => requestedCities.has(area.city.toLowerCase()));
  const requestedIndustries = new Set(body.industries);
  const industries: readonly ProspectIndustry[] =
    requestedIndustries.size === 0
      ? defaultIndustries
      : defaultIndustries.filter((industry) => requestedIndustries.has(industry));

  return {
    areas: areas.length > 0 ? areas : defaultVirginiaAreas,
    industries: industries.length > 0 ? industries : defaultIndustries,
    maxResultsPerQuery: body.maxResultsPerQuery,
    minScore: body.minScore,
    includeSeeds: body.includeSeeds,
    outputDir: "output/prospecting"
  };
}

function getNextSuggestedPullAt(records: readonly ProspectStoreRecord[]): string | null {
  const latestSeenAt = records
    .map((record) => Date.parse(record.lastSeenAt))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => right - left)[0];

  if (latestSeenAt === undefined) {
    return null;
  }

  return new Date(latestSeenAt + 7 * 24 * 60 * 60 * 1000).toISOString();
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
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
  private readonly userPortfolio: UserPortfolio;
  private readonly accountPositions: readonly Position[];

  public constructor(userPortfolio: UserPortfolio, accountPositions: readonly Position[]) {
    this.userPortfolio = userPortfolio;
    this.accountPositions = accountPositions;
  }

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
  private readonly prices: ReadonlyMap<string, Money>;

  public constructor(prices: ReadonlyMap<string, Money>) {
    this.prices = prices;
  }

  public getLatestQuote(ticker: string): Promise<MarketQuote> {
    const price = this.prices.get(ticker);
    if (!price) {
      return Promise.reject(new Error(`No mock quote configured for ${ticker}.`));
    }

    return Promise.resolve({
      ticker,
      bid: price,
      ask: price,
      last: price,
      asOf: new Date()
    });
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
    return {
      orders: Array.from(this.records.values()),
      alerts: this.alerts
    };
  }

  private withState(record: Record<string, unknown>, state: OrderLifecycleState, metadata: OrderMetadata): Record<string, unknown> {
    const existingMetadata = isRecord(record["metadata"]) ? record["metadata"] : {};
    return {
      ...record,
      state,
      metadata: { ...existingMetadata, ...metadata },
      updatedAt: new Date().toISOString()
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const runtimeLedger = new InMemoryOrderLedgerRepository();
const runtime: RuntimeContext = {
  rebalanceService: new PortfolioRebalanceService(),
  ledger: runtimeLedger,
  coordinator: new OrderExecutionCoordinator(
    new InMemoryDistributedLock(),
    runtimeLedger,
    new StaticQuoteProvider(referencePrices)
  ),
  brokerageAdapter: new MockBrokerageAdapter(portfolio, positions)
};

server.listen(PORT, "127.0.0.1", () => {
  console.log(`OmniVest local test UI: http://127.0.0.1:${String(PORT)}/`);
  console.log(`Health check: http://127.0.0.1:${String(PORT)}/api/health`);
});
