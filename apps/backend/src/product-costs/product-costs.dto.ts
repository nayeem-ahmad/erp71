import { Transform, Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../common/pagination.dto';
import { COST_ADJUSTMENT_REASONS, type CostAdjustmentReason } from '../database/product-cost.utils';

export const COST_STATUS_FILTERS = ['ALL', 'UNCOSTED', 'COSTED'] as const;
export type CostStatusFilter = (typeof COST_STATUS_FILTERS)[number];

export class ListProductCostsDto extends PaginationDto {
    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @IsUUID()
    groupId?: string;

    @IsOptional()
    @IsIn(COST_STATUS_FILTERS)
    status?: CostStatusFilter;

    /** Only products holding stock somewhere — the ones whose cost moves a valuation. */
    @IsOptional()
    @Transform(({ value }) => value === true || value === 'true')
    @IsBoolean()
    inStockOnly?: boolean;
}

export class CostAdjustmentItemDto {
    @IsUUID()
    productId: string;

    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 4 })
    @Min(0)
    unitCost: number;
}

/**
 * One or many products set in one go, all-or-nothing. The reason applies to
 * every product that already has a cost on file; a product with none is always
 * recorded as an opening cost, whatever is sent (see resolveAdjustmentReason).
 */
export class CreateCostAdjustmentsDto {
    @IsArray()
    @ArrayMinSize(1)
    // Each line is a handful of queries inside one transaction; a page of the
    // costs screen is at most 100 rows, so this is two pages' worth.
    @ArrayMaxSize(200)
    @ValidateNested({ each: true })
    @Type(() => CostAdjustmentItemDto)
    items: CostAdjustmentItemDto[];

    @IsOptional()
    @IsIn(COST_ADJUSTMENT_REASONS)
    reason?: CostAdjustmentReason;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    note?: string;
}

export class ListCostAdjustmentsDto extends PaginationDto {
    @IsOptional()
    @IsUUID()
    productId?: string;
}
