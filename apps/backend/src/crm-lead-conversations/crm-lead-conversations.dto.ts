import { Transform, Type } from 'class-transformer';
import { IsString, IsOptional, IsEnum, IsUUID, IsIn, IsDateString, IsInt, Min, Max } from 'class-validator';
import { LeadStatus } from '../crm-leads/crm-leads.dto';

const emptyToUndefined = ({ value }: { value: unknown }) =>
    value === '' || value === null ? undefined : value;

export enum LeadConversationType {
    CALL = 'CALL',
    SMS = 'SMS',
    WHATSAPP = 'WHATSAPP',
    EMAIL = 'EMAIL',
    VISIT = 'VISIT',
    ONLINE_MEETING = 'ONLINE_MEETING',
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

    @IsOptional()
    @Transform(emptyToUndefined)
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
}

/** Mirrors CONVERSATION_SORTABLE in the service — keep the two in step. */
export const LEAD_CONVERSATION_SORT_KEYS = [
    'created_at',
    'type',
    'direction',
    'lead',
    'creator',
] as const;

/**
 * Query filters for the cross-lead conversations list. Every accepted param must be
 * declared here — the global ValidationPipe runs with `forbidNonWhitelisted: true`, so an
 * undeclared query param is a 400 rather than being ignored.
 */
export class QueryLeadConversationsDto {
    @IsOptional()
    @Transform(emptyToUndefined)
    @IsUUID()
    leadId?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    search?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsEnum(LeadConversationType)
    type?: LeadConversationType;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsIn(['INBOUND', 'OUTBOUND'])
    direction?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsUUID()
    createdBy?: string;

    /** `'true'` narrows to the caller's own conversations; resolved in the controller. */
    @IsOptional()
    @Transform(emptyToUndefined)
    @IsIn(['true', 'false'])
    mine?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsDateString()
    dateFrom?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsDateString()
    dateTo?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsEnum(LeadStatus)
    leadStatus?: LeadStatus;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsUUID()
    leadAssignedTo?: string;

    // `transform: true` is on but implicit conversion is not, so query strings need @Type.
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsIn([...LEAD_CONVERSATION_SORT_KEYS])
    sortBy?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsIn(['asc', 'desc'])
    sortDir?: string;
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