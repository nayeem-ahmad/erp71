import { IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, Max, Min, MinLength, ValidateIf } from 'class-validator';
import { Transform, Type } from 'class-transformer';

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
    @IsIn(['bn', 'ms'])
    secondary_locale?: 'bn' | 'ms' | null;
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
    @IsString()
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