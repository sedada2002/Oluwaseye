import { industryLabels } from "./catalog.js";
import type { ColdCallScript, OutreachEmailDraft, ScoredProspect } from "./types.js";

export class OutreachTemplateGenerator {
  generate(prospect: ScoredProspect): readonly OutreachEmailDraft[] {
    const industry = industryLabels[prospect.industry];
    const businessName = prospect.name;
    const city = prospect.city;
    const signals = prospect.websiteProfile?.signals.map((signal) => signal.reason).slice(0, 3) ?? [];
    const signalText = signals.length > 0 ? signals.join(", ") : "manual follow-up and admin workflows";

    return [
      {
        day: 1,
        serviceFocus: "AI Readiness Audit",
        subject: `${businessName}: AI readiness + workflow opportunity`,
        body: `Hi ${businessName} team,\n\nI noticed your ${industry.toLowerCase()} serves the ${city} area and appears to have ${signalText}.\n\nWe help businesses build practical AI worker systems without losing human judgment. The first step is an AI Readiness Audit: we map repetitive work, data risks, customer follow-up gaps, and the best first agent to build.\n\nThe goal is simple: save time, protect your team from AI mistakes, and find the workflows where automation can produce real ROI.\n\nWould it be worth sending over a short audit checklist tailored to ${industry.toLowerCase()} operations?\n\nBest,\n[Your Name]\n\nP.S. If this is not useful, reply "opt out" and I will not follow up.`
      },
      {
        day: 2,
        serviceFocus: "AI Automation Implementation",
        subject: `A first AI agent for ${businessName}`,
        body: `Hi ${businessName} team,\n\nA useful first AI agent is usually not flashy. It is a worker with a clear protocol: research, report, remind, draft, update records, or escalate to a human.\n\nFor ${industry.toLowerCase()} teams, common wins include intake, scheduling, document routing, CRM updates, quote follow-up, customer support triage, and reporting. We build these with transparency so you can see what the agent did, what it skipped, and what needs human review.\n\nIf helpful, I can send 3 first-agent ideas that fit ${businessName}'s likely workflow.\n\nBest,\n[Your Name]\n\nOpt-out note: reply "opt out" and I will remove this address from future outreach.`
      },
      {
        day: 3,
        serviceFocus: "Managed AI + IT Support",
        subject: `Keeping AI systems useful and safe at ${businessName}`,
        body: `Hi ${businessName} team,\n\nOne issue we see after companies try AI tools is that nobody owns maintenance, security, staff training, prompt quality, or workflow updates.\n\nOur Managed AI + IT Support keeps automations running, reviews cybersecurity basics, updates agent protocols, trains staff, and watches for risky AI behavior like hallucinated answers or tasks that should be escalated to a person.\n\nWould a monthly support model be useful for your team this year?\n\nBest,\n[Your Name]\n\nTo stop these notes, reply "opt out."`
      }
    ];
  }

  generateColdCallScript(prospect: ScoredProspect): ColdCallScript {
    const industry = industryLabels[prospect.industry];
    const businessName = prospect.name;
    const city = prospect.city;
    const signals = prospect.websiteProfile?.signals.map((signal) => signal.reason).slice(0, 3) ?? [];
    const signalText = signals.length > 0 ? signals.join(", ") : "manual admin, follow-up, or customer-service workflows";

    return {
      objective: `Book a 15-minute AI readiness conversation with ${businessName}.`,
      opener: `Hi, my name is [Your Name]. I work with ${industry.toLowerCase()} teams in Virginia on practical AI automation and IT support. I was reviewing ${businessName} in ${city} and wanted to ask who handles workflow improvement, technology, or operations there.`,
      qualifyingQuestions: [
        "Are you currently using AI or automation for intake, scheduling, follow-up, reporting, or customer service?",
        "What repetitive admin task costs your team the most time each week?",
        "Do you have someone responsible for keeping AI tools, cloud systems, and cybersecurity practices organized?",
        "If we found 2-3 automation opportunities with low risk, who would need to review them?"
      ],
      valuePitch: `The reason I am calling is that businesses like yours often have ${signalText}. We help map those workflows, identify where AI agents can safely save time, and build the first practical automation without disrupting the team.`,
      voicemail: `Hi, this is [Your Name]. I am reaching out because we help ${industry.toLowerCase()} teams in Virginia use AI automation and managed IT support to reduce repetitive work and improve follow-up. I had a few ideas for ${businessName}. You can reach me at [Your Phone]. Again, [Your Name], [Your Phone].`,
      followUpNote: `Called ${businessName}. If connected, log decision maker, pain points, and whether to send the AI Readiness Audit checklist. If voicemail, call again in 2 business days before marking as no response.`
    };
  }
}
