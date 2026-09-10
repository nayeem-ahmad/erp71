import { Type } from 'class-transformer';
import {
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsDateString,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    ValidateNested,
} from 'class-validator';
import { InlineCustomerDto } from '../customers/customer.dto';

export class CreateSaleItemDto {
    @IsString()
    @IsNotEmpty()
    productId: string;

    @IsNumber()
    quantity: number;

    @IsNumber()
    priceAtSale: number;

    /**
     * Take this line out of a warehouse other than the sale's. Omit it — the
     * normal case — and the line follows `CreateSaleDto.warehouseId`.
     */
    @IsOptional()
    @IsString()
    warehouseId?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    serialNumbers?: string[];
}

export class CreatePaymentDto {
    @IsString()
    @IsNotEmpty()
    paymentMethod: string;

    @IsNumber()
    amount: number;

    @IsOptional()
    @IsString()
    accountId?: string; // Links payment to account for accounting
}

export class CreateSaleDto {
    @IsString()
    @IsNotEmpty()
    storeId: string;

    @IsOptional()
    @IsString()
    warehouseId?: string;

    @IsOptional()
    @IsString()
    customerId?: string;

    /**
     * A customer typed into the picker's quick-create form. Resolved to a real
     * customer inside the sale transaction, so an abandoned sale creates no one.
     * Takes precedence over `customerId` when both arrive.
     */
    @IsOptional()
    @ValidateNested()
    @Type(() => InlineCustomerDto)
    newCustomer?: InlineCustomerDto;

    @IsOptional()
    @IsString()
    counterId?: string;

    @IsOptional()
    @IsString()
    referenceNumber?: string; // User-editable reference number

    /**
     * Source document this entry was converted from, set by the "convert to
     * sale" action on the quotations and sales-orders lists. Both are stored on
     * the sale as real foreign keys — `referenceNumber` above is the tenant's
     * own invoice numbering and cannot double as a pointer to another document.
     */
    @IsOptional()
    @IsString()
    quotationId?: string;

    @IsOptional()
    @IsString()
    salesOrderId?: string;

    @IsOptional()
    @IsDateString()
    saleDate?: string;

    @IsNumber()
    totalAmount: number;

    @IsNumber()
    amountPaid: number;

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => CreateSaleItemDto)
    items: CreateSaleItemDto[];

    /** Optional when the full balance is kept as customer due (credit sale). */
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreatePaymentDto)
    payments?: CreatePaymentDto[];

    @IsOptional()
    @IsString()
    note?: string;

    /** Optional promo/discount code amount already applied on the client */
    @IsOptional()
    @IsNumber()
    discountAmount?: number;

    /** Loyalty points the customer wants to redeem on this sale */
    @IsOptional()
    @IsNumber()
    pointsToRedeem?: number;

    /**
     * Park the entry as a DRAFT: the sale and its lines are stored, but nothing
     * is posted — no stock movement, credit check, loyalty, or accounting entry.
     */
    @IsOptional()
    @IsBoolean()
    isDraft?: boolean;
}

/**
 * Turning a DRAFT into a real sale. Every field is optional: omit them all to
 * post the draft exactly as it was parked, or supply the ones the user edited
 * on the way out (warranty serials can only arrive here — a draft has none).
 */
export class FinalizeSaleDto {
    @IsOptional()
    @IsString()
    customerId?: string | null;

    /** Where the goods leave from, if different from what the draft recorded. */
    @IsOptional()
    @IsString()
    warehouseId?: string;

    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => CreateSaleItemDto)
    items?: CreateSaleItemDto[];

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreatePaymentDto)
    payments?: CreatePaymentDto[];

    @IsOptional()
    @IsNumber()
    totalAmount?: number;

    @IsOptional()
    @IsNumber()
    amountPaid?: number;

    @IsOptional()
    @IsNumber()
    discountAmount?: number;

    @IsOptional()
    @IsNumber()
    pointsToRedeem?: number;

    @IsOptional()
    @IsString()
    note?: string;

    @IsOptional()
    @IsDateString()
    saleDate?: string;
}

export class UpdateSaleItemDto {
    @IsString()
    @IsNotEmpty()
    productId: string;

    @IsNumber()
    quantity: number;

    @IsNumber()
    priceAtSale: number;

    /** Per-line warehouse override; omit to follow the sale's own warehouse. */
    @IsOptional()
    @IsString()
    warehouseId?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    serialNumbers?: string[];
}

export class UpdatePaymentDto {
    @IsString()
    @IsNotEmpty()
    paymentMethod: string;

    @IsNumber()
    amount: number;

    @IsOptional()
    @IsString()
    accountId?: string;
}

export class UpdateSaleDto {
    @IsOptional()
    @IsString()
    customerId?: string | null;

    /**
     * Move the whole sale to another warehouse. Only read when `items` are
     * also supplied: the stock is reversed and re-applied as one step there,
     * and without new lines there is nothing to re-post against it.
     */
    @IsOptional()
    @IsString()
    warehouseId?: string;

    @IsOptional()
    @IsString()
    status?: string;

    @IsOptional()
    @IsString()
    note?: string;

    @IsOptional()
    @IsDateString()
    saleDate?: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => UpdateSaleItemDto)
    items?: UpdateSaleItemDto[];

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => UpdatePaymentDto)
    payments?: UpdatePaymentDto[];

    /**
     * Invoice total including the entry-form adjustments (discount, VAT,
     * transport, labour, rounding) that are not stored per-line. Omit to let
     * the total fall back to the sum of the line items.
     */
    @IsOptional()
    @IsNumber()
    totalAmount?: number;
}
