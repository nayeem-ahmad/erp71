import { Transform, Type } from 'class-transformer';
import {
    IsBoolean,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    MaxLength,
    Min,
    MinLength,
} from 'class-validator';
import { COSTING_METHODS } from '../database/product-cost.utils';

/**
 * Surrounding whitespace is never part of a name, and stripping it here is what
 * makes `@MinLength(1)` mean "has a name" rather than "sent some characters" —
 * a warehouse called "   " is as nameless as one called "".
 */
const trim = ({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value;

/**
 * A field the form submits empty when the user left it alone. Folding "" to
 * undefined is what lets a blank Code mean "generate one" on create and "leave
 * the existing one" on edit, rather than blanking the column.
 */
const blankToUndefined = ({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : trim({ value });

export class UpdateInventorySettingsDto {
    @IsOptional()
    @IsUUID()
    defaultProductWarehouseId?: string;

    @IsOptional()
    @IsUUID()
    defaultPurchaseWarehouseId?: string;

    @IsOptional()
    @IsUUID()
    defaultSalesWarehouseId?: string;

    @IsOptional()
    @IsUUID()
    defaultShrinkageWarehouseId?: string;

    @IsOptional()
    @IsUUID()
    defaultTransferSourceWarehouseId?: string;

    @IsOptional()
    @IsUUID()
    defaultTransferDestinationWarehouseId?: string;

    @IsOptional()
    @IsInt()
    @Min(0)
    defaultReorderLevel?: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    defaultSafetyStock?: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    defaultLeadTimeDays?: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    discrepancyApprovalThreshold?: number;

    /**
     * Which cost a sale snapshots, and therefore what every gross-profit report
     * is computed from. Changing it affects new sales only — past sales keep
     * the cost they were recorded with.
     */
    @IsOptional()
    @IsIn(COSTING_METHODS as unknown as string[])
    costingMethod?: string;

    /**
     * Whether a sale may be posted for more than the quantity on hand, taking
     * the stock balance negative instead of being refused. Selling only —
     * transfers, stock takes, shrinkage and manufacturing stay strict.
     */
    @IsOptional()
    @IsBoolean()
    allowNegativeStock?: boolean;
}

export class CreateInventoryReasonDto {
    @IsString()
    type: string;

    @IsString()
    code: string;

    @IsString()
    label: string;

    @IsOptional()
    @IsInt()
    @Min(0)
    displayOrder?: number;
}

export class UpdateInventoryReasonDto {
    @IsOptional()
    @IsString()
    label?: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @IsInt()
    @Min(0)
    displayOrder?: number;
}

export class ListInventoryReasonsQueryDto {
    @IsOptional()
    @IsString()
    type?: string;
}

export class CreateWarehouseDto {
    @IsUUID()
    storeId: string;

    /**
     * Required, and `@IsString()` alone did not say so: an empty string is a
     * string, so warehouses were being saved nameless and then showing up as a
     * blank row in every warehouse picker. InventoryService enforces the other
     * half of the rule — that the name is not already taken in this branch.
     */
    @Transform(trim)
    @IsString({ message: 'Warehouse name is required.' })
    @MinLength(1, { message: 'Warehouse name is required.' })
    @MaxLength(100)
    name: string;

    @IsOptional()
    @Transform(blankToUndefined)
    @IsString()
    @MaxLength(50)
    code?: string;

    @IsOptional()
    @IsBoolean()
    isDefault?: boolean;
}

export class UpdateWarehouseDto {
    /**
     * Optional — most edits here only flip a status — but blank when sent is an
     * error rather than a no-op: someone clearing the field means to clear the
     * name, and a warehouse has to have one.
     */
    @IsOptional()
    @Transform(trim)
    @IsString({ message: 'Warehouse name is required.' })
    @MinLength(1, { message: 'Warehouse name is required.' })
    @MaxLength(100)
    name?: string;

    @IsOptional()
    @Transform(blankToUndefined)
    @IsString()
    @MaxLength(50)
    code?: string;

    @IsOptional()
    @IsBoolean()
    isDefault?: boolean;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export class ListStockLedgerQueryDto {
    @IsOptional()
    @IsUUID()
    productId?: string;

    @IsOptional()
    @IsUUID()
    warehouseId?: string;

    @IsOptional()
    @IsString()
    movementType?: string;

    @IsOptional()
    @IsString()
    from?: string;

    @IsOptional()
    @IsString()
    to?: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(500)
    limit?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @IsString()
    sortBy?: string;

    @IsOptional()
    @IsString()
    sortDir?: string;
}