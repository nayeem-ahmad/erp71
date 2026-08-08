import { Type } from 'class-transformer';
import {
    ArrayMinSize,
    IsArray,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';

export const DEMAND_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type DemandPriority = (typeof DEMAND_PRIORITIES)[number];

export const DEMAND_STATUSES = [
    'DRAFT',
    'SUBMITTED',
    'APPROVED',
    'REJECTED',
    'FULFILLED',
    'CANCELLED',
] as const;
export type DemandStatus = (typeof DEMAND_STATUSES)[number];

export class ProductDemandItemDto {
    @IsUUID()
    productId: string;

    @IsInt()
    @Min(1)
    quantity: number;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    note?: string;
}

export class CreateProductDemandDto {
    @IsUUID()
    warehouseId: string;

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => ProductDemandItemDto)
    items: ProductDemandItemDto[];

    @IsOptional()
    @IsIn(DEMAND_PRIORITIES)
    priority?: DemandPriority;

    @IsOptional()
    @IsString()
    neededBy?: string;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    notes?: string;

    /**
     * `SUBMITTED` sends it to an approver straight away; `DRAFT` parks it. Only
     * those two — every other status is reached through its own endpoint, so a
     * demand can never be created already approved.
     */
    @IsOptional()
    @IsIn(['DRAFT', 'SUBMITTED'])
    status?: 'DRAFT' | 'SUBMITTED';
}

export class UpdateProductDemandDto {
    @IsOptional()
    @IsUUID()
    warehouseId?: string;

    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => ProductDemandItemDto)
    items?: ProductDemandItemDto[];

    @IsOptional()
    @IsIn(DEMAND_PRIORITIES)
    priority?: DemandPriority;

    @IsOptional()
    @IsString()
    neededBy?: string;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    notes?: string;
}

export class ReviewProductDemandItemDto {
    @IsUUID()
    productId: string;

    /** Zero declines the line while the rest of the demand goes through. */
    @IsInt()
    @Min(0)
    quantityApproved: number;
}

export class ReviewProductDemandDto {
    @IsIn(['APPROVED', 'REJECTED'])
    status: 'APPROVED' | 'REJECTED';

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    reviewNote?: string;

    /**
     * Per-line approved quantities. Omitted lines keep what was asked for, so an
     * approver who agrees with everything sends nothing but the status.
     */
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ReviewProductDemandItemDto)
    items?: ReviewProductDemandItemDto[];
}

export class FulfilProductDemandDto {
    @IsOptional()
    @IsString()
    @MaxLength(500)
    fulfilmentNote?: string;
}

export class ListProductDemandsQueryDto {
    @IsOptional()
    @IsIn(DEMAND_STATUSES)
    status?: DemandStatus;

    @IsOptional()
    @IsUUID()
    warehouseId?: string;

    @IsOptional()
    @IsUUID()
    productId?: string;

    @IsOptional()
    @IsIn(DEMAND_PRIORITIES)
    priority?: DemandPriority;

    /** `'true'` narrows the list to demands the caller raised themselves. */
    @IsOptional()
    @IsString()
    mine?: string;

    @IsOptional()
    @IsString()
    from?: string;

    @IsOptional()
    @IsString()
    to?: string;
}
