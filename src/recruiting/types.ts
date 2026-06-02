export interface TargetCompany {
  readonly id: string;
  readonly name: string;
  readonly sector: string;
  readonly careersUrl: string;
  readonly ats?: {
    readonly provider: "greenhouse" | "lever";
    readonly slug: string;
  };
}

export interface JobPosting {
  readonly source: string;
  readonly sourceId: string;
  readonly company: string;
  readonly title: string;
  readonly location: string;
  readonly url: string;
  readonly department?: string;
  readonly description?: string;
  readonly postedAt?: string;
  readonly discoveredAt: string;
}

export interface JobStoreRecord extends JobPosting {
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly repostStatus: "new" | "drafted" | "posted" | "skipped";
  readonly linkedInDraft: string;
}

export interface CandidateProfile {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly title?: string;
  readonly location?: string;
  readonly skills: readonly string[];
  readonly experienceSummary: string;
  readonly consentToContact: boolean;
  readonly source: string;
}

export interface CandidateMatch {
  readonly candidate: CandidateProfile;
  readonly job: JobPosting;
  readonly score: number;
  readonly rationale: readonly string[];
  readonly emailDraft: {
    readonly subject: string;
    readonly body: string;
  };
}
