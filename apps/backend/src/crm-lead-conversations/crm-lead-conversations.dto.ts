import { Transform, Type } from 'class-transformer';
import { IsString, IsOptional, IsEnum, IsUUID, IsIn, IsDateString, IsInt, Length, Min, Max } from 'class-validator';
import { LeadStatus } from '../crm-leads/crm-leads.dto';

const emptyToUndefined = ({ value }: { value: unknown }) =>
    value === '' || value === null ? undefined : value;

const trim = ({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value;

export class CreateLeadConversationDto {
    @IsUUID()
    lead_id: string;

    /**
     * A `ConversationChannel` row id, or its `code`. Free text rather than an enum
     * because the channel list is tenant-owned now — the service resolves this
     * against the tenant's channels and rejects anything that does not match, so
     * an unknown value is still a 400, just not one the DTO can decide.
     */
    @Transform(trim)
    @IsString()
    @Length(1, 60)
    type: string;

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

    /** Narrows to one channel by `code` — the value stored in `LeadConversation.type`. */
    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    @Length(1, 60)
    type?: string;

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
    /** Id or `code` of a channel, resolved the same way as on create. */
    @IsOptional()
    @Transform(trim)
    @IsString()
    @Length(1, 60)
    type?: string;

    @IsOptional()
    @IsString()
    summary?: string;

    @IsOptional()
    @IsString()
    outcome?: string;
}