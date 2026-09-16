import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

const toBoolean = ({ value }: { value: unknown }) => {
    if (value === '' || value === null || value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    return value;
};

export class GetStockAgingDto {
    /**
     * Narrows the report to one branch: only that branch's warehouses count
     * toward it. Without it every report spans the whole tenant, which mixes
     * branches that have nothing to do with each other into one set of numbers.
     * Combines with `warehouseId` rather than overriding it — a warehouse
     * outside the named branch matches neither filter and reports nothing.
     */
    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsUUID()
    warehouseId?: string;

    @IsOptional()
    @IsUUID()
    groupId?: string;

    @IsOptional()
    @IsUUID()
    subgroupId?: string;

    /**
     * Stock with no outbound movement for at least this many days counts as
     * slow-moving. Defaults to 60 — long enough that ordinary seasonal dips do
     * not flag half the catalogue.
     */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(3650)
    slowMovingAfterDays?: number;
}

export class GetReorderSuggestionsDto {
    /**
     * Narrows the report to one branch: only that branch's warehouses count
     * toward it. Without it every report spans the whole tenant, which mixes
     * branches that have nothing to do with each other into one set of numbers.
     * Combines with `warehouseId` rather than overriding it — a warehouse
     * outside the named branch matches neither filter and reports nothing.
     */
    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsUUID()
    warehouseId?: string;

    @IsOptional()
    @IsUUID()
    groupId?: string;

    @IsOptional()
    @IsUUID()
    subgroupId?: string;
}

export class GetInventoryValuationDto {
    /**
     * Narrows the report to one branch: only that branch's warehouses count
     * toward it. Without it every report spans the whole tenant, which mixes
     * branches that have nothing to do with each other into one set of numbers.
     * Combines with `warehouseId` rather than overriding it — a warehouse
     * outside the named branch matches neither filter and reports nothing.
     */
    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsUUID()
    warehouseId?: string;

    @IsOptional()
    @IsUUID()
    groupId?: string;

    @IsOptional()
    @IsUUID()
    subgroupId?: string;
}

export class GetStockOnHandDto {
    /**
     * Narrows the report to one branch: only that branch's warehouses count
     * toward it. Without it every report spans the whole tenant, which mixes
     * branches that have nothing to do with each other into one set of numbers.
     * Combines with `warehouseId` rather than overriding it — a warehouse
     * outside the named branch matches neither filter and reports nothing.
     */
    @IsOptional()
    @IsUUID()
    storeId?: string;

    /**
     * Narrows the report to a single warehouse: that warehouse becomes the only
     * quantity column, and the weighted average cost is computed from that
     * warehouse's own receipts rather than the tenant-wide pool.
     */
    @IsOptional()
    @IsUUID()
    warehouseId?: string;

    @IsOptional()
    @IsUUID()
    groupId?: string;

    @IsOptional()
    @IsUUID()
    subgroupId?: string;

    @IsOptional()
    @IsUUID()
    brandId?: string;

    /**
     * Products with nothing on hand anywhere are dropped by default — a stock
     * report is about what is on the shelf. Set this to list the full catalogue
     * including zero rows.
     */
    @IsOptional()
    @Transform(toBoolean)
    @IsBoolean()
    includeZeroStock?: boolean;
}

export class GetShrinkageSummaryDto {
    /**
     * Narrows the report to one branch: only that branch's warehouses count
     * toward it. Without it every report spans the whole tenant, which mixes
     * branches that have nothing to do with each other into one set of numbers.
     * Combines with `warehouseId` rather than overriding it — a warehouse
     * outside the named branch matches neither filter and reports nothing.
     */
    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsUUID()
    warehouseId?: string;

    @IsOptional()
    @IsUUID()
    reasonId?: string;

    @IsOptional()
    @IsUUID()
    productId?: string;

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