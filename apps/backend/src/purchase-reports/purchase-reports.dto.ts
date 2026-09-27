import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { COMPARISON_MODES, TREND_GRANULARITIES, type ComparisonMode, type TrendGranularity } from '../sales-reports/sales-reports.dto';
import { LineItemSearchDto } from '../common/line-item-search';

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

/** Columns the purchase line-item search can be ordered by. */
export const PURCHASE_LINE_ITEM_SORTS = ['date', 'bill', 'supplier', 'product', 'quantity', 'unitCost', 'amount'] as const;
export type PurchaseLineItemSort = (typeof PURCHASE_LINE_ITEM_SORTS)[number];

/**
 * Every line of every purchase that still stands, narrowed by any mix of
 * period, supplier, product, branch and free text.
 */
export class GetPurchaseLineItemsDto extends LineItemSearchDto {
    @IsOptional()
    @IsUUID()
    supplierId?: string;

    @IsOptional()
    @IsIn(PURCHASE_LINE_ITEM_SORTS)
    sortBy?: PurchaseLineItemSort;
}
