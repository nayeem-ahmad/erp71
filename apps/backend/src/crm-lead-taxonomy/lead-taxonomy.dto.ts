import { Transform } from 'class-transformer';
import {
    IsBoolean,
    IsInt,
    IsOptional,
    IsString,
    Length,
    Max,
    Min,
} from 'class-validator';

/**
 * Which CRM lookup list a request targets.
 *
 * All three are the same shape — code / name / sort_order / is_system /
 * is_active, edited from the one CRM Setup screen — so they share a controller
 * and a service rather than each getting a near-identical module. What differs
 * is only which table a row is counted against when it is deleted.
 */
export enum LeadTaxonomyKind {
    SOURCE = 'sources',
    CATEGORY = 'categories',
    CHANNEL = 'channels',
}

export const MAX_TAXONOMY_NAME_LENGTH = 60;

/**
 * Emoji shown beside a conversation channel. Two code points of headroom over a
 * single emoji, because several common ones (flags, skin-tone variants) are
 * multi-code-point sequences.
 */
export const MAX_CHANNEL_ICON_LENGTH = 8;

const trim = ({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value;

const toBool = ({ value }: { value: unknown }) =>
    value === true || value === 'true' || value === '1';

export class CreateLeadTaxonomyDto {
    @Transform(trim)
    @IsString()
    @Length(1, MAX_TAXONOMY_NAME_LENGTH)
    name: string;

    /**
     * Score contribution, sources only. Ignored for categories.
     * Bounded to 0-25 to match the range the old hardcoded SOURCE_WEIGHT map
     * used — a larger value would let one source alone saturate the 0-100 score.
     */
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(25)
    score_weight?: number;

    /** Emoji, channels only. Ignored for the two lead lists. */
    @IsOptional()
    @Transform(trim)
    @IsString()
    @Length(0, MAX_CHANNEL_ICON_LENGTH)
    icon?: string;

    @IsOptional()
    @IsInt()
    @Min(0)
    sort_order?: number;
}

export class UpdateLeadTaxonomyDto {
    @IsOptional()
    @Transform(trim)
    @IsString()
    @Length(1, MAX_TAXONOMY_NAME_LENGTH)
    name?: string;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(25)
    score_weight?: number;

    @IsOptional()
    @Transform(trim)
    @IsString()
    @Length(0, MAX_CHANNEL_ICON_LENGTH)
    icon?: string;

    @IsOptional()
    @IsInt()
    @Min(0)
    sort_order?: number;

    @IsOptional()
    @IsBoolean()
    is_active?: boolean;
}

export class ListLeadTaxonomyDto {
    /**
     * Include deactivated rows. The settings screen needs them; the lead form
     * must not offer them.
     */
    @IsOptional()
    @Transform(toBool)
    @IsBoolean()
    includeInactive?: boolean;
}

export class DeleteLeadTaxonomyDto {
    /**
     * Move leads currently using this row onto another row before removing it.
     * Required when the row is in use — the alternative is silently blanking a
     * tenant's lead provenance.
     */
    @IsOptional()
    @Transform(trim)
    @IsString()
    reassignTo?: string;
}
