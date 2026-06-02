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
import { defaultIndustries, defaultVirginiaAreas, industryLabels } from "../prospecting/catalog.js";
import { ProspectStore } from "../prospecting/ProspectStore.js";
import { VirginiaProspectFinder } from "../prospecting/VirginiaProspectFinder.js";
import type { ProspectFinderOptions, ProspectIndustry, ProspectSearchArea, ProspectStoreRecord } from "../prospecting/types.js";
import { fortuneItCustomerFacingTargets } from "../recruiting/companyCatalog.js";
import { JobPostingFinder } from "../recruiting/JobPostingFinder.js";
import { JobPostingStore } from "../recruiting/JobPostingStore.js";

const portArgument = process.argv.find((argument) => argument.startsWith("--port="));
const PORT = Number(portArgument?.slice("--port=".length) ?? process.env["AI_CONSULTING_PORT"] ?? "4280");

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

    if (request.method === "GET" && requestUrl.pathname === "/recruiting") {
      sendHtml(response, renderRecruitingPage());
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        service: "ai-consulting-firm-os",
        links: {
          home: "/",
          prospects: "/prospects",
          recruiting: "/recruiting",
          consultingAssets: "/api/consulting/assets",
          prospectStore: "/api/prospects/store",
          jobStore: "/api/recruiting/jobs"
        }
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

    if (request.method === "GET" && requestUrl.pathname === "/api/prospects/store") {
      const records = await prospectStore.read();
      sendJson(response, 200, {
        ok: true,
        records,
        nextSuggestedPullAt: getNextSuggestedPullAt(records)
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/prospects/run") {
      const body = prospectRunRequestSchema.parse(await readJson(request));
      const result = await new VirginiaProspectFinder().run(toProspectFinderOptions(body));
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

    sendJson(response, 404, { ok: false, message: "Route not found in consulting app." });
  } catch (error: unknown) {
    sendJson(response, error instanceof z.ZodError ? 400 : 500, {
      ok: false,
      message: error instanceof Error ? error.message : "Unknown consulting app error."
    });
  }
}

function renderHomePage(): string {
  return renderShell(
    "AI Consulting Firm OS",
    "Build and operate the AI/IT consulting business: offers, agent blueprints, prospecting, outreach drafts, and recruiting intelligence.",
    `<section>
      <h2>${escapeHtml(firmPositioning.name)}</h2>
      <p>${escapeHtml(firmPositioning.headline)}</p>
      <p>${escapeHtml(firmPositioning.subheadline)}</p>
      <div class="cards">
        ${servicePackages.map((offer) => `<article><h3>${escapeHtml(offer.name)}</h3><strong>${escapeHtml(offer.priceRange)}</strong><p>${escapeHtml(offer.promise)}</p></article>`).join("")}
      </div>
    </section>
    <section>
      <h2>Agent Blueprints</h2>
      <div class="cards">
        ${agentBlueprints.map((agent) => `<article><h3>${escapeHtml(agent.name)}</h3><p>${escapeHtml(agent.purpose)}</p><small>${escapeHtml(agent.transparencyMetric)}</small></article>`).join("")}
      </div>
    </section>`
  );
}

function renderProspectsPage(): string {
  return renderShell(
    "Virginia Prospect Finder",
    "Pull prospects weekly, score AI automation fit, extract public website emails, and review outreach drafts.",
    `<section>
      <h2>Run Incremental Pull</h2>
      <div class="controls">
        <label>Cities <input id="cities" value="Richmond,Norfolk,Chesapeake,Alexandria,Arlington,Fairfax"></label>
        <label>Limit <input id="limit" type="number" value="10"></label>
        <label>Minimum Score <input id="minScore" type="number" value="50"></label>
      </div>
      <div id="industryGrid" class="checks"></div>
      <button id="runButton">Run Pull</button>
      <button id="refreshButton" class="secondary">Refresh</button>
      <p id="status">Ready.</p>
    </section>
    <section>
      <h2>Prospects</h2>
      <div class="layout"><table><tbody id="rows"></tbody></table><aside id="detail">Select a prospect.</aside></div>
    </section>
    <script>
      const industries = ${JSON.stringify(defaultIndustries.map((industry) => ({ id: industry, label: industryLabels[industry] })))};
      let records = [];
      industryGrid.innerHTML = industries.map((item) => '<label><input type="checkbox" checked value="' + item.id + '"> ' + item.label + '</label>').join('');
      async function json(url, options) { const response = await fetch(url, options); const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Request failed'); return data; }
      function selectedIndustries() { return Array.from(document.querySelectorAll('#industryGrid input:checked')).map((input) => input.value); }
      async function load() { const data = await json('/api/prospects/store'); records = data.records; render(); status.textContent = 'Loaded ' + records.length + ' prospects.'; }
      async function run() {
        runButton.disabled = true; status.textContent = 'Pulling...';
        try {
          const data = await json('/api/prospects/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cities: cities.value.split(',').map((city) => city.trim()).filter(Boolean), industries: selectedIndustries(), maxResultsPerQuery: Number(limit.value), minScore: Number(minScore.value), includeSeeds: true }) });
          records = data.records; render(); status.textContent = 'Done. New: ' + data.newCount + ', updated: ' + data.updatedCount + '.';
        } catch (error) { status.textContent = error.message; } finally { runButton.disabled = false; }
      }
      function render() {
        rows.innerHTML = records.map((record, index) => '<tr data-index="' + index + '"><td><strong>' + escapeHtml(record.name) + '</strong><br>' + escapeHtml(record.city) + ' · ' + escapeHtml(record.recommendedOffer) + '<br><small>' + escapeHtml(record.outreachChannel || 'research-needed') + ' · ' + escapeHtml(record.primaryEmail || record.primaryPhone || 'No contact found') + '</small></td></tr>').join('');
        document.querySelectorAll('tr[data-index]').forEach((row) => row.onclick = () => show(records[Number(row.dataset.index)]));
      }
      function show(record) {
        const script = record.coldCallScript;
        const callPanel = script ? '<h4>Cold Call Script</h4><textarea>' + escapeHtml(script.objective + '\\n\\nOpener:\\n' + script.opener + '\\n\\nQuestions:\\n- ' + script.qualifyingQuestions.join('\\n- ') + '\\n\\nPitch:\\n' + script.valuePitch + '\\n\\nVoicemail:\\n' + script.voicemail + '\\n\\nFollow-up:\\n' + script.followUpNote) + '</textarea>' : '';
        detail.innerHTML = '<h3>' + escapeHtml(record.name) + '</h3><p><strong>Channel:</strong> ' + escapeHtml(record.outreachChannel || 'research-needed') + '</p><p><strong>Email:</strong> ' + escapeHtml(record.primaryEmail || 'None found') + '</p><p><strong>Phone:</strong> ' + escapeHtml(record.primaryPhone || 'None found') + '</p>' + callPanel + record.outreachDrafts.map((draft) => '<h4>Day ' + draft.day + ': ' + escapeHtml(draft.serviceFocus) + '</h4><textarea>' + escapeHtml(draft.subject + '\\n\\n' + draft.body) + '</textarea>').join('');
      }
      function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
      runButton.onclick = run; refreshButton.onclick = load; load();
    </script>`
  );
}

function renderRecruitingPage(): string {
  return renderShell(
    "Recruiting Intelligence",
    "Monitor approved career sources, store job signals, and draft LinkedIn repost copy for review.",
    `<section>
      <h2>Run Job Signal Pull</h2>
      <div class="controls">
        <label>Keywords <input id="query" value="AI IT cloud cybersecurity customer success support engineer"></label>
        <label>Max Per Company <input id="limit" type="number" value="10"></label>
      </div>
      <button id="runButton">Run Job Pull</button>
      <button id="refreshButton" class="secondary">Refresh</button>
      <p id="status">Ready.</p>
    </section>
    <section>
      <h2>Job Signals</h2>
      <div class="layout"><table><tbody id="rows"></tbody></table><aside id="detail">Select a job.</aside></div>
    </section>
    <script>
      let records = [];
      async function json(url, options) { const response = await fetch(url, options); const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Request failed'); return data; }
      async function load() { const data = await json('/api/recruiting/jobs'); records = data.records; render(); status.textContent = 'Loaded ' + records.length + ' jobs.'; }
      async function run() {
        runButton.disabled = true; status.textContent = 'Checking career sources...';
        try {
          const data = await json('/api/recruiting/jobs/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: query.value, maxJobsPerCompany: Number(limit.value) }) });
          records = data.records; render(); status.textContent = 'Done. New: ' + data.newCount + ', updated: ' + data.updatedCount + '.';
        } catch (error) { status.textContent = error.message; } finally { runButton.disabled = false; }
      }
      function render() {
        rows.innerHTML = records.map((record, index) => '<tr data-index="' + index + '"><td><strong>' + escapeHtml(record.company) + '</strong><br>' + escapeHtml(record.title) + '<br><small>' + escapeHtml(record.location) + '</small></td></tr>').join('');
        document.querySelectorAll('tr[data-index]').forEach((row) => row.onclick = () => show(records[Number(row.dataset.index)]));
      }
      function show(record) { detail.innerHTML = '<h3>' + escapeHtml(record.title) + '</h3><p><a target="_blank" href="' + escapeHtml(record.url) + '">Original source</a></p><textarea>' + escapeHtml(record.linkedInDraft) + '</textarea>'; }
      function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
      runButton.onclick = run; refreshButton.onclick = load; load();
    </script>`
  );
}

function renderShell(title: string, subtitle: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f8f7; color: #17231f; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    header { padding: 24px 32px; background: #10241f; color: white; }
    main { max-width: 1280px; margin: 0 auto; padding: 22px; display: grid; gap: 16px; }
    h1 { margin: 0 0 8px; font-size: 30px; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 19px; letter-spacing: 0; }
    p { color: #596a63; line-height: 1.5; }
    header p { color: #c8d8d2; margin: 0; }
    nav { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 14px; }
    nav a { color: #9de4c8; font-weight: 800; }
    section, aside, article { background: white; border: 1px solid #dce6e1; border-radius: 8px; padding: 16px; }
    .cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
    .controls { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .checks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 12px 0; }
    .layout { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.8fr); gap: 16px; align-items: start; }
    input, textarea { width: 100%; border: 1px solid #bdcbc5; border-radius: 6px; padding: 10px; font: inherit; }
    textarea { min-height: 220px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; }
    button { border: 0; border-radius: 6px; padding: 10px 13px; background: #126049; color: white; font-weight: 800; cursor: pointer; }
    button.secondary { background: #2d4a63; }
    table { width: 100%; border-collapse: collapse; background: white; }
    td { border-bottom: 1px solid #e2e9ec; padding: 10px; cursor: pointer; }
    tr:hover { background: #f4faf7; }
    @media (max-width: 900px) { header { padding: 20px; } main { padding: 14px; } .cards, .controls, .checks, .layout { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(subtitle)}</p>
    <nav>
      <a href="/">Consulting OS</a>
      <a href="/prospects">Prospects</a>
      <a href="/recruiting">Recruiting</a>
      <a href="/api/health">Health JSON</a>
    </nav>
  </header>
  <main>${body}</main>
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

  return latestSeenAt === undefined ? null : new Date(latestSeenAt + 7 * 24 * 60 * 60 * 1000).toISOString();
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody.length === 0 ? {} : JSON.parse(rawBody);
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
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

server.listen(PORT, "127.0.0.1", () => {
  console.log(`AI Consulting Firm OS: http://127.0.0.1:${String(PORT)}/`);
  console.log(`Prospects: http://127.0.0.1:${String(PORT)}/prospects`);
  console.log(`Recruiting: http://127.0.0.1:${String(PORT)}/recruiting`);
});
