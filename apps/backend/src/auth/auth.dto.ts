import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { BUSINESS_TYPE_VALUES } from '@erp71/shared-types';

const SUPPORTED_LOCALES = ['en', 'bn', 'ms'] as const;

export class SignupDto {
    @IsEmail({}, { message: 'Please enter a valid email address.' })
    email: string;

    @IsString()
    @MinLength(8, { message: 'Password must be at least 8 characters.' })
    password: string;

    @IsOptional()
    @IsString()
    name?: string;

    @IsString({ message: 'Organization name is required.' })
    tenantName: string;

    @IsOptional()
    @IsString()
    storeName?: string;

    @IsOptional()
    @IsString()
    address?: string;

    @IsOptional()
    @IsIn(['BASIC', 'ACCOUNTING', 'STANDARD'])
    planCode?: 'BASIC' | 'ACCOUNTING' | 'STANDARD';

    @IsOptional()
    @IsString()
    referralCode?: string;

    @IsOptional()
    @IsString()
    mobile?: string;

    @IsOptional()
    @IsString()
    mobile_country_code?: string;
}

export class LoginDto {
    @IsEmail()
    email: string;

    @IsString()
    password: string;
}

/**
 * One endpoint serves both "sign in with Google" and "sign up with Google".
 * The workspace fields are optional: the signup page sends them so a brand-new
 * account lands fully provisioned, while the login page omits them and lets the
 * onboarding wizard collect them afterwards.
 */
export class GoogleSignInDto {
    /** The ID token ("credential") returned by Google Identity Services. */
    @IsString({ message: 'Google sign-in failed. Please try again.' })
    credential: string;

    @IsOptional()
    @IsString()
    tenantName?: string;

    @IsOptional()
    @IsString()
    storeName?: string;

    @IsOptional()
    @IsString()
    address?: string;

    @IsOptional()
    @IsIn(['BASIC', 'ACCOUNTING', 'STANDARD'])
    planCode?: 'BASIC' | 'ACCOUNTING' | 'STANDARD';

    @IsOptional()
    @IsString()
    referralCode?: string;

    @IsOptional()
    @IsString()
    mobile?: string;

    @IsOptional()
    @IsString()
    mobile_country_code?: string;
}

export class CreateStoreDto {
    @IsOptional()
    @IsString()
    tenantName?: string;

    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    address?: string;

    @IsOptional()
    @IsIn(['BASIC', 'ACCOUNTING', 'STANDARD'])
    planCode?: 'BASIC' | 'ACCOUNTING' | 'STANDARD';

    @IsOptional()
    @IsIn(BUSINESS_TYPE_VALUES)
    businessType?: string;
}

export class UpdateProfileDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsIn(SUPPORTED_LOCALES)
    preferred_locale?: (typeof SUPPORTED_LOCALES)[number];
}

export class ChangePasswordDto {
    @IsString()
    currentPassword: string;

    @IsString()
    @MinLength(8, { message: 'Password must be at least 8 characters.' })
    newPassword: string;
}
