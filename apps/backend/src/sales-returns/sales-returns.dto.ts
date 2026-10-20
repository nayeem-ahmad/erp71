import { Type } from 'class-transformer';
import { IsString, IsArray, IsNumber, IsOptional, ValidateNested } from 'class-validator';
import { ReturnPaymentDto } from '../common/return-payment.dto';

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

    /**
     * Put this line back into a warehouse other than the return's. Omit it and
     * the line follows `CreateSalesReturnDto.warehouseId`.
     */
    @IsOptional()
    @IsString()
    warehouseId?: string;
}

export class CreateSalesReturnDto {
    @IsString()
    storeId: string;

    /** Optional. When given, every line is validated against this sale. */
    @IsOptional()
    @IsString()
    saleId?: string;

    /**
     * Where the goods are put back. Omitted, it falls to the tenant's default
     * — which is what every return did before this field existed.
     */
    @IsOptional()
    @IsString()
    warehouseId?: string;

    @IsArray()
    items: CreateReturnItemDto[];

    @IsOptional()
    @IsString()
    reason?: string;

    /**
     * How the refund was paid, split across methods. What they leave of the
     * total comes off the sale customer's due. Omitted (older clients, the
     * mobile app, imports), the refund follows the original sale as it always
     * has.
     */
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ReturnPaymentDto)
    payments?: ReturnPaymentDto[];
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

    /** Per-line warehouse override; omit to follow the return's own. */
    @IsOptional()
    @IsString()
    warehouseId?: string;
}

export class UpdateSalesReturnDto {
    @IsOptional()
    @IsString()
    reason?: string;

    /**
     * Move the whole return to another warehouse. Only read when `items` are
     * also supplied — that is the edit which reverses and re-applies the stock.
     */
    @IsOptional()
    @IsString()
    warehouseId?: string;

    @IsOptional()
    @IsArray()
    items?: UpdateReturnItemDto[];

    /**
     * Replaces the refund tenders. Omitted on a return saved with tenders, an
     * edit to its lines keeps the ones it has.
     */
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ReturnPaymentDto)
    payments?: ReturnPaymentDto[];
}
