import {
    IsDateString,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
    Min,
} from 'class-validator';
import { PaginationDto } from '../common/pagination.dto';

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
