import {
    IsEmail, IsEnum, IsInt, IsNumber, IsOptional, IsString,
    IsUrl, IsUUID, MaxLength, Min, MinLength, ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
    CAREERS_EMPLOYMENT_TYPE_VALUES,
    CareersEmploymentType,
} from '@erp71/shared-types';

/**
 * `@IsOptional()` skips validation for `undefined` and `null` only, so an
 * `@IsUrl()` field sent as `''` — which is what a cleared text box posts —
 * would 400 instead of clearing. `@ValidateIf` makes the empty string a legal
 * "unset", the same fix the project DTOs already carry on their optional ids.
 */
const setOrCleared = (_: unknown, value: unknown) => value !== '';

export class CareersJobQueryDto {
    /** Free text matched against the job title and description. */
    @IsOptional() @IsString() @MaxLength(120)
    search?: string;

    @IsOptional() @IsString() @MaxLength(120)
    location?: string;

    @IsOptional() @IsEnum(CAREERS_EMPLOYMENT_TYPE_VALUES as any)
    employment_type?: CareersEmploymentType;

    /** Narrow the board to one hiring company. */
    @IsOptional() @IsUUID()
    company_id?: string;

    @IsOptional() @Type(() => Number) @IsInt() @Min(1)
    page?: number;

    @IsOptional() @Type(() => Number) @IsInt() @Min(1)
    limit?: number;
}

export class CareersRegisterDto {
    @IsEmail()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
    email: string;

    @IsString() @MinLength(8, { message: 'Password must be at least 8 characters' })
    password: string;

    @IsString() @MinLength(2) @MaxLength(120)
    full_name: string;

    /**
     * Required, not optional. A hiring workspace's `Applicant.phone` is non-null
     * and is the column it de-duplicates candidates on, so a profile with no
     * number could never be turned into an application.
     */
    @IsString() @MinLength(6) @MaxLength(30)
    phone: string;
}

export class CareersLoginDto {
    @IsEmail()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
    email: string;

    @IsString()
    password: string;
}

export class CareersTwoFactorDto {
    @IsUUID()
    userId: string;

    @IsString()
    code: string;
}

export class UpdateCareersProfileDto {
    @IsOptional() @IsString() @MinLength(2) @MaxLength(120) full_name?: string;
    @IsOptional() @IsString() @MaxLength(30) phone?: string;
    @IsOptional() @IsString() @MaxLength(160) headline?: string;
    @IsOptional() @IsString() @MaxLength(120) location?: string;
    @IsOptional() @IsString() @MaxLength(4000) summary?: string;

    @IsOptional()
    @ValidateIf(setOrCleared)
    @IsUrl({ require_protocol: true }, { message: 'Resume link must be a full URL' })
    @MaxLength(500)
    resume_url?: string;

    @IsOptional() @IsString() @MaxLength(200) resume_name?: string;

    @IsOptional()
    @ValidateIf(setOrCleared)
    @IsUrl({ require_protocol: true }, { message: 'LinkedIn link must be a full URL' })
    @MaxLength(500)
    linkedin_url?: string;

    @IsOptional()
    @ValidateIf(setOrCleared)
    @IsUrl({ require_protocol: true }, { message: 'Portfolio link must be a full URL' })
    @MaxLength(500)
    portfolio_url?: string;
}

export class CareersApplyDto {
    /**
     * Lands in `JobApplication.expected_salary`, which the hiring side already
     * reads as "what this candidate asked for this specific role".
     */
    @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
    expected_salary?: number;

    /**
     * The candidate's note to the employer. Written into
     * `JobApplication.notes`, which is the field the workspace's application
     * detail already shows — there is no separate cover-letter column, and
     * adding one would give the hiring UI a field it does not render.
     */
    @IsOptional() @IsString() @MaxLength(5000)
    cover_letter?: string;
}
