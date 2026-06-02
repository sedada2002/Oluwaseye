import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ScoredProspect } from "./types.js";

export interface ExportedProspectFiles {
  readonly jsonPath: string;
  readonly csvPath: string;
}

export class ProspectExporter {
  async export(outputDir: string, prospects: readonly ScoredProspect[]): Promise<ExportedProspectFiles> {
    await mkdir(outputDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const jsonPath = join(outputDir, `virginia-prospects-${stamp}.json`);
    const csvPath = join(outputDir, `virginia-prospects-${stamp}.csv`);

    await writeFile(jsonPath, `${JSON.stringify(prospects, null, 2)}\n`, "utf8");
    await writeFile(csvPath, toCsv(prospects), "utf8");

    return { jsonPath, csvPath };
  }
}

function toCsv(prospects: readonly ScoredProspect[]): string {
  const headers = [
    "fitTier",
    "aiAutomationScore",
    "name",
    "industry",
    "city",
    "state",
    "website",
    "primaryEmail",
    "allEmails",
    "primaryPhone",
    "websitePhones",
    "outreachChannel",
    "phone",
    "address",
    "recommendedOffer",
    "rating",
    "reviewCount",
    "signals",
    "rationale",
    "source"
  ];

  const rows = prospects.map((prospect) => [
    prospect.fitTier,
    String(prospect.aiAutomationScore),
    prospect.name,
    prospect.industry,
    prospect.city,
    prospect.state,
    prospect.website ?? "",
    prospect.primaryEmail ?? "",
    prospect.websiteProfile?.emails.join("; ") ?? "",
    prospect.primaryPhone ?? "",
    prospect.websiteProfile?.phones.join("; ") ?? "",
    "outreachChannel" in prospect && typeof prospect.outreachChannel === "string" ? prospect.outreachChannel : "",
    prospect.phone ?? "",
    prospect.address ?? "",
    prospect.recommendedOffer,
    prospect.rating?.toString() ?? "",
    prospect.reviewCount?.toString() ?? "",
    prospect.websiteProfile?.signals.map((signal) => signal.keyword).join("; ") ?? "",
    prospect.rationale.join("; "),
    prospect.source
  ]);

  return `${[headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n")}\n`;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}
