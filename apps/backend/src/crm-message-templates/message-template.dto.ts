import { Transform } from 'class-transformer';
import {
    IsBoolean,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Length,
    Min,
} from 'class-validator';

/**
 * Which composer offers a template. A call script earns its place in both; a
 * "sorry we missed you" note only makes sense once the call is over, and a
 * "remind about the invoice on Thursday" prompt only before it.
 */
export const TEMPLATE_USAGES = ['LOG', 'SCHEDULE', 'BOTH'] as const;
export type TemplateUsage = (typeof TEMPLATE_USAGES)[number];

export const MAX_TEMPLATE_NAME_LENGTH = 60;
/** Matches `CrmActivity.subject`, which is where a scheduled template's subject lands. */
export const MAX_TEMPLATE_SUBJECT_LENGTH = 300;
/**
 * Matches `CompleteCrmActivityDto.summary`, the longest field a template body
 * can be pasted into. A shorter cap here would let Setup accept text the
 * composer then refuses to save.
 */
export const MAX_TEMPLATE_BODY_LENGTH = 5000;

const trim = ({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value;

/**
 * For the two optional links. `''` is how a `<select>` says "any channel", and
 * that clear has to reach the column — `update()` skips undefined keys, so
 * mapping it to undefined would silently keep the old link. `@IsOptional()`
 * skips validation for null too, so `@IsUUID()` still guards real values.
 */
const emptyToNull = ({ value }: { value: unknown }) =>
    value === '' || value === undefined || value === null ? null : value;

const toBool = ({ value }: { value: unknown }) =>
    value === true || value === 'true' || value === '1';

export class CreateMessageTemplateDto {
    @Transform(trim)
    @IsString()
    @Length(1, MAX_TEMPLATE_NAME_LENGTH)
    name: string;

    @Transform(trim)
    @IsString()
    @Length(1, MAX_TEMPLATE_BODY_LENGTH)
    body: string;

    @IsOptional()
    @Transform(trim)
    @IsString()
    @Length(0, MAX_TEMPLATE_SUBJECT_LENGTH)
    subject?: string;

    @IsOptional()
    @IsIn(TEMPLATE_USAGES)
    usage?: TemplateUsage;

    @IsOptional()
    @Transform(emptyToNull)
    @IsUUID()
    channel_id?: string | null;

    @IsOptional()
    @Transform(emptyToNull)
    @IsUUID()
    purpose_id?: string | null;

    @IsOptional()
    @IsInt()
    @Min(0)
    sort_order?: number;
}

export class UpdateMessageTemplateDto {
    @IsOptional()
    @Transform(trim)
    @IsString()
    @Length(1, MAX_TEMPLATE_NAME_LENGTH)
    name?: string;

    @IsOptional()
    @Transform(trim)
    @IsString()
    @Length(1, MAX_TEMPLATE_BODY_LENGTH)
    body?: string;

    @IsOptional()
    @Transform(trim)
    @IsString()
    @Length(0, MAX_TEMPLATE_SUBJECT_LENGTH)
    subject?: string;

    @IsOptional()
    @IsIn(TEMPLATE_USAGES)
    usage?: TemplateUsage;

    @IsOptional()
    @Transform(emptyToNull)
    @IsUUID()
    channel_id?: string | null;

    @IsOptional()
    @Transform(emptyToNull)
    @IsUUID()
    purpose_id?: string | null;

    @IsOptional()
    @IsInt()
    @Min(0)
    sort_order?: number;

    @IsOptional()
    @IsBoolean()
    is_active?: boolean;
}

export class ListMessageTemplatesDto {
    /**
     * Include deactivated rows. CRM Setup needs them; the Log / Schedule picker
     * must not offer a template the tenant has retired.
     */
    @IsOptional()
    @Transform(toBool)
    @IsBoolean()
    includeInactive?: boolean;

    /**
     * Narrow to the composer asking. `LOG` returns LOG + BOTH, `SCHEDULE`
     * returns SCHEDULE + BOTH; omitted returns everything, which is what the
     * Setup screen wants.
     */
    @IsOptional()
    @IsIn(['LOG', 'SCHEDULE'])
    usage?: 'LOG' | 'SCHEDULE';

    /**
     * Only templates tied to this channel, plus the channel-agnostic ones.
     * The log dialog passes the channel it is on, so a WhatsApp blurb stops
     * being offered while recording a shop visit.
     */
    @IsOptional()
    @Transform(emptyToNull)
    @IsUUID()
    channelId?: string | null;
}
