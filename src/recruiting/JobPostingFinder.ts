import axios from "axios";
import { z } from "zod";

import { fortuneItCustomerFacingTargets } from "./companyCatalog.js";
import type { JobPosting, TargetCompany } from "./types.js";

const greenhouseSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      absolute_url: z.string(),
      location: z.object({ name: z.string() }).optional(),
      departments: z.array(z.object({ name: z.string() })).optional(),
      updated_at: z.string().optional()
    })
  )
});

const leverSchema = z.array(
  z.object({
    id: z.string(),
    text: z.string(),
    hostedUrl: z.string(),
    categories: z
      .object({
        location: z.string().optional(),
        team: z.string().optional()
      })
      .optional(),
    createdAt: z.number().optional()
  })
);

export interface JobPostingFinderOptions {
  readonly companies?: readonly TargetCompany[];
  readonly query: string;
  readonly maxJobsPerCompany: number;
}

export class JobPostingFinder {
  async find(options: JobPostingFinderOptions): Promise<readonly JobPosting[]> {
    const companies = options.companies ?? fortuneItCustomerFacingTargets;
    const jobs: JobPosting[] = [];
    for (const company of companies) {
      jobs.push(...(await this.findForCompany(company, options)));
    }
    return dedupe(jobs);
  }

  private async findForCompany(company: TargetCompany, options: JobPostingFinderOptions): Promise<readonly JobPosting[]> {
    if (company.ats?.provider === "greenhouse") {
      return this.findGreenhouse(company, options);
    }
    if (company.ats?.provider === "lever") {
      return this.findLever(company, options);
    }
    return [createResearchTask(company, options.query)];
  }

  private async findGreenhouse(company: TargetCompany, options: JobPostingFinderOptions): Promise<readonly JobPosting[]> {
    const slug = company.ats?.slug;
    if (slug === undefined) {
      return [];
    }
    const response = await axios.get(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, {
      timeout: 12_000
    });
    const parsed = greenhouseSchema.parse(response.data);
    return parsed.jobs
      .filter((job) => matchesQuery(`${job.title} ${job.departments?.map((department) => department.name).join(" ") ?? ""}`, options.query))
      .slice(0, options.maxJobsPerCompany)
      .map((job) => ({
        source: "greenhouse",
        sourceId: String(job.id),
        company: company.name,
        title: job.title,
        location: job.location?.name ?? "Not specified",
        url: job.absolute_url,
        ...(job.departments?.[0]?.name !== undefined ? { department: job.departments[0].name } : {}),
        ...(job.updated_at !== undefined ? { postedAt: job.updated_at } : {}),
        discoveredAt: new Date().toISOString()
      }));
  }

  private async findLever(company: TargetCompany, options: JobPostingFinderOptions): Promise<readonly JobPosting[]> {
    const slug = company.ats?.slug;
    if (slug === undefined) {
      return [];
    }
    const response = await axios.get(`https://api.lever.co/v0/postings/${slug}`, {
      params: { mode: "json" },
      timeout: 12_000
    });
    const parsed = leverSchema.parse(response.data);
    return parsed
      .filter((job) => matchesQuery(`${job.text} ${job.categories?.team ?? ""}`, options.query))
      .slice(0, options.maxJobsPerCompany)
      .map((job) => ({
        source: "lever",
        sourceId: job.id,
        company: company.name,
        title: job.text,
        location: job.categories?.location ?? "Not specified",
        url: job.hostedUrl,
        ...(job.categories?.team !== undefined ? { department: job.categories.team } : {}),
        ...(job.createdAt !== undefined ? { postedAt: new Date(job.createdAt).toISOString() } : {}),
        discoveredAt: new Date().toISOString()
      }));
  }
}

function createResearchTask(company: TargetCompany, query: string): JobPosting {
  return {
    source: "company-careers-research",
    sourceId: `${company.id}-${query}`,
    company: company.name,
    title: `Research current ${query} roles`,
    location: "Company careers site",
    url: company.careersUrl,
    department: company.sector,
    description:
      "This company does not expose a configured public ATS endpoint yet. Review or add its approved careers API/feed before automated collection.",
    discoveredAt: new Date().toISOString()
  };
}

function matchesQuery(value: string, query: string): boolean {
  const haystack = value.toLowerCase();
  return query
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((part) => part.length > 2)
    .some((part) => haystack.includes(part));
}

function dedupe(jobs: readonly JobPosting[]): readonly JobPosting[] {
  const byUrl = new Map<string, JobPosting>();
  for (const job of jobs) {
    byUrl.set(job.url.toLowerCase(), job);
  }
  return [...byUrl.values()];
}
