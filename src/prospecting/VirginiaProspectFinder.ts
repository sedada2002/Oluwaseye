import { ProspectExporter, type ExportedProspectFiles } from "./ProspectExporter.js";
import { ProspectScorer } from "./ProspectScorer.js";
import { ProspectStore, type ProspectStoreSummary } from "./ProspectStore.js";
import { WebsiteAnalyzer } from "./WebsiteAnalyzer.js";
import { GooglePlacesProspectSource } from "./sources/GooglePlacesProspectSource.js";
import { SeedProspectSource } from "./sources/SeedProspectSource.js";
import type { ProspectFinderOptions, ProspectSource, RawProspect, ScoredProspect } from "./types.js";

export interface ProspectFinderResult {
  readonly prospects: readonly ScoredProspect[];
  readonly files: ExportedProspectFiles;
  readonly store: ProspectStoreSummary;
  readonly runId: string;
}

export class VirginiaProspectFinder {
  public constructor(
    private readonly sources: readonly ProspectSource[] = [
      new GooglePlacesProspectSource(),
      new SeedProspectSource()
    ],
    private readonly websiteAnalyzer = new WebsiteAnalyzer(),
    private readonly scorer = new ProspectScorer(),
    private readonly exporter = new ProspectExporter(),
    private readonly store = new ProspectStore()
  ) {}

  async run(options: ProspectFinderOptions): Promise<ProspectFinderResult> {
    const runId = `run-${new Date().toISOString()}`;
    const rawProspects = await collectFromSources(this.sources, options);
    const deduped = dedupeProspects(rawProspects);
    const scored: ScoredProspect[] = [];

    for (const prospect of deduped) {
      const websiteProfile =
        prospect.website !== undefined ? await this.websiteAnalyzer.analyze(prospect.website) : undefined;
      const scoredProspect = this.scorer.score(prospect, websiteProfile);
      if (scoredProspect.aiAutomationScore >= options.minScore && scoredProspect.website !== undefined) {
        scored.push(scoredProspect);
      }
    }

    const sorted = scored.sort((left, right) => right.aiAutomationScore - left.aiAutomationScore);
    const files = await this.exporter.export(options.outputDir, sorted);
    const store = await this.store.merge(sorted, runId);
    return { prospects: sorted, files, store, runId };
  }
}

async function collectFromSources(
  sources: readonly ProspectSource[],
  options: ProspectFinderOptions
): Promise<readonly RawProspect[]> {
  const results = await Promise.all(sources.map((source) => source.search(options)));
  return results.flat();
}

function dedupeProspects(prospects: readonly RawProspect[]): readonly RawProspect[] {
  const byKey = new Map<string, RawProspect>();
  for (const prospect of prospects) {
    const key = `${prospect.website ?? prospect.name}|${prospect.city}`.toLowerCase();
    const existing = byKey.get(key);
    if (existing === undefined || (prospect.website !== undefined && existing.website === undefined)) {
      byKey.set(key, prospect);
    }
  }

  return [...byKey.values()];
}
