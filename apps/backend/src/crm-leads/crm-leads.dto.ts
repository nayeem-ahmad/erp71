import { IsString, IsOptional, IsEnum, IsUUID, IsEmail } from 'class-validator';

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

export class CreateLeadDto {
    @IsString()
    name: string;

    @IsString()
    phone: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    address?: string;

    @IsOptional()
    @IsEnum(LeadSource)
    source?: LeadSource;

    @IsOptional()
    @IsEnum(LeadStatus)
    status?: LeadStatus;

    @IsOptional()
    @IsUUID()
    assigned_to?: string;

    @IsOptional()
    @IsString()
    notes?: string;

    @IsOptional()
    @IsString()
    store_id?: string;
}

export class UpdateLeadDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    phone?: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    address?: string;

    @IsOptional()
    @IsEnum(LeadSource)
    source?: LeadSource;

    @IsOptional()
    @IsEnum(LeadStatus)
    status?: LeadStatus;

    @IsOptional()
    @IsUUID()
    assigned_to?: string;

    @IsOptional()
    @IsString()
    notes?: string;
}