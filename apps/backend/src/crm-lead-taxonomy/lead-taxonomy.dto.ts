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

/** Which of the two lead lookup lists a request targets. */
export enum LeadTaxonomyKind {
    SOURCE = 'sources',
    CATEGORY = 'categories',
}

export const MAX_TAXONOMY_NAME_LENGTH = 60;

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
