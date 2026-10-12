import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';
import {
    NUMBERING_NEXT_NUMBER_MAX,
    NUMBERING_RESET_POLICIES,
    NUMBERING_SCOPES,
    NUMBERING_SEQ_WIDTH_MAX,
    NUMBERING_SEQ_WIDTH_MIN,
    type DocumentNumberingConfig,
    type NumberingDocType,
    type NumberingResetPolicy,
    type NumberingScope,
} from '@erp71/shared-types';

/** A branch's code as the owner typed it; the service normalises and checks it. */
export class StoreCodeDto {
    @IsString()
    @MaxLength(64)
    storeId: string;

    @IsString()
    @MaxLength(20)
    code: string;
}

/** Where one counter of the current period should continue from. */
export class NextNumberDto {
    /** `''` for a business-wide series; see `numberingScopeKey`. */
    @IsString()
    @MaxLength(100)
    scopeKey: string;

    @IsInt()
    @Min(1)
    @Max(NUMBERING_NEXT_NUMBER_MAX)
    nextNumber: number;
}

/**
 * The whole format, saved at once. Length and shape are checked here; whether
 * the format is collision-free is `validateNumberingConfig`'s job, shared with
 * the settings page so the two can never disagree.
 */
export class UpdateDocumentNumberingDto {
    @IsString()
    @MaxLength(100)
    template: string;

    @IsIn(NUMBERING_RESET_POLICIES)
    resetPolicy: NumberingResetPolicy;

    @IsIn(NUMBERING_SCOPES)
    scope: NumberingScope;

    @IsInt()
    @Min(NUMBERING_SEQ_WIDTH_MIN)
    @Max(NUMBERING_SEQ_WIDTH_MAX)
    seqWidth: number;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(500)
    @ValidateNested({ each: true })
    @Type(() => StoreCodeDto)
    storeCodes?: StoreCodeDto[];

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(1000)
    @ValidateNested({ each: true })
    @Type(() => NextNumberDto)
    nextNumbers?: NextNumberDto[];
}

export interface DocumentNumberingResponse {
    docType: NumberingDocType;
    config: DocumentNumberingConfig;
    /** No saved format: the built-in default is in use. */
    isDefault: boolean;
    /** Today's year and month in the tenant's timezone — what previews render with. */
    today: { year: number; month: number };
    stores: { id: string; name: string; code: string | null }[];
    counters: { id: string; storeId: string; name: string; counterNumber: number }[];
    /**
     * The counters already started in the current period of every reset policy,
     * so the page can show "next number" for whichever policy is picked.
     */
    sequences: { periodKey: string; scopeKey: string; nextNumber: number }[];
}
