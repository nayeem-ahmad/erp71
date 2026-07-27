import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

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
}

/**
 * Per-store overrides of the tenant-wide warehouse defaults. An empty string
 * clears the override for that transaction type (falls back to the tenant
 * default). The store is identified by the route param, not the body.
 */
export class UpdateStoreWarehouseDefaultsDto {
    @IsOptional()
    @IsString()
    defaultProductWarehouseId?: string;

    @IsOptional()
    @IsString()
    defaultPurchaseWarehouseId?: string;

    @IsOptional()
    @IsString()
    defaultSalesWarehouseId?: string;

    @IsOptional()
    @IsString()
    defaultShrinkageWarehouseId?: string;

    @IsOptional()
    @IsString()
    defaultTransferSourceWarehouseId?: string;

    @IsOptional()
    @IsString()
    defaultTransferDestinationWarehouseId?: string;
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

    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    code?: string;

    @IsOptional()
    @IsBoolean()
    isDefault?: boolean;
}

export class UpdateWarehouseDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
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