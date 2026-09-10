import {
    ArrayMinSize,
    IsArray,
    IsNumber,
    IsOptional,
    IsString,
    Min,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateSupplierDto } from '../suppliers/supplier.dto';

export class CreatePurchaseItemDto {
    @IsString()
    productId: string;

    @IsNumber()
    @Min(1)
    quantity: number;

    @IsNumber()
    @Min(0)
    unitCost: number;

    /**
     * Receive this line into a warehouse other than the bill's — one delivery
     * unloaded into two of the branch's warehouses. Omit it and the line
     * follows `CreatePurchaseDto.warehouseId`.
     */
    @IsOptional()
    @IsString()
    warehouseId?: string;
}

export class CreatePurchaseDto {
    @IsString()
    storeId: string;

    @IsOptional()
    @IsString()
    warehouseId?: string;

    @IsOptional()
    @IsString()
    supplierId?: string;

    @IsOptional()
    @ValidateNested()
    @Type(() => CreateSupplierDto)
    newSupplier?: CreateSupplierDto;

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => CreatePurchaseItemDto)
    items: CreatePurchaseItemDto[];

    @IsOptional()
    @IsNumber()
    @Min(0)
    taxAmount?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    discountAmount?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    freightAmount?: number;

    @IsOptional()
    @IsString()
    notes?: string;
}