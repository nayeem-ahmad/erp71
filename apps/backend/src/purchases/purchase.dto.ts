import {
    ArrayMinSize,
    IsArray,
    IsDateString,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    Min,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SortableBranchListQueryDto } from '../common/branch-list-query.dto';
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
 * name); `paymentMethodId` is the tenant's method the user picked, from which
 * the server resolves the linked GL account and checks the method is offered at
 * the bill's branch.
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

    /**
     * The tenant's payment method the user picked. Absent from callers that
     * send only `paymentMethod`, which is then matched by name.
     */
    @IsOptional()
    @IsString()
    paymentMethodId?: string;

    /**
     * Ignored: the account is resolved on the server from the method, so a
     * stale client id cannot redirect cash. Kept so an older client that still
     * sends it is not refused.
     */
    @IsOptional()
    @IsString()
    accountId?: string;
}

/**
 * Everything a purchase bill says, shared by recording one and editing one. An
 * edit sends the whole bill again — lines, charges, supplier and tenders — and
 * the service works out what changed, the way the entry screen holds it.
 */
export class PurchaseBillDto {
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

export class CreatePurchaseDto extends PurchaseBillDto {
    @IsString()
    storeId: string;

    /**
     * When the purchase happened. Omitted, the server stamps the moment the
     * bill is posted. Never written into `created_at`, which stays the time
     * the row was inserted.
     */
    @IsOptional()
    @IsDateString()
    purchaseDate?: string;
}

/** The purchases list: the created window, plus the bill's own transaction date. */
export class PurchaseListQueryDto extends SortableBranchListQueryDto {
    @IsOptional()
    @IsString()
    dateFrom?: string;

    @IsOptional()
    @IsString()
    dateTo?: string;
}

/**
 * A recorded purchase, corrected. No `storeId`: a bill stays on the branch it
 * was recorded at. Leaving `supplierId` out takes the bill off any supplier's
 * account, exactly as recording it without one would have.
 */
export class UpdatePurchaseDto extends PurchaseBillDto {}
