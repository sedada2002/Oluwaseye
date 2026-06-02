import type { RawProspect, ScoredProspect, WebsiteProfile } from "./types.js";

const industryBaseScores: Record<RawProspect["industry"], number> = {
  "medical-practice": 34,
  "law-firm": 32,
  "accounting-firm": 30,
  logistics: 36,
  "real-estate": 28,
  manufacturing: 35,
  nonprofit: 24,
  "government-contractor": 38
};

export class ProspectScorer {
  score(prospect: RawProspect, websiteProfile: WebsiteProfile | undefined): ScoredProspect {
    const rationale: string[] = [];
    let score = industryBaseScores[prospect.industry];
    const primaryPhone = prospect.phone ?? websiteProfile?.phones[0];
    rationale.push(`${prospect.industry} has repeatable admin, document, client, or operational workflows`);

    if (prospect.website !== undefined) {
      score += 12;
      rationale.push("has a website for outreach and workflow review");
    }

    if (websiteProfile?.reachable === true) {
      score += 10;
      rationale.push("website is reachable");
      if (websiteProfile.emails.length > 0) {
        score += 8;
        rationale.push("email address found on website");
      }
      if (websiteProfile.phones.length > 0) {
        score += 6;
        rationale.push("phone number found on website for call-first outreach");
      }
      for (const signal of websiteProfile.signals) {
        score += signal.points;
        rationale.push(signal.reason);
      }
    }

    if (prospect.reviewCount !== undefined && prospect.reviewCount >= 25) {
      score += 6;
      rationale.push("visible customer activity suggests active demand");
    }

    const cappedScore = Math.min(score, 100);
    return {
      ...prospect,
      ...(websiteProfile !== undefined ? { websiteProfile } : {}),
      ...(websiteProfile?.emails[0] !== undefined ? { primaryEmail: websiteProfile.emails[0] } : {}),
      ...(primaryPhone !== undefined ? { primaryPhone } : {}),
      aiAutomationScore: cappedScore,
      fitTier: getTier(cappedScore),
      recommendedOffer: getOffer(cappedScore),
      rationale: [...new Set(rationale)].slice(0, 8)
    };
  }
}

function getTier(score: number): ScoredProspect["fitTier"] {
  if (score >= 80) {
    return "A";
  }
  if (score >= 65) {
    return "B";
  }
  if (score >= 50) {
    return "C";
  }
  return "D";
}

function getOffer(score: number): ScoredProspect["recommendedOffer"] {
  if (score >= 78) {
    return "AI Automation Implementation";
  }
  if (score >= 62) {
    return "Managed AI + IT Support";
  }
  return "AI Readiness Audit";
}
