import { IsString, IsOptional, IsEnum, IsUUID, IsDateString } from 'class-validator';

/**
 * GENERAL is the manual, catch-all type — named that rather than FOLLOW_UP so it
 * doesn't collide with the container it lives in (a "follow-up" of type
 * "follow-up" reads oddly, and the UI would have to disambiguate the two).
 */
export enum CrmFollowUpType {
    GENERAL = 'GENERAL',
    COLLECTION = 'COLLECTION',
    BIRTHDAY = 'BIRTHDAY',
    REORDER_REMINDER = 'REORDER_REMINDER',
}

export enum CrmFollowUpStatus {
    PENDING = 'PENDING',
    DONE = 'DONE',
    SNOOZED = 'SNOOZED',
}

export class CreateCrmFollowUpDto {
    @IsOptional()
    @IsUUID()
    customer_id?: string;

    @IsOptional()
    @IsUUID()
    lead_id?: string;

    @IsEnum(CrmFollowUpType)
    type: CrmFollowUpType;

    @IsString()
    title: string;

    @IsDateString()
    due_at: string;

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

export class UpdateCrmFollowUpDto {
    @IsOptional()
    @IsEnum(CrmFollowUpType)
    type?: CrmFollowUpType;

    @IsOptional()
    @IsString()
    title?: string;

    @IsOptional()
    @IsDateString()
    due_at?: string;

    @IsOptional()
    @IsEnum(CrmFollowUpStatus)
    status?: CrmFollowUpStatus;

    @IsOptional()
    @IsUUID()
    assigned_to?: string;

    @IsOptional()
    @IsString()
    notes?: string;
}
