import { IsEmail, IsIn, IsInt, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';

export class ListAdminTenantsQueryDto {
    @IsOptional() @IsString() search?: string;
    @IsOptional() @IsString() planCode?: 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';
    @IsOptional() @IsString() status?: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'TRIALING';
}

export class UpdateAdminTenantSubscriptionDto {
    @IsOptional() @IsString() planCode?: 'FREE' | 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';
    @IsOptional() @IsString() status?: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'TRIALING';
    @IsOptional() @IsString() billingCycle?: 'MONTHLY' | 'YEARLY';
    @IsOptional() cancelAtPeriodEnd?: boolean;
}

export class SuspendTenantDto {
    @IsOptional() @IsString() reason?: string;
}

export class ListAdminUsersQueryDto {
    @IsOptional() @IsString() search?: string;
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
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
}