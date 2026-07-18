import {
    IsDateString,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
    Max,
    Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../common/pagination.dto';

export class RunSalaryAccrualDto {
    @Type(() => Number)
    @IsInt()
    @Min(2020)
    year: number;

    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(12)
    month: number;
}

export class CreateSalaryPaymentDto {
    @IsUUID()
    employeeId: string;

    @IsNumber()
    @Min(0.01)
    amount: number;

    /** The month the salary is for, formatted as YYYY-MM. */
    @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'payPeriod must be in YYYY-MM format' })
    payPeriod: string;

    @IsDateString()
    paymentDate: string;

    @IsOptional()
    @IsString()
    paymentMethod?: string;

    @IsOptional()
    @IsString()
    notes?: string;
}

export class UpdateSalaryPaymentDto {
    @IsOptional()
    @IsNumber()
    @Min(0.01)
    amount?: number;

    @IsOptional()
    @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'payPeriod must be in YYYY-MM format' })
    payPeriod?: string;

    @IsOptional()
    @IsDateString()
    paymentDate?: string;

    @IsOptional()
    @IsString()
    paymentMethod?: string;

    @IsOptional()
    @IsString()
    notes?: string;
}

export class ListSalaryPaymentsQueryDto extends PaginationDto {
    @IsOptional()
    @IsUUID()
    employeeId?: string;

    @IsOptional()
    @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'payPeriod must be in YYYY-MM format' })
    payPeriod?: string;

    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}

export class SalaryPaymentSummaryQueryDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}
