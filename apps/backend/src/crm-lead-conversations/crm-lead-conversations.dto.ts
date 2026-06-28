import { IsString, IsOptional, IsEnum, IsUUID, IsIn } from 'class-validator';

export enum LeadConversationType {
    CALL = 'CALL',
    SMS = 'SMS',
    WHATSAPP = 'WHATSAPP',
    EMAIL = 'EMAIL',
    VISIT = 'VISIT',
    NOTE = 'NOTE',
}

export class CreateLeadConversationDto {
    @IsUUID()
    lead_id: string;

    @IsEnum(LeadConversationType)
    type: LeadConversationType;

    @IsOptional()
    @IsIn(['INBOUND', 'OUTBOUND'])
    direction?: string;

    @IsString()
    summary: string;

    @IsOptional()
    @IsString()
    outcome?: string;

    @IsOptional()
    @IsString()
    store_id?: string;
}

export class UpdateLeadConversationDto {
    @IsOptional()
    @IsEnum(LeadConversationType)
    type?: LeadConversationType;

    @IsOptional()
    @IsString()
    summary?: string;

    @IsOptional()
    @IsString()
    outcome?: string;
}