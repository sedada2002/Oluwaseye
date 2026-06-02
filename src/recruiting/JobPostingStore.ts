import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { JobPosting, JobStoreRecord } from "./types.js";

export interface JobStoreSummary {
  readonly allRecords: readonly JobStoreRecord[];
  readonly newRecords: readonly JobStoreRecord[];
  readonly updatedRecords: readonly JobStoreRecord[];
  readonly storePath: string;
}

export class JobPostingStore {
  public constructor(private readonly storePath = join("output", "recruiting", "job-store.json")) {}

  async read(): Promise<readonly JobStoreRecord[]> {
    try {
      return JSON.parse(await readFile(this.storePath, "utf8")) as readonly JobStoreRecord[];
    } catch {
      return [];
    }
  }

  async merge(jobs: readonly JobPosting[]): Promise<JobStoreSummary> {
    const now = new Date().toISOString();
    const existing = await this.read();
    const byKey = new Map(existing.map((record) => [recordKey(record), record]));
    const newRecords: JobStoreRecord[] = [];
    const updatedRecords: JobStoreRecord[] = [];

    for (const job of jobs) {
      const key = recordKey(job);
      const current = byKey.get(key);
      if (current === undefined) {
        const created: JobStoreRecord = {
          ...job,
          firstSeenAt: now,
          lastSeenAt: now,
          repostStatus: "drafted",
          linkedInDraft: createLinkedInDraft(job)
        };
        byKey.set(key, created);
        newRecords.push(created);
      } else {
        const updated: JobStoreRecord = {
          ...current,
          ...job,
          firstSeenAt: current.firstSeenAt,
          lastSeenAt: now,
          repostStatus: current.repostStatus,
          linkedInDraft: createLinkedInDraft(job)
        };
        byKey.set(key, updated);
        updatedRecords.push(updated);
      }
    }

    const allRecords = [...byKey.values()].sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
    await mkdir(dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, `${JSON.stringify(allRecords, null, 2)}\n`, "utf8");
    return { allRecords, newRecords, updatedRecords, storePath: this.storePath };
  }
}

function recordKey(job: Pick<JobPosting, "company" | "title" | "location" | "url">): string {
  return `${job.company}|${job.title}|${job.location}|${job.url}`.toLowerCase();
}

function createLinkedInDraft(job: JobPosting): string {
  return `Hiring signal: ${job.company} is recruiting for ${job.title} (${job.location}).\n\nWe help companies and candidates connect around AI, IT, cloud, customer-facing technology, and automation roles. If your background fits this opportunity, review the posting and prepare a targeted application.\n\nRole: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location}\nApply/source: ${job.url}\n\nNeed help matching your skills to roles like this? Contact us for AI-powered recruiting support.`;
}
