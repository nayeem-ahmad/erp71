import {
    IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString,
    Max, MaxLength, Min,
} from 'class-validator';
import { Type } from 'class-transformer';

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
}

export class UpdateJobPostDto extends CreateJobPostDto {
    @IsOptional() @IsString() @MaxLength(200) declare title: string;
}

// ── Applicants ────────────────────────────────────────────────────────────────

export class CreateApplicantDto {
    @IsString() @MaxLength(200) name: string;
    @IsString() @MaxLength(30) phone: string;

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
    @IsOptional() @IsString() @MaxLength(30) declare phone: string;
}

// ── Applications ──────────────────────────────────────────────────────────────

export class CreateApplicationDto {
    @IsString() job_post_id: string;

    /** Either an existing applicant… */
    @IsOptional() @IsString() applicant_id?: string;

    /** …or a new one, created inline from the same form. */
    @IsOptional() @Type(() => CreateApplicantDto) applicant?: CreateApplicantDto;

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
 * Name and phone are copied from the applicant; everything here is what an
 * employee record needs and an applicant record does not have.
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
