import { Transform, Type } from 'class-transformer';
import {
    IsDateString,
    IsIn,
    IsOptional,
    IsString,
    IsUUID,
    Length,
    ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }) =>
    value === '' || value === null ? undefined : value;
/**
 * The counterpart, for a field whose *clear* has to reach the column. `update()`
 * skips undefined keys, so `emptyToUndefined` would silently keep the old value
 * where the user asked for none. `@IsOptional()` skips validation for null as
 * well as undefined, so `@IsUUID()` still guards real values.
 */
const emptyToNull = ({ value }: { value: unknown }) =>
    value === '' || value === null ? null : value;

export const ACTIVITY_STATUSES = ['PLANNED', 'DONE', 'CANCELLED'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const ACTIVITY_ORIGINS = ['MANUAL', 'BIRTHDAY_CRON', 'REORDER_CRON', 'IMPORT'] as const;
export type ActivityOrigin = (typeof ACTIVITY_ORIGINS)[number];

export class CreateCrmActivityDto {
    @IsOptional() @IsUUID() lead_id?: string;
    @IsOptional() @IsUUID() customer_id?: string;

    /** Required when status is PLANNED. */
    @IsOptional() @Transform(trim) @IsString() @Length(1, 300) subject?: string;

    @IsOptional() @IsIn(['PLANNED', 'DONE']) status?: 'PLANNED' | 'DONE';

    @IsOptional() @Transform(emptyToUndefined) @IsDateString() due_at?: string;

    /** A CrmActivityPurpose id or code. */
    @IsOptional() @Transform(emptyToUndefined) @IsString() purpose?: string;
    /** A ConversationChannel id or code. Required when status is DONE. */
    @IsOptional() @Transform(emptyToUndefined) @IsString() channel?: string;

    /** Required when status is DONE. */
    @IsOptional() @Transform(trim) @IsString() summary?: string;
    @IsOptional() @Transform(trim) @IsString() outcome?: string;
    @IsOptional() @Transform(trim) @IsString() notes?: string;
    @IsOptional() @IsIn(['INBOUND', 'OUTBOUND']) direction?: string;

    @IsOptional() @Transform(emptyToUndefined) @IsUUID() assigned_to?: string;
    @IsOptional() @IsString() store_id?: string;
}

export class UpdateCrmActivityDto {
    @IsOptional() @Transform(trim) @IsString() @Length(1, 300) subject?: string;
    @IsOptional() @Transform(emptyToUndefined) @IsDateString() due_at?: string;
    @IsOptional() @Transform(emptyToUndefined) @IsString() purpose?: string;
    @IsOptional() @Transform(trim) @IsString() notes?: string;
    /** `emptyToNull`, not `emptyToUndefined`: handing an activity back to nobody is a real edit. */
    @IsOptional() @Transform(emptyToNull) @IsUUID() assigned_to?: string | null;
}

export class CreateNextActivityDto {
    @Transform(trim) @IsString() @Length(1, 300) subject: string;
    @IsDateString() due_at: string;
    @IsOptional() @Transform(emptyToUndefined) @IsString() purpose?: string;
    @IsOptional() @Transform(emptyToUndefined) @IsUUID() assigned_to?: string;
}

export class CompleteCrmActivityDto {
    /** A ConversationChannel id or code. Required. */
    @Transform(trim) @IsString() @Length(1, 60) channel: string;
    @Transform(trim) @IsString() @Length(1, 5000) summary: string;
    @IsOptional() @Transform(trim) @IsString() outcome?: string;
    @IsOptional() @IsIn(['INBOUND', 'OUTBOUND']) direction?: string;

    /**
     * Optional next activity — the closed loop. @ValidateNested + @Type are
     * load-bearing: without them class-validator treats the nested object as an
     * opaque blob and an empty `next: {}` would reach the service unvalidated.
     */
    @IsOptional()
    @ValidateNested()
    @Type(() => CreateNextActivityDto)
    next?: CreateNextActivityDto;
}

/** Mirrors ACTIVITY_SORTABLE in the service — keep the two in step. */
export const CRM_ACTIVITY_SORT_KEYS = ['due_at', 'completed_at', 'created_at', 'status', 'subject'];
