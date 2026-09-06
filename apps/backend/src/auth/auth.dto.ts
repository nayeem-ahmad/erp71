import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import {
    BUSINESS_TYPE_VALUES,
    ENABLED_LOCALE_CODES,
    SELF_SERVE_SUBSCRIPTION_PLAN_CODES,
    type SelfServeSubscriptionPlanCode,
    type SupportedLocaleCode,
} from '@erp71/shared-types';

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
    @IsIn(SELF_SERVE_SUBSCRIPTION_PLAN_CODES)
    planCode?: SelfServeSubscriptionPlanCode;

    @IsOptional()
    @IsString()
    referralCode?: string;

    @IsOptional()
    @IsString()
    mobile?: string;

    @IsOptional()
    @IsString()
    mobile_country_code?: string;

    /**
     * The `CURRENT_TERMS_VERSION` string the signup form displayed next to its
     * "I agree" checkbox. Required here because this DTO only ever creates an
     * account — unlike the Google and mobile DTOs, which double as sign-in.
     * The service re-checks the value against the current version rather than
     * storing whatever a client sends.
     */
    @IsString({ message: 'Please accept the Terms of Service to continue.' })
    acceptedTermsVersion: string;
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
    @IsIn(SELF_SERVE_SUBSCRIPTION_PLAN_CODES)
    planCode?: SelfServeSubscriptionPlanCode;

    @IsOptional()
    @IsString()
    referralCode?: string;

    @IsOptional()
    @IsString()
    mobile?: string;

    @IsOptional()
    @IsString()
    mobile_country_code?: string;

    /**
     * The `CURRENT_TERMS_VERSION` string shown beside the signup checkbox.
     * Optional on the DTO because this endpoint is also the sign-in path, and a
     * returning user is not asked to re-accept anything. The service requires
     * it whenever the request actually creates an account.
     */
    @IsOptional()
    @IsString()
    acceptedTermsVersion?: string;
}

/**
 * A Firebase phone sign-in, in one or two rounds against the same ID token.
 *
 * Round one carries the token alone: if the number already belongs to an
 * account that is the whole exchange. When it doesn't, the response asks for an
 * email address and the page sends the token back with `email` (and whatever
 * workspace fields it has) to create the account. The signup page, which
 * already has an email on screen, sends everything in one round.
 */
export class MobileSignInDto {
    /** The Firebase ID token returned by `signInWithPhoneNumber().confirm()`. */
    @IsString({ message: 'Mobile sign-in failed. Please request a new code and try again.' })
    idToken: string;

    /** Required only to create a new account; ignored when one already exists. */
    @IsOptional()
    @IsEmail({}, { message: 'Please enter a valid email address.' })
    email?: string;

    @IsOptional()
    @IsString()
    name?: string;

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
    @IsIn(SELF_SERVE_SUBSCRIPTION_PLAN_CODES)
    planCode?: SelfServeSubscriptionPlanCode;

    @IsOptional()
    @IsString()
    referralCode?: string;

    /**
     * The `CURRENT_TERMS_VERSION` string shown beside the signup checkbox.
     * Optional on the DTO because this endpoint is also the sign-in path, and a
     * returning user is not asked to re-accept anything. The service requires
     * it whenever the request actually creates an account.
     */
    @IsOptional()
    @IsString()
    acceptedTermsVersion?: string;
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
    @IsIn(SELF_SERVE_SUBSCRIPTION_PLAN_CODES)
    planCode?: SelfServeSubscriptionPlanCode;

    @IsOptional()
    @IsIn(BUSINESS_TYPE_VALUES)
    businessType?: string;
}

export class UpdateProfileDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsIn(ENABLED_LOCALE_CODES)
    preferred_locale?: SupportedLocaleCode;
}

export class ChangePasswordDto {
    @IsString()
    currentPassword: string;

    @IsString()
    @MinLength(8, { message: 'Password must be at least 8 characters.' })
    newPassword: string;
}

export class RefreshTokenDto {
    @IsString()
    @IsNotEmpty({ message: 'A refresh token is required.' })
    refresh_token: string;
}
