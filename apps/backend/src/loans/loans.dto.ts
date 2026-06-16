import {
    IsDateString,
    IsIn,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    MaxLength,
    Min,
} from 'class-validator';
import { PaginationDto } from '../common/pagination.dto';

export const LOAN_DIRECTIONS = ['PAYABLE', 'RECEIVABLE'] as const;
export const LOAN_STATUSES = ['ACTIVE', 'CLOSED'] as const;

export class CreateLoanDto {
    @IsString()
    @MaxLength(200)
    counterparty: string;

    @IsOptional()
    @IsIn(LOAN_DIRECTIONS)
    direction?: (typeof LOAN_DIRECTIONS)[number];

    @IsNumber()
    @Min(0.01)
    principal: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(1000)
    interestRate?: number;

    @IsDateString()
    startDate: string;

    @IsOptional()
    @IsDateString()
    dueDate?: string;

    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    reference?: string;

    @IsOptional()
    @IsString()
    notes?: string;
}

export class UpdateLoanDto {
    @IsOptional()
    @IsString()
    @MaxLength(200)
    counterparty?: string;

    @IsOptional()
    @IsIn(LOAN_DIRECTIONS)
    direction?: (typeof LOAN_DIRECTIONS)[number];

    @IsOptional()
    @IsNumber()
    @Min(0.01)
    principal?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(1000)
    interestRate?: number | null;

    @IsOptional()
    @IsDateString()
    startDate?: string;

    @IsOptional()
    @IsDateString()
    dueDate?: string | null;

    @IsOptional()
    @IsUUID()
    storeId?: string | null;

    @IsOptional()
    @IsIn(LOAN_STATUSES)
    status?: (typeof LOAN_STATUSES)[number];

    @IsOptional()
    @IsString()
    @MaxLength(100)
    reference?: string;

    @IsOptional()
    @IsString()
    notes?: string;
}

export class ListLoansQueryDto extends PaginationDto {
    @IsOptional()
    @IsIn(LOAN_DIRECTIONS)
    direction?: (typeof LOAN_DIRECTIONS)[number];

    @IsOptional()
    @IsIn(LOAN_STATUSES)
    status?: (typeof LOAN_STATUSES)[number];

    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsString()
    search?: string;
}

export class CreateLoanPaymentDto {
    @IsNumber()
    @Min(0.01)
    amount: number;

    @IsDateString()
    paymentDate: string;

    @IsOptional()
    @IsString()
    paymentMethod?: string;

    @IsOptional()
    @IsString()
    notes?: string;
}
