import { IsString, IsOptional, IsEmail, IsEnum, IsUUID, IsNumber, IsBoolean, IsDateString, Min, Max, MaxLength, Matches, ValidateIf } from 'class-validator';
import { PaginationDto } from '../common/pagination.dto';
import { IsStoreIdOrAll } from '../common/store-id-or-all.validator';

export enum CustomerPaymentDirectionDto {
    RECEIVE = 'receive',
    PAY = 'pay',
}

export enum CustomerTypeDto {
    INDIVIDUAL = 'INDIVIDUAL',
    ORGANIZATION = 'ORGANIZATION',
}

export class CreateCustomerDto {
    /** Left blank, the service generates the next CUST-##### code. */
    @IsOptional()
    @IsString()
    customer_code?: string;

    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    owner_name?: string;

    @IsOptional()
    @IsString()
    @Matches(/^\+?[0-9\s\-]+$/, { message: 'Invalid phone number format' })
    phone?: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    address?: string;

    @IsOptional()
    @IsString()
    profile_pic_url?: string;

    @IsOptional()
    @IsEnum(CustomerTypeDto)
    customer_type?: CustomerTypeDto;

    @IsOptional()
    @IsUUID()
    customer_group_id?: string;

    @IsOptional()
    @IsUUID()
    territory_id?: string;

    /** The employee who looks after this customer — "Sales By". Null clears it. */
    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsUUID()
    sales_rep_id?: string | null;

    /**
     * The branch the customer belongs to. Omitted: the request's header branch.
     * A member limited to some branches may name only one of theirs.
     */
    @IsOptional()
    @IsUUID()
    store_id?: string;

    @IsOptional()
    @IsNumber()
    @Min(0)
    credit_limit?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    default_discount_pct?: number;

    @IsOptional()
    @IsString()
    nid?: string;

    /**
     * ক্রেতার বিআইএন — the buyer's own VAT registration number. Printed in the
     * buyer block of a Mushak 6.3 and in column 5 of the 6.2 sales book; its
     * absence is what puts a supply over two lakh taka on the 6.10 statement.
     */
    @IsOptional()
    @IsString()
    @MaxLength(32)
    bin?: string;

    @IsOptional()
    @IsBoolean()
    credit_enabled?: boolean;

    @IsOptional()
    @IsString()
    preferred_channel?: string;

    @IsOptional()
    @IsDateString()
    birthday?: string;

    @IsOptional()
    @IsDateString()
    anniversary?: string;
}

/**
 * Quick-create payload for the document-entry customer pickers. Only `name` is
 * required; the document's service creates the customer in the same
 * transaction, so nothing is persisted if the document itself fails.
 */
export class InlineCustomerDto {
    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    @Matches(/^\+?[0-9\s\-]+$/, { message: 'Invalid phone number format' })
    phone?: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    address?: string;
}

export class UpdateCustomerDto {
    @IsOptional()
    @IsString()
    customer_code?: string;

    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    owner_name?: string;

    @IsOptional()
    @IsString()
    @Matches(/^\+?[0-9\s\-]+$/, { message: 'Invalid phone number format' })
    phone?: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    address?: string;

    @IsOptional()
    @IsString()
    profile_pic_url?: string;

    @IsOptional()
    @IsEnum(CustomerTypeDto)
    customer_type?: CustomerTypeDto;

    @IsOptional()
    @IsUUID()
    customer_group_id?: string;

    @IsOptional()
    @IsUUID()
    territory_id?: string;

    /** The employee who looks after this customer — "Sales By". Null clears it. */
    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsUUID()
    sales_rep_id?: string | null;

    /**
     * Moves the customer to another branch — see `customer-visibility.ts`. Only
     * a member who sees every branch may change it, and a customer always has
     * one: null is refused.
     */
    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsUUID()
    store_id?: string | null;

    @IsOptional()
    @IsNumber()
    @Min(0)
    credit_limit?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    default_discount_pct?: number;

    @IsOptional()
    @IsString()
    nid?: string;

    /**
     * ক্রেতার বিআইএন — the buyer's own VAT registration number. Printed in the
     * buyer block of a Mushak 6.3 and in column 5 of the 6.2 sales book; its
     * absence is what puts a supply over two lakh taka on the 6.10 statement.
     */
    @IsOptional()
    @IsString()
    @MaxLength(32)
    bin?: string;

    @IsOptional()
    @IsBoolean()
    credit_enabled?: boolean;

    @IsOptional()
    @IsString()
    preferred_channel?: string;

    @IsOptional()
    @IsDateString()
    birthday?: string;

    @IsOptional()
    @IsDateString()
    anniversary?: string;
}

export class RecordCreditPaymentDto {
    /**
     * Money received (or paid out). May be 0 only when `discount` settles the
     * whole remainder on its own — the leftover ৳3 nobody will ever collect.
     */
    @IsNumber()
    @Min(0)
    amount: number;

    /**
     * Receipts only: a remainder the shop lets the customer off, settled with
     * this payment. Lowers the due alongside `amount` and posts to Discount
     * Allowed, never to cash.
     */
    @IsOptional()
    @IsNumber()
    @Min(0)
    discount?: number;

    @IsOptional()
    @IsEnum(CustomerPaymentDirectionDto)
    direction?: CustomerPaymentDirectionDto;

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
     * CPY-/CPO- series; a typed one must not be used by any other customer
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
}

/**
 * Why a debt is being forgiven. Stored on the transaction rather than steering
 * the posting: every reason lands in the same Bad Debt Expense account, and a
 * shopkeeper who has to pick a reason writes a better note than one who does
 * not.
 */
export enum BadDebtReasonDto {
    /** Gone, moved away, phone dead — the ordinary case. */
    UNTRACEABLE = 'UNTRACEABLE',
    /** Traceable but refusing, and not worth pursuing. */
    REFUSED = 'REFUSED',
    /** Wound up, bankrupt, or the person has died. */
    CLOSED_OR_DECEASED = 'CLOSED_OR_DECEASED',
    /** Cost of chasing it exceeds what is owed. */
    UNECONOMIC_TO_PURSUE = 'UNECONOMIC_TO_PURSUE',
    /** Settled for less than the full amount; the shortfall is written off. */
    SETTLED_SHORT = 'SETTLED_SHORT',
    OTHER = 'OTHER',
}

export class WriteOffCustomerDebtDto {
    /**
     * How much of the due to forgive. Partial write-offs are ordinary — a
     * customer who settles ৳7,000 of a ৳10,000 debt leaves ৳3,000 to write off.
     */
    @IsNumber()
    @Min(0.01)
    amount: number;

    @IsEnum(BadDebtReasonDto)
    reason: BadDebtReasonDto;

    /**
     * Required, unlike the note on a payment. A write-off is the one AR action
     * with no document from the other side, so the person approving it later
     * has nothing to read but this.
     */
    @IsString()
    @MaxLength(500)
    notes: string;

    /**
     * The date the debt is recognised as lost. Defaults to today. Backdating is
     * allowed so a write-off can land in the period it belongs to, and is
     * refused by the fiscal-period lock if that period is closed.
     */
    @IsOptional()
    @IsDateString()
    date?: string;

    /**
     * Whether to stop this customer buying on credit. Defaults to true: writing
     * a debt off drops `due_balance`, which would otherwise hand the customer
     * their full credit limit back the moment they failed to pay it.
     */
    @IsOptional()
    @IsBoolean()
    disableCredit?: boolean;
}

export class ListCustomerWriteOffsQueryDto extends PaginationDto {
    @IsOptional()
    @IsUUID()
    customerId?: string;

    @IsOptional()
    @IsEnum(BadDebtReasonDto)
    reason?: BadDebtReasonDto;

    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}

export class UpdateCreditPaymentDto {
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
    @IsEnum(CustomerPaymentDirectionDto)
    direction?: CustomerPaymentDirectionDto;

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

export class NextCustomerPaymentNumberQueryDto {
    @IsOptional()
    @IsEnum(CustomerPaymentDirectionDto)
    direction?: CustomerPaymentDirectionDto;
}

export class ListCustomerCreditPaymentsQueryDto extends PaginationDto {
    @IsOptional()
    @IsUUID()
    customerId?: string;

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
