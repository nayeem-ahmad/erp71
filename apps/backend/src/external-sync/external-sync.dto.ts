import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class UpsertExternalSyncConnectionDto {
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
