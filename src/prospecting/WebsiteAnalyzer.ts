import axios from "axios";

import type { WebsiteProfile, WebsiteSignal } from "./types.js";

const automationSignals: readonly WebsiteSignal[] = [
  { keyword: "appointment", reason: "appointment-heavy workflow", points: 8 },
  { keyword: "schedule", reason: "scheduling workflow", points: 7 },
  { keyword: "intake", reason: "client or patient intake workflow", points: 10 },
  { keyword: "form", reason: "manual form capture", points: 6 },
  { keyword: "pdf", reason: "document-heavy operations", points: 5 },
  { keyword: "portal", reason: "customer or client portal", points: 8 },
  { keyword: "quote", reason: "quote and follow-up workflow", points: 7 },
  { keyword: "estimate", reason: "estimate workflow", points: 7 },
  { keyword: "case", reason: "case or matter tracking", points: 8 },
  { keyword: "claims", reason: "claims or request processing", points: 9 },
  { keyword: "dispatch", reason: "dispatch or routing workflow", points: 10 },
  { keyword: "tracking", reason: "status tracking workflow", points: 8 },
  { keyword: "donate", reason: "donor and campaign operations", points: 6 },
  { keyword: "careers", reason: "growing organization likely needs systems support", points: 4 },
  { keyword: "cybersecurity", reason: "security-aware buyer", points: 5 },
  { keyword: "compliance", reason: "compliance-sensitive operation", points: 8 },
  { keyword: "HIPAA", reason: "regulated medical data workflow", points: 12 },
  { keyword: "government", reason: "contract or compliance-heavy operations", points: 8 }
];

export class WebsiteAnalyzer {
  async analyze(url: string): Promise<WebsiteProfile> {
    try {
      const normalizedUrl = normalizeUrl(url);
      const response = await fetchHtml(normalizedUrl);
      const html = response.data;
      const searchableText = stripHtml(html).toLowerCase();
      const contactUrls = getContactUrls(normalizedUrl, html).slice(0, 3);
      const contactHtml = await fetchContactPages(contactUrls);
      const combinedHtml = [html, ...contactHtml.map((page) => page.html)].join(" ");
      return {
        url: normalizedUrl,
        reachable: true,
        ...extractTitleAndDescription(html),
        emails: extractEmails(combinedHtml),
        phones: extractPhones(combinedHtml),
        contactPagesChecked: contactHtml.map((page) => page.url),
        signals: findSignals(searchableText)
      };
    } catch (error) {
      return {
        url,
        reachable: false,
        emails: [],
        phones: [],
        contactPagesChecked: [],
        signals: [],
        error: error instanceof Error ? error.message : "Unknown website fetch error"
      };
    }
  }
}

async function fetchHtml(url: string): Promise<{ readonly data: string }> {
  const response = await axios.get<string>(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 prospect-research-bot/1.0 (+business development research)"
    },
    maxRedirects: 5,
    timeout: 12_000,
    responseType: "text",
    transformResponse: [(data) => String(data)]
  });
  return { data: response.data };
}

function normalizeUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  return `https://${url}`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitleAndDescription(html: string): { readonly title?: string; readonly description?: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const descriptionMatch = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i.exec(html);
  return {
    ...(titleMatch?.[1] !== undefined ? { title: decodeHtml(titleMatch[1]).trim().slice(0, 160) } : {}),
    ...(descriptionMatch?.[1] !== undefined
      ? { description: decodeHtml(descriptionMatch[1]).trim().slice(0, 240) }
      : {})
  };
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function findSignals(text: string): readonly WebsiteSignal[] {
  return automationSignals.filter((signal) => text.includes(signal.keyword.toLowerCase()));
}

function extractEmails(html: string): readonly string[] {
  const decoded = decodeHtml(html)
    .replace(/\s*\[at\]\s*/gi, "@")
    .replace(/\s*\(at\)\s*/gi, "@")
    .replace(/\s+at\s+/gi, "@")
    .replace(/\s*\[dot\]\s*/gi, ".")
    .replace(/\s*\(dot\)\s*/gi, ".")
    .replace(/\s+dot\s+/gi, ".");
  const matches = decoded.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  const blocked = ["example.com", "sentry.io", "wixpress.com", "wordpress.com", "schema.org"];
  return [...new Set(matches.map((email) => email.toLowerCase()))]
    .filter((email) => !blocked.some((domain) => email.endsWith(`@${domain}`)))
    .slice(0, 8);
}

function extractPhones(html: string): readonly string[] {
  const decoded = decodeHtml(html);
  const matches = decoded.match(/(?:\+?1[\s.-]?)?(?:\(?[2-9]\d{2}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g) ?? [];
  return [...new Set(matches.map(normalizePhone).filter((phone) => phone.length > 0))].slice(0, 8);
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  const normalized = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (normalized.length !== 10) {
    return "";
  }
  return `(${normalized.slice(0, 3)}) ${normalized.slice(3, 6)}-${normalized.slice(6)}`;
}

function getContactUrls(baseUrl: string, html: string): readonly string[] {
  const base = new URL(baseUrl);
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]]
  );
  const contactLike = hrefs.filter((href) => /contact|about|team|staff|locations?/i.test(href));
  const urls = contactLike.flatMap((href) => {
    try {
      const candidate = new URL(href, base);
      if (candidate.hostname !== base.hostname) {
        return [];
      }
      candidate.hash = "";
      return [candidate.toString()];
    } catch {
      return [];
    }
  });
  return [...new Set(urls)];
}

async function fetchContactPages(urls: readonly string[]): Promise<readonly { readonly url: string; readonly html: string }[]> {
  const pages: { readonly url: string; readonly html: string }[] = [];
  for (const url of urls) {
    try {
      const response = await fetchHtml(url);
      pages.push({ url, html: response.data });
    } catch {
      // Contact pages are best-effort; the homepage can still produce a valid profile.
    }
  }
  return pages;
}
