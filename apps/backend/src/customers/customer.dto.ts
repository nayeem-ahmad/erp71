import { IsString, IsOptional, IsEmail, IsEnum, IsUUID, IsNumber, IsBoolean, IsDateString, Min, Max, MaxLength, Matches } from 'class-validator';
import { PaginationDto } from '../common/pagination.dto';

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
    @IsNumber()
    @Min(0.01)
    amount: number;

    @IsOptional()
    @IsEnum(CustomerPaymentDirectionDto)
    direction?: CustomerPaymentDirectionDto;

    @IsOptional()
    @IsString()
    notes?: string;
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
    @Min(0.01)
    amount?: number;

    @IsOptional()
    @IsEnum(CustomerPaymentDirectionDto)
    direction?: CustomerPaymentDirectionDto;

    @IsOptional()
    @IsString()
    notes?: string;
}

export class ListCustomerCreditPaymentsQueryDto extends PaginationDto {
    @IsOptional()
    @IsUUID()
    customerId?: string;

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
