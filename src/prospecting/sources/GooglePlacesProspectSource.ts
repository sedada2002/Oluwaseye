import axios from "axios";
import { z } from "zod";

import { industryQueries } from "../catalog.js";
import type {
  ProspectFinderOptions,
  ProspectIndustry,
  ProspectSearchArea,
  ProspectSource,
  RawProspect
} from "../types.js";

const textSearchResponseSchema = z.object({
  results: z.array(
    z.object({
      place_id: z.string(),
      name: z.string(),
      formatted_address: z.string().optional(),
      rating: z.number().optional(),
      user_ratings_total: z.number().optional(),
      types: z.array(z.string()).optional()
    })
  ),
  status: z.string()
});

const detailsResponseSchema = z.object({
  result: z
    .object({
      formatted_phone_number: z.string().optional(),
      website: z.string().optional()
    })
    .optional(),
  status: z.string()
});

export class GooglePlacesProspectSource implements ProspectSource {
  public constructor(private readonly apiKey: string | undefined = process.env.GOOGLE_PLACES_API_KEY) {}

  async search(options: ProspectFinderOptions): Promise<readonly RawProspect[]> {
    if (this.apiKey === undefined || this.apiKey.trim().length === 0) {
      return [];
    }

    const prospects: RawProspect[] = [];
    for (const area of options.areas) {
      for (const industry of options.industries) {
        prospects.push(...(await this.searchAreaIndustry(area, industry, options.maxResultsPerQuery)));
      }
    }

    return prospects;
  }

  private async searchAreaIndustry(
    area: ProspectSearchArea,
    industry: ProspectIndustry,
    maxResults: number
  ): Promise<readonly RawProspect[]> {
    const results: RawProspect[] = [];
    for (const query of industryQueries[industry]) {
      if (results.length >= maxResults) {
        break;
      }

      const response = await axios.get("https://maps.googleapis.com/maps/api/place/textsearch/json", {
        params: {
          key: this.apiKey,
          query: `${query} in ${area.city}, Virginia`
        },
        timeout: 12_000
      });
      const parsed = textSearchResponseSchema.parse(response.data);
      if (parsed.status !== "OK" && parsed.status !== "ZERO_RESULTS") {
        throw new Error(`Google Places text search failed: ${parsed.status}`);
      }

      for (const place of parsed.results.slice(0, maxResults - results.length)) {
        const details = await this.getDetails(place.place_id);
        results.push({
          source: "google-places",
          sourceId: place.place_id,
          name: place.name,
          industry,
          city: area.city,
          state: "VA",
          ...(place.formatted_address !== undefined ? { address: place.formatted_address } : {}),
          ...(details.phone !== undefined ? { phone: details.phone } : {}),
          ...(details.website !== undefined ? { website: details.website } : {}),
          ...(place.rating !== undefined ? { rating: place.rating } : {}),
          ...(place.user_ratings_total !== undefined ? { reviewCount: place.user_ratings_total } : {}),
          categories: place.types ?? []
        });
      }
    }

    return results;
  }

  private async getDetails(placeId: string): Promise<{ readonly phone?: string; readonly website?: string }> {
    const response = await axios.get("https://maps.googleapis.com/maps/api/place/details/json", {
      params: {
        key: this.apiKey,
        place_id: placeId,
        fields: "formatted_phone_number,website"
      },
      timeout: 12_000
    });
    const parsed = detailsResponseSchema.parse(response.data);
    if (parsed.status !== "OK" && parsed.status !== "ZERO_RESULTS") {
      throw new Error(`Google Places details lookup failed: ${parsed.status}`);
    }

    const result = parsed.result;
    return {
      ...(result?.formatted_phone_number !== undefined ? { phone: result.formatted_phone_number } : {}),
      ...(result?.website !== undefined ? { website: result.website } : {})
    };
  }
}
