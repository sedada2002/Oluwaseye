import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname } from "node:path";
import { URL } from "node:url";
import { z } from "zod";

const portArgument = process.argv.find((argument) => argument.startsWith("--port="));
const PORT = Number(portArgument?.slice("--port=".length) ?? process.env["BEHAVIORAL_HEALTH_CRM_PORT"] ?? "4290");

const referralSourceTypes = [
  "Primary care physician",
  "School",
  "Therapist",
  "Attorney",
  "Hospital",
  "Community organization",
  "Online",
  "Other"
] as const;

const insuranceStatuses = ["Not started", "Pending", "Verified", "Out of network", "Denied"] as const;
const inquiryStatuses = ["New inquiry", "Insurance verification", "Consult scheduled", "Waitlist", "Converted", "Closed"] as const;
const activityTypes = ["Call", "Email", "Referral follow-up", "Consultation", "Community outreach", "Task"] as const;
const campaignChannels = ["Email", "Phone", "Community event", "Referral visit", "Newsletter"] as const;
const readinessStatuses = ["Needed", "Planned", "In progress", "Ready", "Blocked"] as const;
const readinessCategories = ["Security", "Compliance", "Data", "Operations", "Deployment", "Workflow", "Reporting"] as const;
const integrationCategories = ["EHR", "Calendar", "Email", "SMS/phone", "Insurance verification", "Forms/intake", "Website leads", "Contacts/CRM", "Marketing"] as const;
const integrationStatuses = ["Needed", "Evaluating", "Configured", "Live", "Blocked"] as const;

const referralSourceSchema = z.object({
  name: z.string().trim().min(1),
  type: z.enum(referralSourceTypes),
  organization: z.string().trim().default(""),
  contactName: z.string().trim().default(""),
  email: z.string().trim().default(""),
  phone: z.string().trim().default(""),
  relationshipStage: z.enum(["New", "Active", "Warm", "Dormant"]).default("New"),
  notes: z.string().trim().default("")
});

const prospectivePatientSchema = z.object({
  displayName: z.string().trim().min(1),
  guardianName: z.string().trim().default(""),
  phone: z.string().trim().default(""),
  email: z.string().trim().default(""),
  referralSourceId: z.string().trim().default(""),
  serviceNeed: z.string().trim().default(""),
  insuranceProvider: z.string().trim().default(""),
  insuranceStatus: z.enum(insuranceStatuses).default("Not started"),
  inquiryStatus: z.enum(inquiryStatuses).default("New inquiry"),
  consultationDate: z.string().trim().default(""),
  estimatedMonthlyRevenue: z.number().min(0).max(100_000).default(0),
  nextFollowUpAt: z.string().trim().default(""),
  notes: z.string().trim().default("")
});

const activitySchema = z.object({
  relatedType: z.enum(["Referral source", "Prospective patient", "Marketing"]),
  relatedId: z.string().trim().default(""),
  type: z.enum(activityTypes),
  dueAt: z.string().trim().default(""),
  completedAt: z.string().trim().default(""),
  summary: z.string().trim().min(1),
  outcome: z.string().trim().default("")
});

const campaignSchema = z.object({
  name: z.string().trim().min(1),
  channel: z.enum(campaignChannels),
  audience: z.string().trim().default(""),
  status: z.enum(["Draft", "Scheduled", "Active", "Completed"]).default("Draft"),
  sentCount: z.number().int().min(0).default(0),
  responseCount: z.number().int().min(0).default(0),
  startDate: z.string().trim().default(""),
  notes: z.string().trim().default("")
});

const enterpriseControlSchema = z.object({
  title: z.string().trim().min(1),
  category: z.enum(readinessCategories),
  status: z.enum(readinessStatuses).default("Needed"),
  owner: z.string().trim().default(""),
  priority: z.enum(["High", "Medium", "Low"]).default("High"),
  notes: z.string().trim().default("")
});

const integrationSchema = z.object({
  name: z.string().trim().min(1),
  category: z.enum(integrationCategories),
  status: z.enum(integrationStatuses).default("Needed"),
  vendorOptions: z.string().trim().default(""),
  apiNeed: z.string().trim().default(""),
  hipaaNotes: z.string().trim().default(""),
  nextStep: z.string().trim().default("")
});

const statusUpdateSchema = z.object({
  inquiryStatus: z.enum(inquiryStatuses),
  insuranceStatus: z.enum(insuranceStatuses).optional(),
  nextFollowUpAt: z.string().trim().optional()
});

type ReferralSourceType = (typeof referralSourceTypes)[number];
type InsuranceStatus = (typeof insuranceStatuses)[number];
type InquiryStatus = (typeof inquiryStatuses)[number];
type ActivityType = (typeof activityTypes)[number];
type CampaignChannel = (typeof campaignChannels)[number];
type ReadinessStatus = (typeof readinessStatuses)[number];
type ReadinessCategory = (typeof readinessCategories)[number];
type IntegrationCategory = (typeof integrationCategories)[number];
type IntegrationStatus = (typeof integrationStatuses)[number];

interface ReferralSource {
  id: string;
  name: string;
  type: ReferralSourceType;
  organization: string;
  contactName: string;
  email: string;
  phone: string;
  relationshipStage: "New" | "Active" | "Warm" | "Dormant";
  notes: string;
  referralCount: number;
  lastContactAt: string;
  createdAt: string;
  updatedAt: string;
}

interface ProspectivePatient {
  id: string;
  displayName: string;
  guardianName: string;
  phone: string;
  email: string;
  referralSourceId: string;
  serviceNeed: string;
  insuranceProvider: string;
  insuranceStatus: InsuranceStatus;
  inquiryStatus: InquiryStatus;
  consultationDate: string;
  estimatedMonthlyRevenue: number;
  nextFollowUpAt: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

interface Activity {
  id: string;
  relatedType: "Referral source" | "Prospective patient" | "Marketing";
  relatedId: string;
  type: ActivityType;
  dueAt: string;
  completedAt: string;
  summary: string;
  outcome: string;
  createdAt: string;
}

interface Campaign {
  id: string;
  name: string;
  channel: CampaignChannel;
  audience: string;
  status: "Draft" | "Scheduled" | "Active" | "Completed";
  sentCount: number;
  responseCount: number;
  startDate: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

interface EnterpriseControl {
  id: string;
  title: string;
  category: ReadinessCategory;
  status: ReadinessStatus;
  owner: string;
  priority: "High" | "Medium" | "Low";
  notes: string;
  createdAt: string;
  updatedAt: string;
}

interface DataIntegration {
  id: string;
  name: string;
  category: IntegrationCategory;
  status: IntegrationStatus;
  vendorOptions: string;
  apiNeed: string;
  hipaaNotes: string;
  nextStep: string;
  createdAt: string;
  updatedAt: string;
}

interface CrmState {
  referralSources: ReferralSource[];
  prospectivePatients: ProspectivePatient[];
  activities: Activity[];
  campaigns: Campaign[];
  enterpriseControls: EnterpriseControl[];
  integrations: DataIntegration[];
}

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && requestUrl.pathname === "/") {
      sendHtml(response, renderCrmPage());
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        service: "behavioral-health-crm",
        links: {
          dashboard: "/",
          data: "/api/crm",
          referralSources: "/api/referral-sources",
          prospectivePatients: "/api/prospective-patients",
          activities: "/api/activities",
          campaigns: "/api/campaigns",
          enterpriseControls: "/api/enterprise-controls",
          integrations: "/api/integrations"
        }
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/crm") {
      const state = await store.read();
      sendJson(response, 200, { ok: true, state, summary: summarize(state) });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/referral-sources") {
      const input = referralSourceSchema.parse(await readJson(request));
      const state = await store.update((current) => {
        const now = new Date().toISOString();
        current.referralSources.unshift({
          id: createId("src"),
          ...input,
          referralCount: 0,
          lastContactAt: "",
          createdAt: now,
          updatedAt: now
        });
        return current;
      });
      sendJson(response, 201, { ok: true, state, summary: summarize(state) });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/prospective-patients") {
      const input = prospectivePatientSchema.parse(await readJson(request));
      const state = await store.update((current) => {
        const now = new Date().toISOString();
        current.prospectivePatients.unshift({ id: createId("inq"), ...input, createdAt: now, updatedAt: now });
        if (input.referralSourceId.length > 0) {
          const source = current.referralSources.find((item) => item.id === input.referralSourceId);
          if (source) {
            source.referralCount += 1;
            source.updatedAt = now;
          }
        }
        return current;
      });
      sendJson(response, 201, { ok: true, state, summary: summarize(state) });
      return;
    }

    if (request.method === "PATCH" && requestUrl.pathname.startsWith("/api/prospective-patients/")) {
      const patientId = requestUrl.pathname.slice("/api/prospective-patients/".length).replace(/\/status$/, "");
      const input = statusUpdateSchema.parse(await readJson(request));
      const state = await store.update((current) => {
        const patient = current.prospectivePatients.find((item) => item.id === patientId);
        if (!patient) {
          throw new RouteError(404, "Prospective patient was not found.");
        }
        patient.inquiryStatus = input.inquiryStatus;
        if (input.insuranceStatus !== undefined) {
          patient.insuranceStatus = input.insuranceStatus;
        }
        if (input.nextFollowUpAt !== undefined) {
          patient.nextFollowUpAt = input.nextFollowUpAt;
        }
        patient.updatedAt = new Date().toISOString();
        return current;
      });
      sendJson(response, 200, { ok: true, state, summary: summarize(state) });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/activities") {
      const input = activitySchema.parse(await readJson(request));
      const state = await store.update((current) => {
        const now = new Date().toISOString();
        current.activities.unshift({ id: createId("act"), ...input, createdAt: now });
        if (input.relatedType === "Referral source" && input.relatedId.length > 0) {
          const source = current.referralSources.find((item) => item.id === input.relatedId);
          if (source) {
            source.lastContactAt = input.completedAt || input.dueAt || now;
            source.updatedAt = now;
          }
        }
        return current;
      });
      sendJson(response, 201, { ok: true, state, summary: summarize(state) });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/campaigns") {
      const input = campaignSchema.parse(await readJson(request));
      const state = await store.update((current) => {
        const now = new Date().toISOString();
        current.campaigns.unshift({ id: createId("cmp"), ...input, createdAt: now, updatedAt: now });
        return current;
      });
      sendJson(response, 201, { ok: true, state, summary: summarize(state) });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/enterprise-controls") {
      const input = enterpriseControlSchema.parse(await readJson(request));
      const state = await store.update((current) => {
        const now = new Date().toISOString();
        current.enterpriseControls.unshift({ id: createId("ctl"), ...input, createdAt: now, updatedAt: now });
        return current;
      });
      sendJson(response, 201, { ok: true, state, summary: summarize(state) });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/integrations") {
      const input = integrationSchema.parse(await readJson(request));
      const state = await store.update((current) => {
        const now = new Date().toISOString();
        current.integrations.unshift({ id: createId("int"), ...input, createdAt: now, updatedAt: now });
        return current;
      });
      sendJson(response, 201, { ok: true, state, summary: summarize(state) });
      return;
    }

    sendJson(response, 404, { ok: false, message: "Route not found in behavioral health CRM." });
  } catch (error: unknown) {
    const statusCode = error instanceof RouteError ? error.statusCode : error instanceof z.ZodError ? 400 : 500;
    sendJson(response, statusCode, {
      ok: false,
      message: error instanceof Error ? error.message : "Unknown behavioral health CRM error."
    });
  }
}

class CrmStore {
  public constructor(private readonly filePath: string) {}

  public async read(): Promise<CrmState> {
    try {
      return normalizeState(JSON.parse(await readFile(this.filePath, "utf8")) as Partial<CrmState>);
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        const seeded = seedState();
        await this.write(seeded);
        return seeded;
      }
      throw error;
    }
  }

  public async update(mutator: (state: CrmState) => CrmState): Promise<CrmState> {
    const next = mutator(await this.read());
    await this.write(next);
    return next;
  }

  private async write(state: CrmState): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
}

class RouteError extends Error {
  public constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

const store = new CrmStore("output/crm/behavioral-health-crm.json");

function seedState(): CrmState {
  const now = new Date().toISOString();
  const sourceOne = createId("src");
  const sourceTwo = createId("src");
  const patientOne = createId("inq");
  return {
    referralSources: [
      {
        id: sourceOne,
        name: "Westside Pediatrics",
        type: "Primary care physician",
        organization: "Westside Pediatrics",
        contactName: "Dr. Morgan Lee",
        email: "referrals@example.com",
        phone: "(555) 014-1001",
        relationshipStage: "Active",
        notes: "Sends ADHD and anxiety referrals. Prefers concise monthly capacity updates.",
        referralCount: 1,
        lastContactAt: now,
        createdAt: now,
        updatedAt: now
      },
      {
        id: sourceTwo,
        name: "North County Schools",
        type: "School",
        organization: "North County Schools",
        contactName: "Student services office",
        email: "",
        phone: "(555) 014-2010",
        relationshipStage: "Warm",
        notes: "Good fit for outreach lunch-and-learn.",
        referralCount: 0,
        lastContactAt: "",
        createdAt: now,
        updatedAt: now
      }
    ],
    prospectivePatients: [
      {
        id: patientOne,
        displayName: "J. Sample",
        guardianName: "Parent/guardian",
        phone: "(555) 014-8877",
        email: "family@example.com",
        referralSourceId: sourceOne,
        serviceNeed: "Child therapy intake",
        insuranceProvider: "BlueCross",
        insuranceStatus: "Pending",
        inquiryStatus: "Insurance verification",
        consultationDate: "",
        estimatedMonthlyRevenue: 640,
        nextFollowUpAt: "",
        notes: "Demo record. Keep live use limited to minimum necessary information.",
        createdAt: now,
        updatedAt: now
      }
    ],
    activities: [
      {
        id: createId("act"),
        relatedType: "Referral source",
        relatedId: sourceOne,
        type: "Referral follow-up",
        dueAt: now.slice(0, 10),
        completedAt: "",
        summary: "Send availability update and referral packet.",
        outcome: "",
        createdAt: now
      }
    ],
    campaigns: [
      {
        id: createId("cmp"),
        name: "Spring referral source check-in",
        channel: "Email",
        audience: "Primary care physicians and therapists",
        status: "Draft",
        sentCount: 0,
        responseCount: 0,
        startDate: "",
        notes: "Share current openings, insurance accepted, and consult scheduling process.",
        createdAt: now,
        updatedAt: now
      }
    ],
    enterpriseControls: seedEnterpriseControls(now),
    integrations: seedIntegrations(now)
  };
}

function seedEnterpriseControls(now: string): EnterpriseControl[] {
  return [
    control(now, "Secure authentication", "Security", "High", "Add production login, password policy, session timeout, MFA option, and account recovery."),
    control(now, "Role-based access control", "Security", "High", "Separate owner, intake staff, biller, marketer, and admin permissions."),
    control(now, "Audit trail", "Compliance", "High", "Record who viewed, created, edited, exported, deleted, and synced every sensitive record."),
    control(now, "HIPAA-ready hosting and BAAs", "Compliance", "High", "Use vendors that will sign BAAs before storing PHI or sending patient communications."),
    control(now, "Encrypted production database", "Data", "High", "Replace local JSON with Postgres, encrypted storage, migration scripts, and row-level ownership rules."),
    control(now, "Encrypted backups and recovery", "Operations", "High", "Schedule backups, test restores, document RPO/RTO, and protect backup credentials."),
    control(now, "Data retention and deletion policy", "Compliance", "Medium", "Define retention periods, archive rules, legal holds, and deletion workflows."),
    control(now, "Secure file handling", "Security", "High", "Add encrypted object storage for insurance cards, referral documents, and intake packets."),
    control(now, "Duplicate detection and validation", "Workflow", "Medium", "Detect duplicate inquiries, referral sources, phone numbers, emails, and payer records."),
    control(now, "Production deployment", "Deployment", "High", "Add HTTPS, domain, environment variables, monitoring, alerts, uptime checks, and release process."),
    control(now, "Referral and revenue reporting", "Reporting", "Medium", "Track referral conversion, payer mix, waitlist movement, campaign ROI, and pipeline revenue."),
    control(now, "Security review before PHI", "Compliance", "High", "Complete legal/security review before entering real patient data.")
  ];
}

function seedIntegrations(now: string): DataIntegration[] {
  return [
    integration(now, "EHR / practice management", "EHR", "SimplePractice, TherapyNotes, Jane, IntakeQ, Tebra, Athena", "Sync patients, appointments, referrals, and status updates where vendor APIs allow it.", "Requires BAA and careful PHI mapping."),
    integration(now, "Calendar scheduling", "Calendar", "Google Calendar, Microsoft Outlook, EHR scheduling", "Read/write consultation slots, reminders, and intake follow-up tasks.", "Avoid putting diagnosis or sensitive clinical detail in calendar text."),
    integration(now, "Email outreach", "Email", "Google Workspace, Microsoft 365, SendGrid", "Send referral follow-ups and track replies or campaign responses.", "Use HIPAA-compliant configuration and avoid PHI in marketing campaigns."),
    integration(now, "SMS and phone", "SMS/phone", "Twilio, RingCentral, Dialpad", "Send reminders, log calls, and capture callback tasks.", "Only use vendors/configurations with BAA support for PHI."),
    integration(now, "Insurance verification", "Insurance verification", "Availity, Eligible, Waystar, Change Healthcare, payer APIs", "Check eligibility, network status, benefits, and verification result.", "Treat payer responses as PHI and audit every lookup."),
    integration(now, "Secure intake forms", "Forms/intake", "IntakeQ, Jotform HIPAA, Formstack, custom portal", "Create inquiries from submitted forms and attach intake packets securely.", "Forms must be HIPAA-capable before real patient use."),
    integration(now, "Website lead capture", "Website leads", "Website contact form, webhook, Zapier alternative, custom endpoint", "Convert website inquiries into prospective patient records.", "Public forms should collect minimum necessary information."),
    integration(now, "Referral source import", "Contacts/CRM", "CSV, Google Contacts, HubSpot, Salesforce, spreadsheets", "Import referral sources, organizations, tags, and relationship notes.", "Do not import PHI into marketing CRMs."),
    integration(now, "Marketing campaigns", "Marketing", "Mailchimp, Constant Contact, Microsoft 365 campaigns", "Track outreach campaigns, send non-PHI updates, and measure response rates.", "Keep campaign lists separate from patient treatment data.")
  ];
}

function control(now: string, title: string, category: ReadinessCategory, priority: "High" | "Medium" | "Low", notes: string): EnterpriseControl {
  return {
    id: createId("ctl"),
    title,
    category,
    status: "Needed",
    owner: "",
    priority,
    notes,
    createdAt: now,
    updatedAt: now
  };
}

function integration(now: string, name: string, category: IntegrationCategory, vendorOptions: string, apiNeed: string, hipaaNotes: string): DataIntegration {
  return {
    id: createId("int"),
    name,
    category,
    status: "Needed",
    vendorOptions,
    apiNeed,
    hipaaNotes,
    nextStep: "Pick vendor, confirm API access, confirm BAA, then implement connector.",
    createdAt: now,
    updatedAt: now
  };
}

function normalizeState(value: Partial<CrmState>): CrmState {
  return {
    referralSources: Array.isArray(value.referralSources) ? value.referralSources : [],
    prospectivePatients: Array.isArray(value.prospectivePatients) ? value.prospectivePatients : [],
    activities: Array.isArray(value.activities) ? value.activities : [],
    campaigns: Array.isArray(value.campaigns) ? value.campaigns : [],
    enterpriseControls: Array.isArray(value.enterpriseControls) ? value.enterpriseControls : seedEnterpriseControls(new Date().toISOString()),
    integrations: Array.isArray(value.integrations) ? value.integrations : seedIntegrations(new Date().toISOString())
  };
}

function summarize(state: CrmState): Record<string, number> {
  const activeLeads = state.prospectivePatients.filter((patient) => !["Converted", "Closed"].includes(patient.inquiryStatus)).length;
  const waitlist = state.prospectivePatients.filter((patient) => patient.inquiryStatus === "Waitlist").length;
  const scheduledConsults = state.prospectivePatients.filter((patient) => patient.inquiryStatus === "Consult scheduled").length;
  const pendingInsurance = state.prospectivePatients.filter((patient) => patient.insuranceStatus === "Pending").length;
  const openFollowUps = state.activities.filter((activity) => activity.completedAt.length === 0).length;
  const openControls = state.enterpriseControls.filter((controlItem) => controlItem.status !== "Ready").length;
  const liveIntegrations = state.integrations.filter((integrationItem) => integrationItem.status === "Live").length;
  const pipelineRevenue = state.prospectivePatients
    .filter((patient) => !["Closed"].includes(patient.inquiryStatus))
    .reduce((total, patient) => total + patient.estimatedMonthlyRevenue, 0);

  return {
    referralSources: state.referralSources.length,
    activeLeads,
    waitlist,
    scheduledConsults,
    pendingInsurance,
    openFollowUps,
    campaigns: state.campaigns.length,
    openControls,
    liveIntegrations,
    pipelineRevenue
  };
}

function renderCrmPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Behavioral Health CRM</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f7f8; color: #1b2428; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    header { background: #17313a; color: white; padding: 18px 24px; }
    main { max-width: 1360px; margin: 0 auto; padding: 18px; display: grid; gap: 14px; }
    h1 { margin: 0 0 4px; font-size: 26px; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 17px; letter-spacing: 0; }
    h3 { margin: 0 0 8px; font-size: 15px; letter-spacing: 0; }
    p, small { color: #5e6d73; line-height: 1.45; }
    header p { color: #d7e3e6; margin: 0; }
    section, aside, article { background: white; border: 1px solid #dce5e8; border-radius: 8px; padding: 14px; }
    label { display: grid; gap: 5px; color: #334247; font-weight: 700; font-size: 12px; }
    input, select, textarea { width: 100%; border: 1px solid #bccbd0; border-radius: 6px; padding: 9px 10px; font: inherit; background: white; }
    textarea { min-height: 74px; resize: vertical; }
    button { border: 0; border-radius: 6px; padding: 9px 12px; background: #17634f; color: white; font-weight: 800; cursor: pointer; }
    button.secondary { background: #365568; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #e4ecef; padding: 9px; text-align: left; vertical-align: top; }
    th { color: #506269; font-size: 12px; }
    tr[data-id] { cursor: pointer; }
    tr[data-id]:hover { background: #f2f8f6; }
    .stats { display: grid; grid-template-columns: repeat(9, minmax(0, 1fr)); gap: 10px; }
    .stat strong { display: block; font-size: 22px; margin-bottom: 2px; }
    .workspace { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.75fr); gap: 14px; align-items: start; }
    .tabs { display: flex; flex-wrap: wrap; gap: 8px; }
    .tabs button { background: #e6eef1; color: #26373d; }
    .tabs button.active { background: #17634f; color: white; }
    .grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
    .pill { display: inline-flex; align-items: center; min-height: 24px; padding: 3px 8px; border-radius: 999px; background: #eaf2f4; color: #33464d; font-size: 12px; font-weight: 800; }
    .warning { border-color: #e2c078; background: #fff8e7; color: #614a16; }
    .stack { display: grid; gap: 10px; }
    .right { text-align: right; }
    @media (max-width: 980px) { main { padding: 12px; } .stats, .workspace, .grid2, .grid3 { grid-template-columns: 1fr; } .right { text-align: left; } }
  </style>
</head>
<body>
  <header>
    <h1>Behavioral Health CRM</h1>
    <p>Referral sources, inquiries, insurance verification, consultations, waitlist, outreach, and revenue pipeline.</p>
  </header>
  <main>
    <section class="warning">
      This local prototype is for workflow tracking. For production behavioral health use, connect proper authentication, audit logs, encrypted storage, backups, and HIPAA-compliant hosting before entering protected health information.
    </section>
    <section class="stats" id="stats"></section>
    <section class="tabs">
      <button data-tab="patients" class="active">Prospective Patients</button>
      <button data-tab="sources">Referral Sources</button>
      <button data-tab="activities">Follow-Ups</button>
      <button data-tab="campaigns">Marketing</button>
      <button data-tab="enterprise">Enterprise Readiness</button>
      <button data-tab="integrations">Data Integrations</button>
    </section>
    <div class="workspace">
      <section>
        <div class="toolbar">
          <h2 id="tableTitle">Prospective Patients</h2>
          <input id="search" placeholder="Search CRM" style="max-width:280px">
        </div>
        <div id="table"></div>
      </section>
      <aside class="stack">
        <div id="detail">Select a row to inspect it.</div>
        <section>
          <h2 id="formTitle">Add Prospective Patient</h2>
          <form id="entryForm" class="stack"></form>
          <p id="status">Ready.</p>
        </section>
      </aside>
    </div>
  </main>
  <script>
    const state = { data: null, tab: "patients", selected: null };
    const enums = {
      sourceTypes: ${JSON.stringify(referralSourceTypes)},
      insuranceStatuses: ${JSON.stringify(insuranceStatuses)},
      inquiryStatuses: ${JSON.stringify(inquiryStatuses)},
      activityTypes: ${JSON.stringify(activityTypes)},
      campaignChannels: ${JSON.stringify(campaignChannels)},
      readinessStatuses: ${JSON.stringify(readinessStatuses)},
      readinessCategories: ${JSON.stringify(readinessCategories)},
      integrationStatuses: ${JSON.stringify(integrationStatuses)},
      integrationCategories: ${JSON.stringify(integrationCategories)}
    };

    async function api(url, options) {
      const response = await fetch(url, options);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Request failed");
      return payload;
    }

    async function load() {
      const payload = await api("/api/crm");
      state.data = payload;
      renderAll();
      status.textContent = "Loaded.";
    }

    function renderAll() {
      renderStats();
      renderTable();
      renderForm();
    }

    function renderStats() {
      const summary = state.data.summary;
      stats.innerHTML = [
        ["Referral sources", summary.referralSources],
        ["Active leads", summary.activeLeads],
        ["Insurance pending", summary.pendingInsurance],
        ["Consults", summary.scheduledConsults],
        ["Waitlist", summary.waitlist],
        ["Open follow-ups", summary.openFollowUps],
        ["Readiness gaps", summary.openControls],
        ["Live APIs", summary.liveIntegrations],
        ["Pipeline", "$" + summary.pipelineRevenue.toLocaleString()]
      ].map(([label, value]) => '<article class="stat"><strong>' + escapeHtml(value) + '</strong><small>' + escapeHtml(label) + '</small></article>').join("");
    }

    function renderTable() {
      document.querySelectorAll(".tabs button").forEach((button) => button.classList.toggle("active", button.dataset.tab === state.tab));
      const query = search.value.toLowerCase();
      const rows = getRows().filter((row) => JSON.stringify(row).toLowerCase().includes(query));
      tableTitle.textContent = labelForTab();
      table.innerHTML = tableForRows(rows);
      document.querySelectorAll("tr[data-id]").forEach((row) => row.onclick = () => selectRow(row.dataset.id));
    }

    function tableForRows(rows) {
      if (state.tab === "patients") {
        return '<table><thead><tr><th>Name</th><th>Status</th><th>Insurance</th><th>Follow-up</th><th class="right">Revenue</th></tr></thead><tbody>' +
          rows.map((item) => '<tr data-id="' + item.id + '"><td><strong>' + escapeHtml(item.displayName) + '</strong><br><small>' + escapeHtml(sourceName(item.referralSourceId)) + '</small></td><td><span class="pill">' + escapeHtml(item.inquiryStatus) + '</span></td><td>' + escapeHtml(item.insuranceStatus) + '<br><small>' + escapeHtml(item.insuranceProvider || "No payer") + '</small></td><td>' + escapeHtml(item.nextFollowUpAt || item.consultationDate || "None") + '</td><td class="right">$' + Number(item.estimatedMonthlyRevenue).toLocaleString() + '</td></tr>').join("") +
          '</tbody></table>';
      }
      if (state.tab === "sources") {
        return '<table><thead><tr><th>Source</th><th>Type</th><th>Stage</th><th>Contact</th><th class="right">Referrals</th></tr></thead><tbody>' +
          rows.map((item) => '<tr data-id="' + item.id + '"><td><strong>' + escapeHtml(item.name) + '</strong><br><small>' + escapeHtml(item.organization || "Independent") + '</small></td><td>' + escapeHtml(item.type) + '</td><td><span class="pill">' + escapeHtml(item.relationshipStage) + '</span></td><td>' + escapeHtml(item.contactName || item.email || item.phone || "No contact") + '</td><td class="right">' + item.referralCount + '</td></tr>').join("") +
          '</tbody></table>';
      }
      if (state.tab === "activities") {
        return '<table><thead><tr><th>Task</th><th>Type</th><th>Due</th><th>Outcome</th></tr></thead><tbody>' +
          rows.map((item) => '<tr data-id="' + item.id + '"><td><strong>' + escapeHtml(item.summary) + '</strong><br><small>' + escapeHtml(item.relatedType) + '</small></td><td>' + escapeHtml(item.type) + '</td><td>' + escapeHtml(item.dueAt || "No date") + '</td><td>' + escapeHtml(item.completedAt ? "Completed: " + item.completedAt : item.outcome || "Open") + '</td></tr>').join("") +
          '</tbody></table>';
      }
      if (state.tab === "enterprise") {
        return '<table><thead><tr><th>Control</th><th>Category</th><th>Priority</th><th>Status</th></tr></thead><tbody>' +
          rows.map((item) => '<tr data-id="' + item.id + '"><td><strong>' + escapeHtml(item.title) + '</strong><br><small>' + escapeHtml(item.notes) + '</small></td><td>' + escapeHtml(item.category) + '</td><td>' + escapeHtml(item.priority) + '</td><td><span class="pill">' + escapeHtml(item.status) + '</span></td></tr>').join("") +
          '</tbody></table>';
      }
      if (state.tab === "integrations") {
        return '<table><thead><tr><th>Integration</th><th>Category</th><th>Status</th><th>API Need</th></tr></thead><tbody>' +
          rows.map((item) => '<tr data-id="' + item.id + '"><td><strong>' + escapeHtml(item.name) + '</strong><br><small>' + escapeHtml(item.vendorOptions) + '</small></td><td>' + escapeHtml(item.category) + '</td><td><span class="pill">' + escapeHtml(item.status) + '</span></td><td>' + escapeHtml(item.apiNeed) + '</td></tr>').join("") +
          '</tbody></table>';
      }
      return '<table><thead><tr><th>Campaign</th><th>Channel</th><th>Status</th><th class="right">Responses</th></tr></thead><tbody>' +
        rows.map((item) => '<tr data-id="' + item.id + '"><td><strong>' + escapeHtml(item.name) + '</strong><br><small>' + escapeHtml(item.audience || "No audience") + '</small></td><td>' + escapeHtml(item.channel) + '</td><td><span class="pill">' + escapeHtml(item.status) + '</span></td><td class="right">' + item.responseCount + " / " + item.sentCount + '</td></tr>').join("") +
        '</tbody></table>';
    }

    function renderForm() {
      formTitle.textContent = "Add " + labelForTab().replace(/s$/, "");
      if (state.tab === "patients") {
        entryForm.innerHTML = fields([
          text("displayName", "Display name / initials"),
          text("guardianName", "Guardian name"),
          text("phone", "Phone"),
          text("email", "Email"),
          select("referralSourceId", "Referral source", [["", "Unknown"]].concat(state.data.state.referralSources.map((item) => [item.id, item.name]))),
          text("serviceNeed", "Service need"),
          text("insuranceProvider", "Insurance provider"),
          select("insuranceStatus", "Insurance status", enums.insuranceStatuses),
          select("inquiryStatus", "Inquiry status", enums.inquiryStatuses),
          text("consultationDate", "Consult date"),
          number("estimatedMonthlyRevenue", "Est. monthly revenue"),
          text("nextFollowUpAt", "Next follow-up"),
          area("notes", "Notes")
        ]);
      } else if (state.tab === "sources") {
        entryForm.innerHTML = fields([
          text("name", "Source name"),
          select("type", "Type", enums.sourceTypes),
          text("organization", "Organization"),
          text("contactName", "Contact name"),
          text("email", "Email"),
          text("phone", "Phone"),
          select("relationshipStage", "Relationship stage", ["New", "Active", "Warm", "Dormant"]),
          area("notes", "Notes")
        ]);
      } else if (state.tab === "activities") {
        entryForm.innerHTML = fields([
          select("relatedType", "Related to", ["Referral source", "Prospective patient", "Marketing"]),
          select("relatedId", "Record", relatedOptions()),
          select("type", "Type", enums.activityTypes),
          text("dueAt", "Due date"),
          text("completedAt", "Completed date"),
          area("summary", "Summary"),
          area("outcome", "Outcome")
        ]);
      } else if (state.tab === "enterprise") {
        entryForm.innerHTML = fields([
          text("title", "Control title"),
          select("category", "Category", enums.readinessCategories),
          select("status", "Status", enums.readinessStatuses),
          select("priority", "Priority", ["High", "Medium", "Low"]),
          text("owner", "Owner"),
          area("notes", "Notes")
        ]);
      } else if (state.tab === "integrations") {
        entryForm.innerHTML = fields([
          text("name", "Integration name"),
          select("category", "Category", enums.integrationCategories),
          select("status", "Status", enums.integrationStatuses),
          area("vendorOptions", "Vendor options"),
          area("apiNeed", "API need"),
          area("hipaaNotes", "HIPAA notes"),
          area("nextStep", "Next step")
        ]);
      } else {
        entryForm.innerHTML = fields([
          text("name", "Campaign name"),
          select("channel", "Channel", enums.campaignChannels),
          text("audience", "Audience"),
          select("status", "Status", ["Draft", "Scheduled", "Active", "Completed"]),
          number("sentCount", "Sent count"),
          number("responseCount", "Response count"),
          text("startDate", "Start date"),
          area("notes", "Notes")
        ]);
      }
      entryForm.innerHTML += '<button type="submit">Save</button>';
    }

    function fields(items) { return items.map(Boolean).join(""); }
    function text(name, label) { return '<label>' + label + '<input name="' + name + '"></label>'; }
    function number(name, label) { return '<label>' + label + '<input name="' + name + '" type="number" value="0"></label>'; }
    function area(name, label) { return '<label>' + label + '<textarea name="' + name + '"></textarea></label>'; }
    function select(name, label, options) {
      return '<label>' + label + '<select name="' + name + '">' + options.map((option) => {
        const value = Array.isArray(option) ? option[0] : option;
        const text = Array.isArray(option) ? option[1] : option;
        return '<option value="' + escapeHtml(value) + '">' + escapeHtml(text) + '</option>';
      }).join("") + '</select></label>';
    }

    function relatedOptions() {
      return [["", "None"]]
        .concat(state.data.state.referralSources.map((item) => [item.id, "Source: " + item.name]))
        .concat(state.data.state.prospectivePatients.map((item) => [item.id, "Inquiry: " + item.displayName]));
    }

    function getRows() {
      const data = state.data.state;
      if (state.tab === "patients") return data.prospectivePatients;
      if (state.tab === "sources") return data.referralSources;
      if (state.tab === "activities") return data.activities;
      if (state.tab === "enterprise") return data.enterpriseControls;
      if (state.tab === "integrations") return data.integrations;
      return data.campaigns;
    }

    function labelForTab() {
      return { patients: "Prospective Patients", sources: "Referral Sources", activities: "Follow-Ups", campaigns: "Marketing Campaigns", enterprise: "Enterprise Readiness", integrations: "Data Integrations" }[state.tab];
    }

    function selectRow(id) {
      const item = getRows().find((row) => row.id === id);
      state.selected = item;
      if (!item) return;
      detail.innerHTML = '<section><h2>' + escapeHtml(item.displayName || item.name || item.summary) + '</h2>' +
        Object.entries(item).filter(([key]) => !["id", "createdAt", "updatedAt"].includes(key)).map(([key, value]) => '<p><strong>' + escapeHtml(labelize(key)) + ':</strong> ' + escapeHtml(String(value || "")) + '</p>').join("") +
        statusControls(item) + '</section>';
    }

    function statusControls(item) {
      if (state.tab !== "patients") return "";
      return '<div class="stack"><h3>Update Pipeline</h3>' +
        select("quickInquiryStatus", "Inquiry status", enums.inquiryStatuses).replace('name="quickInquiryStatus"', 'id="quickInquiryStatus"') +
        select("quickInsuranceStatus", "Insurance status", enums.insuranceStatuses).replace('name="quickInsuranceStatus"', 'id="quickInsuranceStatus"') +
        '<label>Next follow-up<input id="quickNextFollowUpAt" value="' + escapeHtml(item.nextFollowUpAt || "") + '"></label>' +
        '<button onclick="updateSelectedPatient()">Update status</button></div>';
    }

    async function updateSelectedPatient() {
      if (!state.selected) return;
      await submit("/api/prospective-patients/" + state.selected.id + "/status", "PATCH", {
        inquiryStatus: quickInquiryStatus.value,
        insuranceStatus: quickInsuranceStatus.value,
        nextFollowUpAt: quickNextFollowUpAt.value
      });
    }

    async function submit(url, method, body) {
      status.textContent = "Saving...";
      const payload = await api(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      state.data = payload;
      state.selected = null;
      detail.textContent = "Saved. Select a row to inspect it.";
      renderAll();
      status.textContent = "Saved.";
    }

    entryForm.onsubmit = async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(entryForm).entries());
      for (const key of ["estimatedMonthlyRevenue", "sentCount", "responseCount"]) {
        if (key in body) body[key] = Number(body[key] || 0);
      }
      const url = { patients: "/api/prospective-patients", sources: "/api/referral-sources", activities: "/api/activities", campaigns: "/api/campaigns", enterprise: "/api/enterprise-controls", integrations: "/api/integrations" }[state.tab];
      try { await submit(url, "POST", body); entryForm.reset(); } catch (error) { status.textContent = error.message; }
    };

    document.querySelectorAll(".tabs button").forEach((button) => button.onclick = () => {
      state.tab = button.dataset.tab;
      state.selected = null;
      detail.textContent = "Select a row to inspect it.";
      renderAll();
    });
    search.oninput = renderTable;
    function sourceName(id) { const source = state.data.state.referralSources.find((item) => item.id === id); return source ? source.name : "No referral source"; }
    function labelize(value) { return value.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase()); }
    function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
    load().catch((error) => { status.textContent = error.message; });
  </script>
</body>
</html>`;
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

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Behavioral Health CRM: http://127.0.0.1:${String(PORT)}/`);
});
