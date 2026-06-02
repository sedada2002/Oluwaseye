import type { ProspectFinderOptions, ProspectSource, RawProspect } from "../types.js";

const seedProspects: readonly RawProspect[] = [
  {
    source: "seed",
    sourceId: "seed-law-richmond",
    name: "Example Richmond Law Group",
    industry: "law-firm",
    city: "Richmond",
    state: "VA",
    website: "https://example.com",
    categories: ["law firm", "estate planning"]
  },
  {
    source: "seed",
    sourceId: "seed-clinic-norfolk",
    name: "Example Norfolk Family Clinic",
    industry: "medical-practice",
    city: "Norfolk",
    state: "VA",
    website: "https://example.org",
    categories: ["medical practice", "patient appointments"]
  },
  {
    source: "seed",
    sourceId: "seed-logistics-chesapeake",
    name: "Example Chesapeake Logistics",
    industry: "logistics",
    city: "Chesapeake",
    state: "VA",
    website: "https://example.net",
    categories: ["logistics", "freight"]
  },
  {
    source: "seed",
    sourceId: "seed-manufacturing-richmond-phone",
    name: "Example Richmond Machine Works",
    industry: "manufacturing",
    city: "Richmond",
    state: "VA",
    phone: "(804) 555-0188",
    website: "https://example.edu",
    categories: ["manufacturing", "machine shop"]
  }
];

export class SeedProspectSource implements ProspectSource {
  search(options: ProspectFinderOptions): Promise<readonly RawProspect[]> {
    if (!options.includeSeeds) {
      return Promise.resolve([]);
    }

    const citySet = new Set(options.areas.map((area) => area.city.toLowerCase()));
    const industrySet = new Set(options.industries);
    return Promise.resolve(
      seedProspects.filter(
        (prospect) =>
          citySet.has(prospect.city.toLowerCase()) && industrySet.has(prospect.industry)
      )
    );
  }
}
