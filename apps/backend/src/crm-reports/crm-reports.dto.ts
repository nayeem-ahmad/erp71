import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Query `statusIds` arrives as a CSV string or a repeated param; empty means no filter. */
export function parseStatusIds(value: unknown): string[] {
    if (value == null || value === '') return [];
    const parts = Array.isArray(value) ? value : String(value).split(',');
    return parts.map((id) => String(id).trim()).filter((id) => id.length > 0);
}

/**
 * The window the period reports take — the same `from`/`to`/`mine` shape
 * `CrmDashboardQueryDto` has, for the endpoints that also accept their own
 * options beside it.
 */
export class CrmReportWindowDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;

    @IsOptional()
    @Transform(({ value }) => value === true || value === 'true' || value === '1')
    @IsBoolean()
    mine?: boolean;
}

export class GetLeadMovementDto extends CrmReportWindowDto {
    @IsOptional()
    @Transform(({ value }) => parseStatusIds(value))
    @IsArray()
    @IsString({ each: true })
    statusIds?: string[];
}

export class GetBirthdaysDto {
    /** How many days ahead to look, counting today. Defaults to 30, capped at a year. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(366)
    days?: number;
}
