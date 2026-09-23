import { ArrayMinSize, IsArray, MaxLength, IsDateString, IsEmail, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../common/pagination.dto';

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
    @IsNumber()
    @Min(0.01)
    amount: number;

    @IsOptional()
    @IsEnum(SupplierPaymentDirectionDto)
    direction?: SupplierPaymentDirectionDto;

    @IsOptional()
    @IsString()
    notes?: string;

    /**
     * How the money moved — the tenant's payment-method name as picked
     * ("Cash", "bKash", …). Optional: omitted, the payment posts to the rule's
     * default cash account exactly as before.
     */
    @IsOptional()
    @IsString()
    @MaxLength(100)
    paymentMethod?: string;

    /**
     * The ledger account the cash leg posts to, when the method is linked to
     * one. Wins over anything derived from `paymentMethod`.
     */
    @IsOptional()
    @IsString()
    accountId?: string;

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
    @Min(0.01)
    amount?: number;

    @IsOptional()
    @IsEnum(SupplierPaymentDirectionDto)
    direction?: SupplierPaymentDirectionDto;

    @IsOptional()
    @IsString()
    notes?: string;

    /**
     * How the money moved — the tenant's payment-method name as picked
     * ("Cash", "bKash", …). Optional: omitted, the payment posts to the rule's
     * default cash account exactly as before.
     */
    @IsOptional()
    @IsString()
    @MaxLength(100)
    paymentMethod?: string;

    /**
     * The ledger account the cash leg posts to, when the method is linked to
     * one. Wins over anything derived from `paymentMethod`.
     */
    @IsOptional()
    @IsString()
    accountId?: string;
}

export class ListSupplierCreditPaymentsQueryDto extends PaginationDto {
    @IsOptional()
    @IsUUID()
    supplierId?: string;

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