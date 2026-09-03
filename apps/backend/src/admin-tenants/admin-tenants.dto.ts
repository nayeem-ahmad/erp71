import { IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, Max, Min, MinLength, ValidateIf } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
    BUSINESS_TYPE_VALUES,
    SECONDARY_LOCALE_CODES,
    type SupportedLocaleCode,
} from '@erp71/shared-types';

export class ListAdminTenantsQueryDto {
    @IsOptional() @IsString() search?: string;
    @IsOptional() @IsString() planCode?: 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';
    @IsOptional() @IsString() status?: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'TRIALING';
}

export class ListAdminTenantLedgerQueryDto {
    @IsOptional() @IsString() tenantId?: string;
}

export class UpdateAdminTenantSubscriptionDto {
    @IsOptional() @IsString() planCode?: 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';
    @IsOptional() @IsString() status?: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'TRIALING';
    @IsOptional() @IsString() billingCycle?: 'MONTHLY' | 'YEARLY';
    @IsOptional() cancelAtPeriodEnd?: boolean;

    // Discount edit: pass discountType=null (or empty string) with the value to clear a discount.
    @IsOptional()
    @ValidateIf((o) => o.discountType !== null && o.discountType !== '')
    @IsIn(['PERCENTAGE', 'FIXED'])
    discountType?: 'PERCENTAGE' | 'FIXED' | null | '';

    @IsOptional()
    @ValidateIf((o) => o.discountValue !== null)
    @Type(() => Number)
    @IsNumber()
    @IsPositive()
    discountValue?: number | null;
}

export class UpdateAdminTenantLocalizationDto {
    @IsOptional()
    @IsBoolean()
    localization_enabled?: boolean;

    @IsOptional()
    @IsIn(SECONDARY_LOCALE_CODES)
    secondary_locale?: SupportedLocaleCode | null;
}

/**
 * Per-feature tri-state: `true`/`false` pin the feature for this tenant, `null`
 * clears the override so the tenant inherits the platform default again. Keys
 * left out of the payload are untouched.
 *
 * Every key in `TENANT_OVERRIDABLE_FEATURE_KEYS` must appear here. The global
 * pipe runs with `forbidNonWhitelisted`, so a key the UI sends but this class
 * does not declare rejects the whole request — the save appears to do nothing
 * and every other feature silently reverts too. admin-tenants.dto.spec.ts pins
 * the two lists together.
 *
 * Platform-scoped switches (`platformProjects`) are deliberately absent: they
 * govern the admin console rather than a shop, so there is nothing for a single
 * tenant to override, and `parseTenantFeatureOverrides` would drop them anyway.
 */
export class UpdateAdminTenantFeaturesDto {
    @IsOptional() @IsBoolean() feedback?: boolean | null;
    @IsOptional() @IsBoolean() support?: boolean | null;
    @IsOptional() @IsBoolean() help?: boolean | null;
    @IsOptional() @IsBoolean() voice?: boolean | null;
    @IsOptional() @IsBoolean() manufacturing?: boolean | null;
    @IsOptional() @IsBoolean() aiChat?: boolean | null;
    @IsOptional() @IsBoolean() externalImport?: boolean | null;
    @IsOptional() @IsBoolean() projects?: boolean | null;
}

export class SuspendTenantDto {
    @IsOptional() @IsString() reason?: string;
}

export class DeleteTenantDto {
    @IsOptional() @IsString() reason?: string;
}

export class ListAdminUsersQueryDto {
    @IsOptional() @IsString() search?: string;
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
    @IsOptional()
    @Transform(({ value }) => {
        if (value === 'true' || value === true) return true;
        if (value === 'false' || value === false) return false;
        return undefined;
    })
    @IsBoolean()
    isAdmin?: boolean;
}

export class PromoteUserDto {
    @IsString() userId: string;
}

export class CreateAdminTenantDto {
    @IsIn(['new', 'existing'])
    ownerMode: 'new' | 'existing';

    @ValidateIf((o) => o.ownerMode === 'new')
    @IsEmail()
    ownerEmail?: string;

    @ValidateIf((o) => o.ownerMode === 'new')
    @IsOptional()
    @IsString()
    ownerName?: string;

    @ValidateIf((o) => o.ownerMode === 'existing')
    @IsString()
    ownerUserId?: string;

    @IsString()
    tenantName: string;

    @IsString()
    storeName: string;

    @IsOptional()
    @IsString()
    address?: string;

    @IsOptional()
    @IsIn(BUSINESS_TYPE_VALUES)
    businessType?: string;

    @IsIn(['FREE', 'BASIC', 'ACCOUNTING', 'STANDARD', 'PREMIUM'])
    planCode: 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';

    @IsOptional()
    @IsIn(['PERCENTAGE', 'FIXED'])
    discountType?: 'PERCENTAGE' | 'FIXED';

    @ValidateIf((o) => o.discountType != null)
    @Type(() => Number)
    @IsNumber()
    @IsPositive()
    discountValue?: number;
}

export class RecordTenantPaymentDto {
    @IsNumber() @IsPositive() amount: number;
    @IsOptional() @IsString() notes?: string;
    @IsOptional() @IsString() method?: string;
}

export class RecordTenantRefundDto {
    @IsNumber() @IsPositive() amount: number;
    @IsOptional() @IsString() notes?: string;
}

export class AdminSellSmsCreditsDto {
    @IsInt() @Min(1) credits: number;
    @IsOptional() @IsNumber() @IsPositive() amount?: number;
    @IsOptional() @IsString() notes?: string;
}

export class AdminSellAiCreditsDto {
    @IsInt() @Min(1) credits: number;
    @IsOptional() @IsNumber() @IsPositive() amount?: number;
    @IsOptional() @IsString() notes?: string;
}

export class AdminGrantTenantAddonDto {
    @IsString() addonCode: string;
    @IsOptional() @IsInt() @Min(1) @Max(3650) durationDays?: number;
    @IsOptional() @IsString() notes?: string;
}

export class CreatePlatformAdminUserDto {
    @IsEmail()
    email: string;

    @IsString()
    @MinLength(8)
    password: string;

    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    mobile_country_code?: string;

    @IsOptional()
    @IsString()
    mobile?: string;
}

export class UpdatePlatformAdminUserDto {
    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    mobile_country_code?: string;

    @IsOptional()
    @IsString()
    mobile?: string;
}

export class AdminResetPlatformUserPasswordDto {
    @IsString()
    @MinLength(8)
    newPassword: string;
}

export class SetAdminTenantBusinessTypeDto {
    @IsIn(BUSINESS_TYPE_VALUES)
    businessType: string;
}