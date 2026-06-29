import { Transform } from 'class-transformer';
import { IsString, IsOptional, IsEnum, IsUUID, IsEmail, IsDateString } from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) =>
    value === '' || value === null ? undefined : value;

export enum LeadSource {
    WALK_IN = 'WALK_IN',
    PHONE = 'PHONE',
    FACEBOOK = 'FACEBOOK',
    REFERRAL = 'REFERRAL',
    WEBSITE = 'WEBSITE',
    OTHER = 'OTHER',
}

export enum LeadStatus {
    NEW = 'NEW',
    CONTACTED = 'CONTACTED',
    QUALIFIED = 'QUALIFIED',
    LOST = 'LOST',
    CONVERTED = 'CONVERTED',
}

export enum LeadCategory {
    RETAIL = 'RETAIL',
    WHOLESALE = 'WHOLESALE',
    CORPORATE = 'CORPORATE',
    INDIVIDUAL = 'INDIVIDUAL',
    PARTNER = 'PARTNER',
    OTHER = 'OTHER',
}

export enum LeadPriority {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    URGENT = 'URGENT',
}

export class CreateLeadDto {
    @IsString()
    name: string;

    @IsString()
    mobile: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    address?: string;

    @IsOptional()
    @IsEnum(LeadCategory)
    category?: LeadCategory;

    @IsOptional()
    @IsEnum(LeadPriority)
    priority?: LeadPriority;

    @IsOptional()
    @IsString()
    remarks?: string;

    @IsOptional()
    @IsEnum(LeadSource)
    source?: LeadSource;

    @IsOptional()
    @IsEnum(LeadStatus)
    status?: LeadStatus;

    @IsOptional()
    @IsString()
    linkedin_url?: string;

    @IsOptional()
    @IsString()
    fb_url?: string;

    @IsOptional()
    @IsString()
    x_url?: string;

    @IsOptional()
    @IsString()
    website_url?: string;

    @IsOptional()
    @IsString()
    next_step?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsDateString()
    next_step_date?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsUUID()
    next_step_assigned_to?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsUUID()
    assigned_to?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    store_id?: string;
}

export class UpdateLeadDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    mobile?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    address?: string;

    @IsOptional()
    @IsEnum(LeadCategory)
    category?: LeadCategory;

    @IsOptional()
    @IsEnum(LeadPriority)
    priority?: LeadPriority;

    @IsOptional()
    @IsString()
    remarks?: string;

    @IsOptional()
    @IsEnum(LeadSource)
    source?: LeadSource;

    @IsOptional()
    @IsEnum(LeadStatus)
    status?: LeadStatus;

    @IsOptional()
    @IsString()
    linkedin_url?: string;

    @IsOptional()
    @IsString()
    fb_url?: string;

    @IsOptional()
    @IsString()
    x_url?: string;

    @IsOptional()
    @IsString()
    website_url?: string;

    @IsOptional()
    @IsString()
    next_step?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsDateString()
    next_step_date?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsUUID()
    next_step_assigned_to?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsUUID()
    assigned_to?: string;
}