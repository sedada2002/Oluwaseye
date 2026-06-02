import type { CandidateMatch, CandidateProfile, JobPosting } from "./types.js";

export class CandidateMatcher {
  match(jobs: readonly JobPosting[], candidates: readonly CandidateProfile[]): readonly CandidateMatch[] {
    const matches: CandidateMatch[] = [];
    for (const job of jobs) {
      for (const candidate of candidates.filter((profile) => profile.consentToContact)) {
        const match = scoreCandidate(job, candidate);
        if (match.score >= 45) {
          matches.push(match);
        }
      }
    }
    return matches.sort((left, right) => right.score - left.score);
  }
}

function scoreCandidate(job: JobPosting, candidate: CandidateProfile): CandidateMatch {
  const jobText = `${job.title} ${job.department ?? ""} ${job.description ?? ""}`.toLowerCase();
  const rationale: string[] = [];
  let score = 0;
  for (const skill of candidate.skills) {
    if (jobText.includes(skill.toLowerCase())) {
      score += 18;
      rationale.push(`skill match: ${skill}`);
    }
  }
  if (candidate.location !== undefined && job.location.toLowerCase().includes(candidate.location.toLowerCase())) {
    score += 12;
    rationale.push("location alignment");
  }
  if (candidate.title !== undefined && jobText.includes(candidate.title.toLowerCase())) {
    score += 15;
    rationale.push("title alignment");
  }

  const finalScore = Math.min(score, 100);
  return {
    candidate,
    job,
    score: finalScore,
    rationale,
    emailDraft: createCandidateEmail(job, candidate, rationale)
  };
}

function createCandidateEmail(
  job: JobPosting,
  candidate: CandidateProfile,
  rationale: readonly string[]
): CandidateMatch["emailDraft"] {
  return {
    subject: `${candidate.name}, ${job.company} role that may fit your background`,
    body: `Hi ${candidate.name},\n\nWe found a ${job.title} opportunity at ${job.company} that may align with your background: ${rationale.join(", ") || "your listed experience"}.\n\nRole: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location}\nPosting: ${job.url}\n\nIf you are interested, reply and we can help you tailor your resume, highlight the right skills, and prepare your application.\n\nIf you do not want opportunity alerts from us, reply "opt out" and we will suppress future messages.`
  };
}
