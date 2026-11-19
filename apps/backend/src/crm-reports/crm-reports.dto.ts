import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

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

export class GetBirthdaysDto {
    /** How many days ahead to look, counting today. Defaults to 30, capped at a year. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(366)
    days?: number;
}
