import { ArrayMinSize, IsArray, IsDateString, IsEmail, IsEnum, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../common/pagination.dto';
import { IsStoreIdOrAll } from '../common/store-id-or-all.validator';

export class PaymentAllocationInputDto {
    @IsString()
    purchaseId: string;

    @IsNumber()
    @Min(0.01)
    amount: number;
}

export class CreateSupplierDto {
    @IsString()
    name: string;

    /**
     * The branch the supplier belongs to. Omitted: the request's header branch.
     * A member limited to some branches may name only one of theirs.
     */
    @IsOptional()
    @IsUUID()
    store_id?: string;

    @IsOptional()
    @IsString()
    phone?: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    address?: string;
}

export class UpdateSupplierDto {
    @IsOptional()
    @IsString()
    name?: string;

    /** Moves the supplier to another branch — owners and consolidated-report holders only. */
    @IsOptional()
    @IsUUID()
    store_id?: string;

    @IsOptional()
    @IsString()
    phone?: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    address?: string;
}

export enum SupplierPaymentDirectionDto {
    PAY = 'pay',
    RECEIVE = 'receive',
}

export class RecordSupplierCreditPaymentDto {
    /**
     * Money paid (or received). May be 0 only when `discount` settles the
     * whole remainder on its own.
     */
    @IsNumber()
    @Min(0)
    amount: number;

    /**
     * Payments only: a remainder the supplier lets the shop off, settled with
     * this payment. Lowers the due alongside `amount`, can be allocated to bills
     * like money, and posts to Discount Received, never to cash.
     */
    @IsOptional()
    @IsNumber()
    @Min(0)
    discount?: number;

    @IsOptional()
    @IsEnum(SupplierPaymentDirectionDto)
    direction?: SupplierPaymentDirectionDto;

    @IsOptional()
    @IsString()
    notes?: string;

    /**
     * When the money changed hands. Defaults to now. Backdating is allowed so a
     * payment entered late lands in the period it belongs to, and is refused by
     * the fiscal-period lock if that period is closed. An offsetless value is
     * read as the tenant's wall clock.
     */
    @IsOptional()
    @IsDateString()
    date?: string;

    /**
     * The payment's serial. Omitted (or blank) takes the next number in the
     * SPY-/SPO- series; a typed one must not be used by any other supplier
     * credit row in the tenant.
     */
    @IsOptional()
    @IsString()
    @MaxLength(40)
    paymentNumber?: string;

    /**
     * The tender: a PaymentMethod of this tenant, active. Its name is kept on
     * the payment, and its linked ledger account (when set) takes the cash
     * leg instead of Cash in Hand. Omitted: no method recorded on a new
     * payment; the stored one kept on an edit.
     */
    @IsOptional()
    @IsUUID()
    paymentMethodId?: string;

    // Optional: match part or all of this payment to specific bill(s) immediately.
    // Leaving this empty (or partial) records the rest as an unapplied advance
    // that can be allocated to a bill later via the allocate endpoint.
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => PaymentAllocationInputDto)
    allocations?: PaymentAllocationInputDto[];
}

export class AllocateSupplierPaymentDto {
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => PaymentAllocationInputDto)
    allocations: PaymentAllocationInputDto[];
}

export class UpdateSupplierCreditPaymentDto {
    @IsOptional()
    @IsNumber()
    @Min(0)
    amount?: number;

    /** Omitted keeps the payment's current discount; 0 removes it. */
    @IsOptional()
    @IsNumber()
    @Min(0)
    discount?: number;

    @IsOptional()
    @IsEnum(SupplierPaymentDirectionDto)
    direction?: SupplierPaymentDirectionDto;

    @IsOptional()
    @IsString()
    notes?: string;

    /** Omitted keeps the payment's current date. */
    @IsOptional()
    @IsDateString()
    date?: string;

    /** Omitted (or blank) keeps the payment's current serial. */
    @IsOptional()
    @IsString()
    @MaxLength(40)
    paymentNumber?: string;

    /**
     * The tender: a PaymentMethod of this tenant, active. Its name is kept on
     * the payment, and its linked ledger account (when set) takes the cash
     * leg instead of Cash in Hand. Omitted: no method recorded on a new
     * payment; the stored one kept on an edit.
     */
    @IsOptional()
    @IsUUID()
    paymentMethodId?: string;
}

export class NextSupplierPaymentNumberQueryDto {
    @IsOptional()
    @IsEnum(SupplierPaymentDirectionDto)
    direction?: SupplierPaymentDirectionDto;
}

/** `GET /suppliers`: the list, its search and sort, and the branch filter. */
export class ListSuppliersQueryDto extends PaginationDto {
    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @IsString()
    sortBy?: string;

    @IsOptional()
    @IsString()
    sortDir?: string;

    /** A branch id, or `all`; omitted is every branch the caller may see. */
    @IsOptional()
    @IsStoreIdOrAll()
    storeId?: string;
}

export class ListSupplierCreditPaymentsQueryDto extends PaginationDto {
    @IsOptional()
    @IsUUID()
    supplierId?: string;

    /** The branch the payments page shows: a branch id, or `all`. */
    @IsOptional()
    @IsStoreIdOrAll()
    storeId?: string;

    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;

    @IsOptional()
    @IsString()
    search?: string;
}

export class SupplierCreditLedgerQueryDto extends PaginationDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}