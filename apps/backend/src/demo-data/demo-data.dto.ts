import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { DEMO_MODULE_GROUPS, MAX_DEMO_MONTHS, MIN_DEMO_MONTHS } from './generator/options';

/**
 * Options for a demo-data load. Every field is optional: an empty body means the
 * full six-month, all-modules, anomalies-included dataset, which is what the
 * first load should be.
 */
export class LoadDemoDataDto {
    /** Months of history to generate, counting back from today. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(MIN_DEMO_MONTHS)
    @Max(MAX_DEMO_MONTHS)
    months?: number;

    /** Module groups to populate. Omitted or empty means all of them. */
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(DEMO_MODULE_GROUPS.length)
    @IsIn(DEMO_MODULE_GROUPS as unknown as string[], { each: true })
    modules?: string[];

    /** Plant detectable oddities in the trading data. Defaults to true. */
    @IsOptional()
    @IsBoolean()
    includeAnomalies?: boolean;
}
