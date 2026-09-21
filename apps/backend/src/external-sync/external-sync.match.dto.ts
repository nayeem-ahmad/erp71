import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    MaxLength,
    ValidateNested,
} from 'class-validator';
import { MATCH_DECISIONS } from './match/match.types';

/**
 * Sized to a migration workbook rather than borrowed from `ImportRowsDto`'s
 * 5000-row cap: one source can carry several thousand products, customers and
 * suppliers together, and a workbook holds every row, not only the ambiguous
 * ones.
 */
export const MAX_DECISION_ROWS = 20000;

export const MATCH_ENTITIES = ['PRODUCT', 'CUSTOMER', 'SUPPLIER'] as const;

export class MatchManifestDto {
    @IsString()
    connectionId!: string;

    @IsString()
    provider!: string;

    @IsString()
    generatedAt!: string;

    @Type(() => Number)
    @IsInt()
    rowCount!: number;
}

export class MatchDecisionRowDto {
    @IsIn(MATCH_ENTITIES as unknown as string[])
    entity!: string;

    @IsString()
    @MaxLength(128)
    externalId!: string;

    @IsIn(MATCH_DECISIONS as unknown as string[])
    decision!: string;

    @IsOptional()
    @IsString()
    matchId?: string | null;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    altIds?: string[];

    @IsOptional()
    @IsString()
    @MaxLength(500)
    notes?: string;
}

export class ApplyMatchDecisionsDto {
    @ValidateNested()
    @Type(() => MatchManifestDto)
    manifest!: MatchManifestDto;

    @IsArray()
    @ArrayMaxSize(MAX_DECISION_ROWS)
    @ValidateNested({ each: true })
    @Type(() => MatchDecisionRowDto)
    rows!: MatchDecisionRowDto[];
}
