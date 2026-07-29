import { IsString, IsArray, IsNumber, IsOptional } from 'class-validator';

export class CreateReturnItemDto {
    /** Required when the return names a sale; omitted for a standalone return. */
    @IsOptional()
    @IsString()
    saleItemId?: string;

    /** Identifies the goods when there is no sale line to point at. */
    @IsOptional()
    @IsString()
    productId?: string;

    @IsNumber()
    quantity: number;

    /**
     * Refund per unit. Ignored when a sale is named — the price then comes from
     * the sale itself, so a return cannot quietly refund more than was charged.
     */
    @IsOptional()
    @IsNumber()
    unitPrice?: number;
}

export class CreateSalesReturnDto {
    @IsString()
    storeId: string;

    /** Optional. When given, every line is validated against this sale. */
    @IsOptional()
    @IsString()
    saleId?: string;

    @IsArray()
    items: CreateReturnItemDto[];

    @IsOptional()
    @IsString()
    reason?: string;
}

export class UpdateReturnItemDto {
    /** Required only while the return still names a sale. */
    @IsOptional()
    @IsString()
    saleItemId?: string;

    @IsString()
    productId: string;

    @IsNumber()
    quantity: number;

    /** Refund per unit; used only when the return has no sale to price from. */
    @IsOptional()
    @IsNumber()
    unitPrice?: number;
}

export class UpdateSalesReturnDto {
    @IsOptional()
    @IsString()
    reason?: string;

    @IsOptional()
    @IsArray()
    items?: UpdateReturnItemDto[];
}
