import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Matches,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';

export const PAGE_NAV_TYPES = ['load', 'navigate'] as const;
export type PageNavType = (typeof PAGE_NAV_TYPES)[number];

/** Longest view the browser reports; it stops measuring at 30 s, so this is headroom. */
const MAX_MS = 600_000;
/** Most samples one request may carry. The browser flushes every 15 s, so a tab rarely has more than a few. */
export const MAX_SAMPLES_PER_BATCH = 20;

export class PageTimingSampleDto {
    @IsString()
    @MaxLength(200)
    @Matches(/^\//)
    route: string;

    @IsIn(PAGE_NAV_TYPES)
    nav_type: PageNavType;

    @IsInt() @Min(0) @Max(MAX_MS)
    total_ms: number;

    @IsOptional() @IsInt() @Min(0) @Max(MAX_MS)
    document_ms?: number;

    @IsInt() @Min(0) @Max(MAX_MS)
    boot_ms: number;

    @IsInt() @Min(0) @Max(MAX_MS)
    data_ms: number;

    @IsInt() @Min(0) @Max(MAX_MS)
    render_ms: number;

    @IsInt() @Min(0) @Max(1000)
    api_calls: number;

    @IsInt() @Min(0) @Max(MAX_MS)
    network_ms: number;

    @IsInt() @Min(0) @Max(MAX_MS)
    server_ms: number;

    @IsInt() @Min(0) @Max(MAX_MS)
    db_ms: number;

    @IsInt() @Min(0) @Max(MAX_MS)
    token_wait_ms: number;

    @IsOptional() @IsString() @MaxLength(200)
    slowest_endpoint?: string;

    @IsOptional() @IsInt() @Min(0) @Max(MAX_MS)
    slowest_ms?: number;
}

export class RecordPageTimingsDto {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(MAX_SAMPLES_PER_BATCH)
    @ValidateNested({ each: true })
    @Type(() => PageTimingSampleDto)
    samples: PageTimingSampleDto[];
}

export class PageTimingSummaryQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @IsIn([1, 7, 30])
    days?: number;

    @IsOptional()
    @IsIn(PAGE_NAV_TYPES)
    nav_type?: PageNavType;
}
