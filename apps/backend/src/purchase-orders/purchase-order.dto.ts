import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';

export class CreatePurchaseOrderItemDto {
    @IsUUID()
    productId: string;

    @IsInt()
    @Min(1)
    quantity: number;

    @IsNumber()
    @Min(0)
    unitCost: number;
}

export class CreatePurchaseOrderDto {
    @IsUUID()
    storeId: string;

    @IsOptional()
    @IsUUID()
    supplierId?: string;

    @IsOptional()
    @IsDateString()
    expectedDate?: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreatePurchaseOrderItemDto)
    items: CreatePurchaseOrderItemDto[];

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

export class UpdatePurchaseOrderStatusDto {
    @IsIn(['DRAFT', 'SENT', 'RECEIVED', 'CANCELLED'])
    status: string;
}
