import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
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

    /**
     * Which side of the count to report. Defaults to LOSS — this is the
     * shrinkage report, and stock found over the book is a gain, so summing the
     * two would net a theft against a miscount and report neither honestly.
     * FOUND asks the same question of the surpluses.
     */
    @IsOptional()
    @IsIn(['LOSS', 'FOUND'])
    direction?: 'LOSS' | 'FOUND';
}

/**
 * The stock card for one product: every movement in and out of a warehouse, in
 * date order, with an opening quantity before the first row and a running
 * balance on each one.
 *
 * `productId` is required and the others are not, because the running balance
 * is only meaningful over a single product — a card that mixed two SKUs would
 * be adding cartons of soap to bags of rice. The warehouse is optional so the
 * same card can be read tenant-wide, where the balance is the total across
 * every warehouse in scope.
 */
export class GetProductTransactionHistoryDto {
    @IsUUID()
    productId!: string;

    /**
     * Narrows the card to one warehouse. Left out, the card spans every
     * warehouse in scope and each row says which one it moved.
     */
    @IsOptional()
    @IsUUID()
    warehouseId?: string;

    /**
     * Narrows the report to one branch: only that branch's warehouses count
     * toward it. Combines with `warehouseId` rather than overriding it — a
     * warehouse outside the named branch matches neither filter and reports
     * nothing.
     */
    @IsOptional()
    @IsUUID()
    storeId?: string;

    /**
     * Inclusive `YYYY-MM-DD` bounds in the tenant's own zone. Everything that
     * moved before `from` is summed into the opening quantity rather than
     * dropped — that is what makes a windowed card still balance.
     */
    @IsOptional()
    @IsString()
    from?: string;

    @IsOptional()
    @IsString()
    to?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(500)
    limit?: number;
}
