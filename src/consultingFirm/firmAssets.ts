export interface ServicePackage {
  readonly id: string;
  readonly name: string;
  readonly priceRange: string;
  readonly promise: string;
  readonly deliverables: readonly string[];
  readonly bestFor: string;
}

export interface AgentBlueprint {
  readonly name: string;
  readonly purpose: string;
  readonly protocol: readonly string[];
  readonly transparencyMetric: string;
}

export interface PromptFramework {
  readonly name: string;
  readonly useCase: string;
  readonly instruction: string;
}

export const firmPositioning = {
  name: "Sovereign AI Systems",
  headline: "AI literacy, agentic automation, and managed IT support for high-agency businesses.",
  subheadline:
    "We help Virginia and U.S. businesses build practical AI worker systems that save time, protect human judgment, improve customer experience, and create new revenue capacity.",
  principles: [
    "Think first, automate second.",
    "AI should extend the client gift, not replace it.",
    "Every agent needs a protocol, a measurable outcome, and transparent reporting.",
    "Research, reports, and reminders are the first assistant layer.",
    "The goal is not hype; the goal is shipped systems that make money or save time."
  ]
};

export const servicePackages: readonly ServicePackage[] = [
  {
    id: "literacy",
    name: "AI Literacy & Cognitive Wealth Workshop",
    priceRange: "$1,500-$5,000",
    promise: "Teach leaders and staff how to use AI safely, practically, and without weakening judgment.",
    deliverables: [
      "AI literacy training for non-technical teams",
      "Think-first workflow and hallucination-checking guide",
      "Role-specific prompt library",
      "AI ethics, bias, privacy, and opt-out basics",
      "30-day personal productivity sprint"
    ],
    bestFor: "Teams that are curious but not yet confident using AI."
  },
  {
    id: "audit",
    name: "AI Readiness & Automation Audit",
    priceRange: "$3,500-$12,000",
    promise: "Map the repetitive workflows where AI agents can produce fast ROI.",
    deliverables: [
      "Workflow inventory and automation-readiness score",
      "Customer journey and website conversion review",
      "Agent opportunity map across admin, sales, support, and operations",
      "Risk review for data, security, compliance, and human oversight",
      "30-60-90 day execution roadmap"
    ],
    bestFor: "Businesses with manual follow-up, intake, scheduling, reporting, or document work."
  },
  {
    id: "agents",
    name: "Agentic Operations Buildout",
    priceRange: "$10,000-$50,000",
    promise: "Build AI worker systems with protocols, reporting, and handoff rules.",
    deliverables: [
      "Research, reports, and reminders assistant",
      "Lead qualification and CRM update agent",
      "Customer service and escalation agent",
      "Proposal and follow-up draft agent",
      "Transparency dashboard showing actions, outputs, and unresolved items"
    ],
    bestFor: "Growing companies that want the output of a support team without hiring too early."
  },
  {
    id: "voice",
    name: "Voice Framework & Second Brain System",
    priceRange: "$7,500-$25,000",
    promise: "Capture the founder's thinking, language, IP, and decision patterns so AI output sounds aligned.",
    deliverables: [
      "Business brain document and brand voice architecture",
      "Offer, audience, and worldview knowledge base",
      "Prompt and response standards",
      "Soft-IP and hard-IP discovery from existing content",
      "Reusable content, sales, and training assets"
    ],
    bestFor: "Founders, creators, consultants, and expert-led businesses."
  },
  {
    id: "managed",
    name: "Managed AI + IT Support",
    priceRange: "$2,000-$15,000/month",
    promise: "Keep AI automations, cloud tools, cybersecurity basics, and staff adoption working over time.",
    deliverables: [
      "Monthly system health review",
      "Automation maintenance and workflow improvement",
      "Cybersecurity and access-control checks",
      "Staff training and AI policy updates",
      "Quarterly ROI and next-agent roadmap"
    ],
    bestFor: "Organizations that want ongoing support instead of a one-time project."
  },
  {
    id: "recruiting",
    name: "AI Talent Recruiting & Job Intelligence",
    priceRange: "$3,000-$20,000/month",
    promise: "Help organizations find AI, IT, cloud, cybersecurity, and customer-facing technology talent faster.",
    deliverables: [
      "Role intake and ideal-candidate profile",
      "Job posting monitoring from approved company career sources",
      "Candidate matching against opted-in talent lists",
      "LinkedIn announcement drafts and recruiter email sequences",
      "Interview shortlist, scorecards, and hiring workflow automation"
    ],
    bestFor: "Companies hiring technical, customer success, support, implementation, and AI operations talent."
  }
];

export const agentBlueprints: readonly AgentBlueprint[] = [
  {
    name: "Three Rs Executive Assistant",
    purpose: "Research, reports, and reminders for owners and leadership teams.",
    protocol: [
      "Read approved sources and client context.",
      "Send daily or weekly reports on the topics that matter.",
      "Remind the owner of follow-ups, meetings, and unresolved decisions.",
      "Escalate uncertainty instead of guessing."
    ],
    transparencyMetric: "Daily digest includes sources used, open questions, and next actions."
  },
  {
    name: "Lead Qualification Agent",
    purpose: "Categorize inbound leads, score urgency, and prepare follow-up drafts.",
    protocol: [
      "Read new form submissions or inbox leads.",
      "Classify buyer type, service need, timeline, and fit.",
      "Draft a response in the company's voice.",
      "Send high-value or sensitive leads to a human before action."
    ],
    transparencyMetric: "Lead log shows score, rationale, draft, and handoff status."
  },
  {
    name: "Unreasonable Hospitality Agent",
    purpose: "Improve customer experience with personalized follow-ups and support triage.",
    protocol: [
      "Detect repeat customers, top accounts, birthdays, renewals, or dissatisfaction signals.",
      "Suggest personalized appreciation, offers, or service recovery actions.",
      "Create support tickets when sentiment or risk crosses a threshold.",
      "Never promise refunds, legal terms, or clinical advice without approval."
    ],
    transparencyMetric: "Weekly report tracks retention opportunities, escalations, and saved accounts."
  },
  {
    name: "Proposal Builder Agent",
    purpose: "Turn discovery notes into a domain-specific proposal and implementation roadmap.",
    protocol: [
      "Summarize the prospect's business model and workflow pain.",
      "Map pain to the right package and ROI story.",
      "Create a proposal, scope, timeline, and assumptions.",
      "Argue against the recommendation before finalizing."
    ],
    transparencyMetric: "Proposal includes assumptions, risks, dependencies, and reasons for the chosen package."
  },
  {
    name: "Agent Transparency Auditor",
    purpose: "Check that deployed agents are actually working and not just reporting success.",
    protocol: [
      "Review logs, outputs, skipped tasks, errors, and human escalations.",
      "Compare expected protocols against actual behavior.",
      "Flag hallucinations, missing context, and risky autonomy.",
      "Recommend fixes or pause rules."
    ],
    transparencyMetric: "Audit score shows completed tasks, failed tasks, confidence, and intervention needs."
  },
  {
    name: "Recruiting Intelligence Agent",
    purpose: "Monitor approved employer career sources, draft LinkedIn posts, and match opted-in candidates to roles.",
    protocol: [
      "Check approved company career APIs, feeds, or pages on a schedule.",
      "Store new and updated roles with source URLs.",
      "Draft LinkedIn repost copy for human approval.",
      "Match roles to candidates who consented to job alerts.",
      "Generate candidate emails and suppress anyone who opts out."
    ],
    transparencyMetric: "Recruiting dashboard shows source, discovered time, repost status, match score, and outreach status."
  }
];

export const promptFrameworks: readonly PromptFramework[] = [
  {
    name: "Think-First Protocol",
    useCase: "Protect human judgment before asking AI to assist.",
    instruction:
      "Before using AI, write the goal, why it matters, what you already believe, what evidence would change your mind, and what decision you own."
  },
  {
    name: "Forge Prompt",
    useCase: "Challenge weak ideas, ego protection, and unfocused execution.",
    instruction:
      "Critique this idea without protecting my ego. Identify blind spots, false assumptions, missing execution steps, and the one action I must finish before chasing a new idea."
  },
  {
    name: "Boil The Ocean Prompt",
    useCase: "Get a complete artifact instead of a shallow plan.",
    instruction:
      "Complete the whole thing. Include research, tests, documentation, edge cases, and the permanent solve when it is within reach. Do not leave dangling threads."
  },
  {
    name: "Argue Against Yourself",
    useCase: "Reduce hallucinations and one-sided recommendations.",
    instruction:
      "Give the strongest case for this recommendation, the strongest case against it, the evidence needed to decide, and where you may be wrong."
  },
  {
    name: "Expert Vocabulary Upgrade",
    useCase: "Help non-technical clients get expert-level results.",
    instruction:
      "Give me the vocabulary, concepts, metrics, and questions an expert would use in this domain, then rewrite my request using that language."
  }
];

export const sprintRoadmap = [
  "Write the offer and why it matters.",
  "Research the buyer, pain, market, and objections.",
  "Package one service that can be sold in 30 days.",
  "Build the simplest version that delivers a measurable result.",
  "Ship to real prospects, collect feedback, and iterate.",
  "Turn delivery into a repeatable protocol and agent blueprint."
] as const;
