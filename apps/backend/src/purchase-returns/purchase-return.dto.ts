import { IsArray, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreatePurchaseReturnItemDto {
    /** Required when the return names a purchase; omitted for a standalone one. */
    @IsOptional()
    @IsString()
    purchaseItemId?: string;

    /** Identifies the goods when there is no purchase line to point at. */
    @IsOptional()
    @IsString()
    productId?: string;

    @IsNumber()
    @Min(1)
    quantity: number;

    /** Cost per unit; ignored when a purchase is named, which prices the line. */
    @IsOptional()
    @IsNumber()
    unitCost?: number;

    /**
     * Send this line back out of a warehouse other than the return's. Omit it
     * and the line follows `CreatePurchaseReturnDto.warehouseId`.
     */
    @IsOptional()
    @IsString()
    warehouseId?: string;
}

export class CreatePurchaseReturnDto {
    @IsString()
    storeId: string;

    /** Optional. When given, every line is validated against this purchase. */
    @IsOptional()
    @IsString()
    purchaseId?: string;

    /**
     * Which warehouse the goods leave from. Omitted, it falls back to the
     * purchase's own warehouse and then to the tenant's default.
     */
    @IsOptional()
    @IsString()
    warehouseId?: string;

    @IsArray()
    items: CreatePurchaseReturnItemDto[];

    @IsOptional()
    @IsString()
    referenceNumber?: string;

    @IsOptional()
    @IsString()
    notes?: string;
}

export class UpdatePurchaseReturnItemDto {
    /** Required only while the return still names a purchase. */
    @IsOptional()
    @IsString()
    purchaseItemId?: string;

    @IsOptional()
    @IsString()
    productId?: string;

    @IsNumber()
    @Min(1)
    quantity: number;

    /** Cost per unit; used only when the return has no purchase to price from. */
    @IsOptional()
    @IsNumber()
    unitCost?: number;

    /** Per-line warehouse override; omit to follow the return's own. */
    @IsOptional()
    @IsString()
    warehouseId?: string;
}

export class UpdatePurchaseReturnDto {
    @IsOptional()
    @IsString()
    referenceNumber?: string;

    @IsOptional()
    @IsString()
    notes?: string;

    /**
     * Move the whole return to another warehouse. Only read when `items` are
     * also supplied — that is the edit which reverses and re-applies the stock.
     */
    @IsOptional()
    @IsString()
    warehouseId?: string;

    @IsOptional()
    @IsArray()
    items?: UpdatePurchaseReturnItemDto[];
}