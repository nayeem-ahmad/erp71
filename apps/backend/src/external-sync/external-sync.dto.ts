import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class UpsertExternalSyncConnectionDto {
    /** Which external ERP this connection talks to. Defaults to Express Retail Pro. */
    @IsOptional()
    @IsString()
    @MaxLength(64)
    provider?: string;

    @IsString()
    @MaxLength(500)
    baseUrl!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(200)
    username!: string;

    /** Optional on update — omit to keep the stored password unchanged. */
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(200)
    password?: string;

    /** Store that imported sales and purchases are attributed to. */
    @IsString()
    storeId!: string;

    @IsOptional()
    @IsString()
    @Matches(/^[A-Za-z0-9._-]{0,12}$/, {
        message: 'documentPrefix may only contain letters, digits, dot, underscore or dash (max 12 characters)',
    })
    documentPrefix?: string;

    @IsOptional()
    @IsBoolean()
    enabled?: boolean;

    /** Make imported documents post to stock, party balances and the ledger. */
    @IsOptional()
    @IsBoolean()
    postImpacts?: boolean;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(3650)
    windowDays?: number;

    /** Earliest business date the importer will ever request. */
    @IsOptional()
    @IsDateString()
    historyStartDate?: string;
}

export class RunExternalSyncDto {
    /** Which configured connection to run. Defaults to Express Retail Pro. */
    @IsOptional()
    @IsString()
    @MaxLength(64)
    provider?: string;

    /** Defaults to the connection's rolling window when omitted. */
    @IsOptional()
    @IsDateString()
    dateFrom?: string;

    @IsOptional()
    @IsDateString()
    dateTo?: string;

    /** Pull and map everything, report the counts, write nothing. */
    @IsOptional()
    @IsBoolean()
    dryRun?: boolean;

    /** Re-pull the connection's full history instead of the rolling window. */
    @IsOptional()
    @IsBoolean()
    fullResync?: boolean;

    /**
     * Which parts of the import to run. Omit for all of them; naming a subset
     * lets a big migration be walked one step at a time.
     */
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    steps?: string[];
}

export class ListExternalSyncRunsQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number;
}

export class TestExternalSyncConnectionDto {
    @IsOptional()
    @IsString()
    @MaxLength(64)
    provider?: string;

    @IsString()
    @MaxLength(500)
    baseUrl!: string;

    @IsString()
    @MinLength(1)
    username!: string;

    /** Omit to test with the password already stored on the connection. */
    @IsOptional()
    @IsString()
    password?: string;
}
