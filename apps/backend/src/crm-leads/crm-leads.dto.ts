import { Transform } from 'class-transformer';
import { IsString, IsOptional, IsEnum, IsUUID, IsEmail, IsDateString } from 'class-validator';
import { LeadSource, LeadStatus, LeadCategory, LeadPriority } from '@prisma/client';

export { LeadSource, LeadStatus, LeadCategory, LeadPriority };

const emptyToUndefined = ({ value }: { value: unknown }) =>
    value === '' || value === null ? undefined : value;

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
    lost_reason?: string;

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
    lost_reason?: string;

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