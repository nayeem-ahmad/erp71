import {
    ArrayMinSize,
    IsArray,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    Min,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentInstrumentDto } from '../common/payment-instrument.dto';
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

/**
 * One tender taken against the bill at entry time — the purchase-side twin of
 * `CreatePaymentDto` on a sale. `paymentMethod` is the canonical, classifiable
 * method string ('Cash', 'Bank', 'Mobile Wallet', 'Card', or a tenant-defined
 * name); `accountId` is the GL account the tenant configured for it, resolved
 * server-side from the method name so a stale client id cannot redirect cash.
 *
 * The cheque, transfer, card or wallet details it inherits are stored on the
 * bill's `PurchasePayment` row for this tender — the bank the shop's cheque is
 * drawn on, its number and the date written on it.
 */
export class CreatePurchasePaymentDto extends PaymentInstrumentDto {
    @IsString()
    @IsNotEmpty()
    paymentMethod: string;

    @IsNumber()
    @Min(0)
    amount: number;

    @IsOptional()
    @IsString()
    accountId?: string;
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

    /**
     * What was handed over at the counter. Omit it — or send an empty array —
     * and the whole bill stays on the supplier's account, which is what every
     * purchase did before cash entry existed.
     *
     * Their sum is the only source of truth for `Purchase.paid_amount`; there is
     * deliberately no separate `amountPaid` field to disagree with it.
     */
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreatePurchasePaymentDto)
    payments?: CreatePurchasePaymentDto[];
}