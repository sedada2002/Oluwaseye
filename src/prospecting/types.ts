export type ProspectIndustry =
  | "medical-practice"
  | "law-firm"
  | "accounting-firm"
  | "logistics"
  | "real-estate"
  | "manufacturing"
  | "nonprofit"
  | "government-contractor";

export interface ProspectSearchArea {
  readonly city: string;
  readonly state: "VA";
}

export interface RawProspect {
  readonly source: string;
  readonly sourceId: string;
  readonly name: string;
  readonly industry: ProspectIndustry;
  readonly city: string;
  readonly state: "VA";
  readonly address?: string;
  readonly phone?: string;
  readonly website?: string;
  readonly rating?: number;
  readonly reviewCount?: number;
  readonly categories: readonly string[];
}

export interface WebsiteSignal {
  readonly keyword: string;
  readonly reason: string;
  readonly points: number;
}

export interface WebsiteProfile {
  readonly url: string;
  readonly reachable: boolean;
  readonly title?: string;
  readonly description?: string;
  readonly emails: readonly string[];
  readonly phones: readonly string[];
  readonly contactPagesChecked: readonly string[];
  readonly signals: readonly WebsiteSignal[];
  readonly error?: string;
}

export interface ScoredProspect extends RawProspect {
  readonly websiteProfile?: WebsiteProfile;
  readonly primaryEmail?: string;
  readonly primaryPhone?: string;
  readonly aiAutomationScore: number;
  readonly fitTier: "A" | "B" | "C" | "D";
  readonly recommendedOffer:
    | "AI Readiness Audit"
    | "AI Automation Implementation"
    | "Managed AI + IT Support";
  readonly rationale: readonly string[];
}

export interface OutreachEmailDraft {
  readonly day: number;
  readonly subject: string;
  readonly body: string;
  readonly serviceFocus:
    | "AI Readiness Audit"
    | "AI Automation Implementation"
    | "Managed AI + IT Support";
}

export interface ColdCallScript {
  readonly objective: string;
  readonly opener: string;
  readonly qualifyingQuestions: readonly string[];
  readonly valuePitch: string;
  readonly voicemail: string;
  readonly followUpNote: string;
}

export interface ProspectStoreRecord extends ScoredProspect {
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly runCount: number;
  readonly lastRunId: string;
  readonly outreachStatus: "new" | "drafted" | "contacted" | "suppressed";
  readonly outreachChannel: "email" | "phone" | "email-and-phone" | "research-needed";
  readonly outreachDrafts: readonly OutreachEmailDraft[];
  readonly coldCallScript: ColdCallScript;
}

export interface ProspectFinderOptions {
  readonly areas: readonly ProspectSearchArea[];
  readonly industries: readonly ProspectIndustry[];
  readonly maxResultsPerQuery: number;
  readonly minScore: number;
  readonly includeSeeds: boolean;
  readonly outputDir: string;
}

export interface ProspectSource {
  search(options: ProspectFinderOptions): Promise<readonly RawProspect[]>;
}
