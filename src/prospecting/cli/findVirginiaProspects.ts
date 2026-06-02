import { defaultIndustries, defaultVirginiaAreas } from "../catalog.js";
import { VirginiaProspectFinder } from "../VirginiaProspectFinder.js";
import type { ProspectFinderOptions, ProspectIndustry, ProspectSearchArea } from "../types.js";

const args = parseArgs(process.argv.slice(2));
const options: ProspectFinderOptions = {
  areas: getAreas(args.city),
  industries: getIndustries(args.industry),
  maxResultsPerQuery: Number(args.limit ?? "10"),
  minScore: Number(args.minScore ?? "50"),
  includeSeeds: args.includeSeeds !== "false",
  outputDir: args.out ?? "output/prospecting"
};

const result = await new VirginiaProspectFinder().run(options);
const tierCounts = result.prospects.reduce<Record<string, number>>((counts, prospect) => {
  counts[prospect.fitTier] = (counts[prospect.fitTier] ?? 0) + 1;
  return counts;
}, {});

console.log(`Found ${String(result.prospects.length)} Virginia prospects with websites and AI-automation fit.`);
console.log(`Tier counts: ${JSON.stringify(tierCounts)}`);
console.log(`CSV: ${result.files.csvPath}`);
console.log(`JSON: ${result.files.jsonPath}`);
console.log("Top prospects:");
for (const prospect of result.prospects.slice(0, 10)) {
  console.log(
    `- [${prospect.fitTier}/${String(prospect.aiAutomationScore)}] ${prospect.name} (${prospect.city}) -> ${prospect.recommendedOffer}`
  );
}

function parseArgs(values: readonly string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const value of values) {
    if (!value.startsWith("--")) {
      continue;
    }

    const [rawKey, rawValue] = value.slice(2).split("=", 2);
    if (rawKey !== undefined && rawKey.length > 0) {
      parsed[rawKey] = rawValue ?? "true";
    }
  }

  return parsed;
}

function getAreas(cityArg: string | undefined): readonly ProspectSearchArea[] {
  if (cityArg === undefined || cityArg.trim().length === 0) {
    return defaultVirginiaAreas;
  }

  const requested = new Set(cityArg.split(",").map((city) => city.trim().toLowerCase()));
  return defaultVirginiaAreas.filter((area) => requested.has(area.city.toLowerCase()));
}

function getIndustries(industryArg: string | undefined): readonly ProspectIndustry[] {
  if (industryArg === undefined || industryArg.trim().length === 0) {
    return defaultIndustries;
  }

  const allowed = new Set(defaultIndustries);
  return industryArg
    .split(",")
    .map((industry) => industry.trim())
    .filter((industry): industry is ProspectIndustry => allowed.has(industry as ProspectIndustry));
}
