/**
 * The applicant's half of recruitment: the public careers board and the
 * job-seeker portal.
 *
 * The hiring workspace's own vocabulary lives in
 * `apps/frontend/src/app/(app)/hr/recruitment/types.ts` and stays there — it is
 * used by one app and names things the way an interviewer does. What is here is
 * only what the **applicant-facing** surfaces need, and it lives in
 * shared-types because those surfaces span the backend, the public board and
 * the portal.
 *
 * `CareersApplicationStage` mirrors the Prisma `JobApplicationStage` enum
 * exactly. The labels differ from the workspace's on purpose: a workspace reads
 * "Rejected", and the person who was rejected is told "Not selected".
 */

export const CareersApplicationStage = {
  APPLIED: "APPLIED",
  SCREENING: "SCREENING",
  INTERVIEW: "INTERVIEW",
  OFFER: "OFFER",
  HIRED: "HIRED",
  REJECTED: "REJECTED",
  WITHDRAWN: "WITHDRAWN",
} as const;
export type CareersApplicationStage =
  (typeof CareersApplicationStage)[keyof typeof CareersApplicationStage];

export const CAREERS_APPLICATION_STAGE_VALUES = Object.values(
  CareersApplicationStage,
) as CareersApplicationStage[];

/** How a stage is described **to the candidate**, not to the interviewer. */
export const CAREERS_STAGE_LABELS: Record<CareersApplicationStage, string> = {
  APPLIED: "Applied",
  SCREENING: "Under review",
  INTERVIEW: "Interview",
  OFFER: "Offer made",
  HIRED: "Hired",
  REJECTED: "Not selected",
  WITHDRAWN: "Withdrawn",
};

/**
 * Terminal stages. Nothing the applicant can do moves one of these, which is
 * what hides the Withdraw button.
 */
export const CAREERS_TERMINAL_STAGES: CareersApplicationStage[] = [
  CareersApplicationStage.HIRED,
  CareersApplicationStage.REJECTED,
  CareersApplicationStage.WITHDRAWN,
];

export function isCareersTerminalStage(stage: CareersApplicationStage): boolean {
  return CAREERS_TERMINAL_STAGES.includes(stage);
}

/**
 * The pipeline in the order it is walked, for the applicant's progress display.
 * Matches the `JobApplicationStage` declaration order, minus the two endings
 * that are not progress.
 */
export const CAREERS_STAGE_FLOW: CareersApplicationStage[] = [
  CareersApplicationStage.APPLIED,
  CareersApplicationStage.SCREENING,
  CareersApplicationStage.INTERVIEW,
  CareersApplicationStage.OFFER,
  CareersApplicationStage.HIRED,
];

/** Semantic tone for a stage chip, following the platform's colour rules. */
export function careersStageTone(
  stage: CareersApplicationStage,
): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (stage) {
    case CareersApplicationStage.HIRED:
      return "success";
    case CareersApplicationStage.OFFER:
    case CareersApplicationStage.SCREENING:
      return "info";
    case CareersApplicationStage.INTERVIEW:
      return "warning";
    case CareersApplicationStage.REJECTED:
      return "danger";
    default:
      return "neutral";
  }
}

export const CareersEmploymentType = {
  FULL_TIME: "FULL_TIME",
  PART_TIME: "PART_TIME",
  CONTRACT: "CONTRACT",
  INTERNSHIP: "INTERNSHIP",
  TEMPORARY: "TEMPORARY",
} as const;
export type CareersEmploymentType =
  (typeof CareersEmploymentType)[keyof typeof CareersEmploymentType];

export const CAREERS_EMPLOYMENT_TYPE_VALUES = Object.values(
  CareersEmploymentType,
) as CareersEmploymentType[];

export const CAREERS_EMPLOYMENT_TYPE_LABELS: Record<
  CareersEmploymentType,
  string
> = {
  FULL_TIME: "Full time",
  PART_TIME: "Part time",
  CONTRACT: "Contract",
  INTERNSHIP: "Internship",
  TEMPORARY: "Temporary",
};

/** One vacancy as the public board renders it. */
export interface CareersJobSummary {
  id: string;
  code: string;
  title: string;
  location: string | null;
  employment_type: CareersEmploymentType;
  salary_min: number | null;
  salary_max: number | null;
  openings: number;
  opened_at: string | null;
  closing_date: string | null;
  department: string | null;
  company: { id: string; name: string };
  /** False for an anonymous visitor; the portal uses it to disable "Apply". */
  already_applied?: boolean;
}

export interface CareersJobDetail extends CareersJobSummary {
  description: string | null;
  requirements: string | null;
}

/** The platform-wide profile, which is the `JobSeeker` row plus the login email. */
export interface CareersProfile {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  headline: string | null;
  location: string | null;
  summary: string | null;
  resume_url: string | null;
  resume_name: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  /** Whether the login has a proven email/mobile — governs claiming, see the service. */
  email_verified: boolean;
  mobile_verified: boolean;
}

/**
 * A timeline entry as the applicant sees it: the stage and when it happened,
 * and deliberately **not** the note. The hiring module's `note` field is where
 * interviewers write internal remarks, so publishing it would leak deliberation
 * the workspace never agreed to share.
 */
export interface CareersTimelineEntry {
  id: string;
  to_stage: CareersApplicationStage;
  created_at: string;
}

/** One application as the applicant sees it — never carries notes or a rating. */
export interface CareersApplication {
  id: string;
  stage: CareersApplicationStage;
  applied_at: string;
  stage_changed_at: string;
  expected_salary: number | null;
  /** What the candidate wrote when they applied — their own words, not the company's. */
  cover_letter: string | null;
  resume_url: string | null;
  job: {
    id: string;
    code: string;
    title: string;
    location: string | null;
    employment_type: CareersEmploymentType;
    /** Null when the company has since taken the post off the public board. */
    still_listed: boolean;
  };
  company: { id: string; name: string };
  timeline?: CareersTimelineEntry[];
}
