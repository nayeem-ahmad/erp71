import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { COMPARISON_MODES, TREND_GRANULARITIES, type ComparisonMode, type TrendGranularity } from '../sales-reports/sales-reports.dto';

export class GetPurchaseTrendDto {
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

export class GetPurchaseSummaryDto {
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

export class GetPurchasesByProductDto {
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

export class GetPurchasesBySupplierDto {
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
