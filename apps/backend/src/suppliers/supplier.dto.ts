import { ArrayMinSize, IsArray, IsDateString, IsEmail, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
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