import type { StatusBadgeTone } from '@/components/ui';

export const APPLICATION_STAGES = [
    'APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN',
] as const;

/** The stages a candidate can still move through — everything else is terminal. */
export const OPEN_STAGES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'] as const;

export const JOB_POST_STATUSES = ['DRAFT', 'OPEN', 'ON_HOLD', 'FILLED', 'CLOSED'] as const;
export const EMPLOYMENT_TYPES = [
    'FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY',
] as const;

export type ApplicationStage = (typeof APPLICATION_STAGES)[number];
export type JobPostStatus = (typeof JOB_POST_STATUSES)[number];
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export interface Applicant {
    id: string;
    name: string;
    phone: string;
    email?: string | null;
    source?: string | null;
    current_company?: string | null;
    current_designation?: string | null;
    experience_years?: string | number | null;
    expected_salary?: string | number | null;
    resume_url?: string | null;
    skills?: string | null;
    notes?: string | null;
    address?: string | null;
    application_count?: number;
    applications?: JobApplication[];
}

export interface JobPost {
    id: string;
    code: string;
    title: string;
    status: JobPostStatus;
    /** Listed on the public careers board at /careers. */
    publish_to_board?: boolean;
    employment_type: EmploymentType;
    location?: string | null;
    openings: number;
    salary_min?: string | number | null;
    salary_max?: string | number | null;
    description?: string | null;
    requirements?: string | null;
    opened_at?: string | null;
    closing_date?: string | null;
    department_id?: string | null;
    designation_id?: string | null;
    hiring_manager_id?: string | null;
    department?: { id: string; name: string } | null;
    designation?: { id: string; name: string } | null;
    hiringManager?: { id: string; name: string } | null;
    application_count?: number;
    open_application_count?: number;
    hired_count?: number;
    applications?: JobApplication[];
    stage_counts?: Record<ApplicationStage, number>;
}

export interface JobApplicationEvent {
    id: string;
    from_stage?: ApplicationStage | null;
    to_stage: ApplicationStage;
    note?: string | null;
    created_at: string;
    createdBy?: { id: string; name?: string | null; email?: string | null } | null;
}

export interface JobApplication {
    id: string;
    stage: ApplicationStage;
    applied_at: string;
    stage_changed_at: string;
    expected_salary?: string | number | null;
    rating?: number | null;
    source?: string | null;
    notes?: string | null;
    /** The candidate's own note, written when they applied through /careers. Read-only to the workspace. */
    cover_letter?: string | null;
    rejection_reason?: string | null;
    hired_employee_id?: string | null;
    applicant?: Partial<Applicant> & { id: string; name: string; phone: string };
    jobPost?: { id: string; code?: string; title: string; status?: JobPostStatus };
    hiredEmployee?: { id: string; employee_code: string; name: string } | null;
    events?: JobApplicationEvent[];
}

export interface RecruitmentSummary {
    open_posts: number;
    open_openings: number;
    in_pipeline: number;
    hired_this_month: number;
    stage_counts: Record<ApplicationStage, number>;
}

/** Semantic tones only: emerald success, amber warning, red danger. */
export function stageTone(stage: ApplicationStage): StatusBadgeTone {
    switch (stage) {
        case 'HIRED':
            return 'success';
        case 'OFFER':
            return 'info';
        case 'REJECTED':
            return 'danger';
        case 'WITHDRAWN':
            return 'neutral';
        default:
            return 'warning';
    }
}

export function jobPostTone(status: JobPostStatus): StatusBadgeTone {
    switch (status) {
        case 'OPEN':
            return 'success';
        case 'FILLED':
            return 'info';
        case 'ON_HOLD':
            return 'warning';
        case 'CLOSED':
            return 'danger';
        default:
            return 'neutral';
    }
}

export function isOpenStage(stage: ApplicationStage): boolean {
    return (OPEN_STAGES as readonly string[]).includes(stage);
}
