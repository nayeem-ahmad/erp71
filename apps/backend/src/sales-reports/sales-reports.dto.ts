import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Bucket width for any time-series report. */
export const TREND_GRANULARITIES = ['day', 'week', 'month'] as const;
export type TrendGranularity = (typeof TREND_GRANULARITIES)[number];

/**
 * How a report picks its comparison window. Both modes are relative to the
 * requested range so the caller never has to compute the prior window itself —
 * that arithmetic is exactly what a language model gets wrong.
 */
export const COMPARISON_MODES = ['previous_period', 'previous_year'] as const;
export type ComparisonMode = (typeof COMPARISON_MODES)[number];

/**
 * Dimensions a sales breakdown can group by. The first two aggregate sale
 * *lines*; the rest aggregate whole *invoices*. The two bases do not add up to
 * the same total when an invoice carries discounts or tax, so every response
 * states which basis produced it.
 */
export const SALES_BREAKDOWN_DIMENSIONS = [
    'product',
    'category',
    'brand',
    'branch',
    'customer',
    'payment_method',
    'staff',
    'hour_of_day',
    'day_of_week',
] as const;
export type SalesBreakdownDimension = (typeof SALES_BREAKDOWN_DIMENSIONS)[number];

/** Dimensions that can be compared period-over-period by `top-movers`. */
export const MOVER_DIMENSIONS = ['product', 'category', 'brand', 'branch', 'customer'] as const;
export type MoverDimension = (typeof MOVER_DIMENSIONS)[number];

export class GetSalesSummaryDto {
    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsString()
    from?: string;

    @IsOptional()
    @IsString()
    to?: string;
}

export class GetSalesByProductDto {
    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsUUID()
    groupId?: string;

    @IsOptional()
    @IsUUID()
    subgroupId?: string;

    @IsOptional()
    @IsString()
    from?: string;

    @IsOptional()
    @IsString()
    to?: string;
}

export class GetConsolidatedReportDto {
    @IsOptional()
    @IsString()
    from?: string;

    @IsOptional()
    @IsString()
    to?: string;
}

export class GetSalesByCustomerDto {
    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsString()
    from?: string;

    @IsOptional()
    @IsString()
    to?: string;
}

export class GetMonthlySalesByCustomerDto {
    @IsOptional()
    @IsString()
    from?: string;

    @IsOptional()
    @IsString()
    to?: string;

    @IsOptional()
    @IsUUID()
    customerId?: string;
}

export class GetBranchReportDto {
    @IsUUID()
    storeId: string;

    @IsOptional()
    @IsString()
    from?: string;

    @IsOptional()
    @IsString()
    to?: string;
}

export class GetSalesByCategoryDto {
    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsString()
    from?: string;

    @IsOptional()
    @IsString()
    to?: string;
}

export class GetSalesTrendDto {
    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsString()
    from: string;

    @IsString()
    to: string;

    @IsOptional()
    @IsIn(TREND_GRANULARITIES)
    granularity?: TrendGranularity;

    @IsOptional()
    @IsIn(COMPARISON_MODES)
    compareTo?: ComparisonMode;
}

export class GetSalesBreakdownDto {
    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsString()
    from: string;

    @IsString()
    to: string;

    @IsIn(SALES_BREAKDOWN_DIMENSIONS)
    groupBy: SalesBreakdownDimension;

    @IsOptional()
    @IsIn(COMPARISON_MODES)
    compareTo?: ComparisonMode;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(500)
    limit?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    offset?: number;
}

export class GetTopMoversDto {
    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsString()
    from: string;

    @IsString()
    to: string;

    @IsOptional()
    @IsIn(MOVER_DIMENSIONS)
    dimension?: MoverDimension;

    @IsOptional()
    @IsIn(COMPARISON_MODES)
    compareTo?: ComparisonMode;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number;
}

export class GetReturnsAnalysisDto {
    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsString()
    from: string;

    @IsString()
    to: string;
}

export class GetCustomerRetentionDto {
    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsString()
    from: string;

    @IsString()
    to: string;

    /** A customer with no purchase for this many days counts as lapsed. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(7)
    @Max(730)
    lapsedAfterDays?: number;
}

/** How the salesperson margin report attributes a sale. */
export const SALESPERSON_GROUPINGS = ['user', 'counter'] as const;
export type SalespersonGrouping = (typeof SALESPERSON_GROUPINGS)[number];

export class GetMarginExceptionsDto {
    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsString()
    from?: string;

    @IsOptional()
    @IsString()
    to?: string;

    /**
     * Lines whose margin comes in under this percentage are reported. Defaults
     * to 0, i.e. only goods sold at or below cost — the floor nobody has to
     * justify. Negative values are allowed so a reader can ask for the truly
     * bad lines only ("worse than −20%") on a catalog where thin margins are
     * normal.
     */
    @IsOptional()
    @Type(() => Number)
    @Min(-100)
    @Max(100)
    marginFloorPct?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(500)
    limit?: number;
}

export class GetGrossProfitBySalespersonDto {
    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsString()
    from?: string;

    @IsOptional()
    @IsString()
    to?: string;

    @IsOptional()
    @IsIn(SALESPERSON_GROUPINGS)
    groupBy?: SalespersonGrouping;
}

export class GetMarginBridgeDto {
    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsString()
    from: string;

    @IsString()
    to: string;

    /**
     * The period being compared against. Explicit rather than derived: a
     * like-for-like comparison is often not the immediately preceding window —
     * Ramadan against Ramadan, not Ramadan against the month before it.
     */
    @IsString()
    compareFrom: string;

    @IsString()
    compareTo: string;
}

export class GetCostCoverageDto {
    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsString()
    from?: string;

    @IsOptional()
    @IsString()
    to?: string;
}
