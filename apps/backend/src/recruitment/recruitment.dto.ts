import {
    IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString,
    Matches, Max, MaxLength, Min, ValidateIf, ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Same shape as employee and customer phones: digits, spaces and hyphens,
 * with an optional leading +. Empty is not a phone — see `blankApplicantPhoneToNull`.
 */
export const APPLICANT_PHONE_PATTERN = /^\+?[0-9\s\-]+$/;

/** Trim a posted phone. A blank box is "no phone", not an empty string. */
export function blankApplicantPhoneToNull(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}

/** Format-check only a real value. Null, omitted, and a blank box are "no phone". */
export function applicantPhoneWasEntered(_: unknown, value: unknown): boolean {
    if (value == null) return false;
    if (typeof value === 'string' && value.trim() === '') return false;
    return true;
}

export const JOB_POST_STATUSES = ['DRAFT', 'OPEN', 'ON_HOLD', 'FILLED', 'CLOSED'] as const;
export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY'] as const;
export const APPLICATION_STAGES = [
    'APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN',
] as const;

export type JobPostStatus = (typeof JOB_POST_STATUSES)[number];
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

// ── Job posts ─────────────────────────────────────────────────────────────────

export class CreateJobPostDto {
    @IsString() @MaxLength(200) title: string;

    @IsOptional() @IsString() department_id?: string;
    @IsOptional() @IsString() designation_id?: string;
    @IsOptional() @IsString() hiring_manager_id?: string;

    @IsOptional() @IsEnum(EMPLOYMENT_TYPES as any) employment_type?: EmploymentType;
    @IsOptional() @IsString() @MaxLength(200) location?: string;

    @IsOptional() @IsInt() @Min(1) @Max(9999) @Type(() => Number) openings?: number;

    @IsOptional() @IsNumber() @Min(0) @Type(() => Number) salary_min?: number;
    @IsOptional() @IsNumber() @Min(0) @Type(() => Number) salary_max?: number;

    @IsOptional() @IsString() description?: string;
    @IsOptional() @IsString() requirements?: string;

    @IsOptional() @IsEnum(JOB_POST_STATUSES as any) status?: JobPostStatus;
    @IsOptional() @IsDateString() closing_date?: string;

    /**
     * List this vacancy on the public, cross-tenant careers board at `/careers`.
     * Separate from `status` so OPEN keeps meaning "we are hiring" and does not
     * silently become "advertised to the internet" — see `JobPost.publish_to_board`.
     */
    @IsOptional() @IsBoolean() publish_to_board?: boolean;
}

export class UpdateJobPostDto extends CreateJobPostDto {
    @IsOptional() @IsString() @MaxLength(200) declare title: string;
}

// ── Applicants ────────────────────────────────────────────────────────────────

export class CreateApplicantDto {
    @IsString() @MaxLength(200) name: string;

    /**
     * Optional. A blank or whitespace-only value is stored as null. When a
     * number is entered it still has to match `APPLICANT_PHONE_PATTERN`.
     */
    @IsOptional()
    @Transform(({ value }) => blankApplicantPhoneToNull(value))
    @ValidateIf(applicantPhoneWasEntered)
    @IsString()
    @MaxLength(30)
    @Matches(APPLICANT_PHONE_PATTERN, { message: 'Invalid phone number format' })
    phone?: string | null;

    @IsOptional() @IsString() @MaxLength(200) email?: string;
    @IsOptional() @IsString() @MaxLength(100) source?: string;
    @IsOptional() @IsString() @MaxLength(200) current_company?: string;
    @IsOptional() @IsString() @MaxLength(200) current_designation?: string;

    @IsOptional() @IsNumber() @Min(0) @Max(70) @Type(() => Number) experience_years?: number;
    @IsOptional() @IsNumber() @Min(0) @Type(() => Number) expected_salary?: number;

    @IsOptional() @IsString() resume_url?: string;
    @IsOptional() @IsString() skills?: string;
    @IsOptional() @IsString() notes?: string;
    @IsOptional() @IsString() address?: string;
}

export class UpdateApplicantDto extends CreateApplicantDto {
    @IsOptional() @IsString() @MaxLength(200) declare name: string;

    /** Same rule as create: blank clears the number, a value must still match. */
    @IsOptional()
    @Transform(({ value }) => blankApplicantPhoneToNull(value))
    @ValidateIf(applicantPhoneWasEntered)
    @IsString()
    @MaxLength(30)
    @Matches(APPLICANT_PHONE_PATTERN, { message: 'Invalid phone number format' })
    declare phone?: string | null;
}

// ── Applications ──────────────────────────────────────────────────────────────

export class CreateApplicationDto {
    @IsString() job_post_id: string;

    /** Either an existing applicant… */
    @IsOptional() @IsString() applicant_id?: string;

    /** …or a new one, created inline from the same form. */
    @IsOptional()
    @ValidateNested()
    @Type(() => CreateApplicantDto)
    applicant?: CreateApplicantDto;

    @IsOptional() @IsEnum(APPLICATION_STAGES as any) stage?: ApplicationStage;
    @IsOptional() @IsDateString() applied_at?: string;
    @IsOptional() @IsNumber() @Min(0) @Type(() => Number) expected_salary?: number;
    @IsOptional() @IsInt() @Min(1) @Max(5) @Type(() => Number) rating?: number;
    @IsOptional() @IsString() @MaxLength(100) source?: string;
    @IsOptional() @IsString() notes?: string;
}

export class UpdateApplicationDto {
    @IsOptional() @IsNumber() @Min(0) @Type(() => Number) expected_salary?: number;
    @IsOptional() @IsInt() @Min(1) @Max(5) @Type(() => Number) rating?: number;
    @IsOptional() @IsString() @MaxLength(100) source?: string;
    @IsOptional() @IsString() notes?: string;
}

export class ChangeStageDto {
    @IsEnum(APPLICATION_STAGES as any) stage: ApplicationStage;

    @IsOptional() @IsString() note?: string;

    /** Only kept when the new stage is REJECTED; cleared on any other move. */
    @IsOptional() @IsString() rejection_reason?: string;
}

/**
 * Turning an accepted offer into an employee.
 *
 * Name is copied from the applicant. Phone is copied when the applicant has
 * one; hiring without a phone is refused, because an employee record requires
 * it. Everything else here is what an employee record needs and an applicant
 * record does not have.
 */
export class HireApplicationDto {
    @IsDateString() date_of_joining: string;

    @IsOptional() @IsString() department_id?: string;
    @IsOptional() @IsString() designation_id?: string;
    @IsOptional() @IsNumber() @Min(0) @Type(() => Number) basic_salary?: number;

    /** Close the post when this hire fills the last opening. Defaults to true. */
    @IsOptional() @IsBoolean() close_post_when_filled?: boolean;
}

export class ListJobPostsQueryDto {
    @IsOptional() @IsString() search?: string;
    @IsOptional() @IsEnum(JOB_POST_STATUSES as any) status?: JobPostStatus;
    @IsOptional() @IsString() department_id?: string;
}

export class ListApplicationsQueryDto {
    @IsOptional() @IsString() job_post_id?: string;
    @IsOptional() @IsString() applicant_id?: string;
    @IsOptional() @IsEnum(APPLICATION_STAGES as any) stage?: ApplicationStage;
    @IsOptional() @IsString() search?: string;

    /** Comma-separated stages, for the "still in the pipeline" view. */
    @IsOptional() @IsString() stages?: string;
}
