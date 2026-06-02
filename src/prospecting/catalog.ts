import type { ProspectIndustry, ProspectSearchArea } from "./types.js";

export const defaultVirginiaAreas: readonly ProspectSearchArea[] = [
  { city: "Alexandria", state: "VA" },
  { city: "Arlington", state: "VA" },
  { city: "Fairfax", state: "VA" },
  { city: "Richmond", state: "VA" },
  { city: "Virginia Beach", state: "VA" },
  { city: "Norfolk", state: "VA" },
  { city: "Chesapeake", state: "VA" },
  { city: "Newport News", state: "VA" },
  { city: "Roanoke", state: "VA" },
  { city: "Lynchburg", state: "VA" },
  { city: "Charlottesville", state: "VA" },
  { city: "Fredericksburg", state: "VA" }
];

export const defaultIndustries: readonly ProspectIndustry[] = [
  "medical-practice",
  "law-firm",
  "accounting-firm",
  "logistics",
  "real-estate",
  "manufacturing",
  "nonprofit",
  "government-contractor"
];

export const industryQueries: Record<ProspectIndustry, readonly string[]> = {
  "medical-practice": [
    "medical practice",
    "dental practice",
    "physical therapy clinic",
    "urgent care clinic"
  ],
  "law-firm": ["law firm", "immigration attorney", "personal injury lawyer", "estate planning attorney"],
  "accounting-firm": ["accounting firm", "CPA firm", "tax preparation firm", "bookkeeping service"],
  logistics: ["logistics company", "freight broker", "trucking company", "warehouse service"],
  "real-estate": ["real estate brokerage", "property management company", "commercial real estate"],
  manufacturing: ["manufacturer", "machine shop", "food manufacturer", "industrial supplier"],
  nonprofit: ["nonprofit organization", "community nonprofit", "charity organization"],
  "government-contractor": ["government contractor", "defense contractor", "IT government contractor"]
};

export const industryLabels: Record<ProspectIndustry, string> = {
  "medical-practice": "Medical Practice",
  "law-firm": "Law Firm",
  "accounting-firm": "Accounting Firm",
  logistics: "Logistics",
  "real-estate": "Real Estate",
  manufacturing: "Manufacturing",
  nonprofit: "Nonprofit",
  "government-contractor": "Government Contractor"
};
