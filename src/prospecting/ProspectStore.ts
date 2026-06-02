import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { OutreachTemplateGenerator } from "./OutreachTemplateGenerator.js";
import type { ProspectStoreRecord, ScoredProspect } from "./types.js";

export interface ProspectStoreSummary {
  readonly allRecords: readonly ProspectStoreRecord[];
  readonly newRecords: readonly ProspectStoreRecord[];
  readonly updatedRecords: readonly ProspectStoreRecord[];
  readonly storePath: string;
}

export class ProspectStore {
  public constructor(
    private readonly storePath = join("output", "prospecting", "prospect-store.json"),
    private readonly outreachGenerator = new OutreachTemplateGenerator()
  ) {}

  async read(): Promise<readonly ProspectStoreRecord[]> {
    try {
      return JSON.parse(await readFile(this.storePath, "utf8")) as readonly ProspectStoreRecord[];
    } catch {
      return [];
    }
  }

  async merge(prospects: readonly ScoredProspect[], runId: string): Promise<ProspectStoreSummary> {
    const now = new Date().toISOString();
    const existingRecords = await this.read();
    const byKey = new Map(existingRecords.map((record) => [recordKey(record), record]));
    const newRecords: ProspectStoreRecord[] = [];
    const updatedRecords: ProspectStoreRecord[] = [];

    for (const prospect of prospects) {
      const key = recordKey(prospect);
      const existing = byKey.get(key);
      if (existing === undefined) {
        const created: ProspectStoreRecord = {
          ...prospect,
          firstSeenAt: now,
          lastSeenAt: now,
          runCount: 1,
          lastRunId: runId,
          outreachStatus: "drafted",
          outreachChannel: getOutreachChannel(prospect),
          outreachDrafts: this.outreachGenerator.generate(prospect),
          coldCallScript: this.outreachGenerator.generateColdCallScript(prospect)
        };
        byKey.set(key, created);
        newRecords.push(created);
      } else {
        const updated: ProspectStoreRecord = {
          ...existing,
          ...prospect,
          firstSeenAt: existing.firstSeenAt,
          lastSeenAt: now,
          runCount: existing.runCount + 1,
          lastRunId: runId,
          outreachStatus: existing.outreachStatus,
          outreachChannel: getOutreachChannel(prospect),
          outreachDrafts: this.outreachGenerator.generate(prospect),
          coldCallScript: this.outreachGenerator.generateColdCallScript(prospect)
        };
        byKey.set(key, updated);
        updatedRecords.push(updated);
      }
    }

    const allRecords = [...byKey.values()].sort((left, right) => right.aiAutomationScore - left.aiAutomationScore);
    await mkdir(dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, `${JSON.stringify(allRecords, null, 2)}\n`, "utf8");
    return { allRecords, newRecords, updatedRecords, storePath: this.storePath };
  }
}

function recordKey(prospect: Pick<ScoredProspect, "website" | "name" | "city">): string {
  return `${prospect.website ?? prospect.name}|${prospect.city}`.toLowerCase();
}

function getOutreachChannel(prospect: ScoredProspect): ProspectStoreRecord["outreachChannel"] {
  if (prospect.primaryEmail !== undefined && prospect.primaryPhone !== undefined) {
    return "email-and-phone";
  }
  if (prospect.primaryEmail !== undefined) {
    return "email";
  }
  if (prospect.primaryPhone !== undefined) {
    return "phone";
  }
  return "research-needed";
}
