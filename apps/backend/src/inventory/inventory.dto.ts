import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { COSTING_METHODS } from '../database/product-cost.utils';

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