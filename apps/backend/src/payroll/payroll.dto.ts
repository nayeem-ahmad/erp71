import {
    IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsOptional,
    IsString, IsUUID, Max, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSalaryComponentDto {
    @IsString()
    name: string;

    @IsEnum(['EARNING', 'DEDUCTION'] as any)
    kind: string;

    @IsOptional()
    @IsEnum(['FIXED', 'PERCENT_OF_BASIC'] as any)
    calculation?: string;

    @IsOptional()
    @IsBoolean()
    is_taxable?: boolean;

    @IsOptional()
    @IsBoolean()
    is_basic?: boolean;

    @IsOptional()
    @IsInt()
    @Type(() => Number)
    sort_order?: number;
}

export class UpdateSalaryComponentDto {
    @IsOptional() @IsString() name?: string;
    @IsOptional() @IsEnum(['EARNING', 'DEDUCTION'] as any) kind?: string;
    @IsOptional() @IsEnum(['FIXED', 'PERCENT_OF_BASIC'] as any) calculation?: string;
    @IsOptional() @IsBoolean() is_taxable?: boolean;
    @IsOptional() @IsBoolean() is_basic?: boolean;
    @IsOptional() @IsInt() @Type(() => Number) sort_order?: number;
}

export class StructureLineDto {
    @IsUUID()
    component_id: string;

    @IsNumber()
    @Min(0)
    @Type(() => Number)
    value: number;
}

export class SetSalaryStructureDto {
    @IsUUID()
    employee_id: string;

    @IsDateString()
    effective_from: string;

    @IsOptional()
    @IsString()
    note?: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => StructureLineDto)
    lines: StructureLineDto[];
}

export class SetBankAccountDto {
    @IsEnum(['BANK', 'BKASH', 'NAGAD', 'CASH'] as any)
    method: string;

    @IsOptional() @IsString() bank_name?: string;
    @IsOptional() @IsString() branch_name?: string;
    @IsOptional() @IsString() account_number?: string;
    @IsOptional() @IsString() account_name?: string;
    @IsOptional() @IsString() routing_number?: string;
    @IsOptional() @IsString() wallet_number?: string;
}

export class ResolveStructureQueryDto {
    @IsOptional()
    @IsDateString()
    on?: string;
}

export class PayrollPeriodDto {
    @IsInt() @Min(2000) @Max(2200) @Type(() => Number)
    year: number;

    @IsInt() @Min(1) @Max(12) @Type(() => Number)
    month: number;
}

export class CreatePayrollRunDto {
    @IsInt() @Min(2000) @Max(2200) @Type(() => Number)
    year: number;

    @IsInt() @Min(1) @Max(12) @Type(() => Number)
    month: number;

    @IsOptional()
    @IsEnum(['REGULAR', 'BONUS', 'FINAL_SETTLEMENT'] as any)
    kind?: string;

    @IsOptional() @IsString() label?: string;
}

export class PayrollRunQueryDto {
    @IsOptional() @IsInt() @Min(2000) @Max(2200) @Type(() => Number) year?: number;
    @IsOptional() @IsString() status?: string;
}

export class CreatePayrollAdjustmentDto {
    @IsUUID() employee_id: string;

    @IsInt() @Min(2000) @Max(2200) @Type(() => Number) year: number;
    @IsInt() @Min(1) @Max(12) @Type(() => Number) month: number;

    @IsEnum(['EARNING', 'DEDUCTION'] as any)
    kind: string;

    @IsString() name: string;

    @IsNumber() @Min(0) @Type(() => Number) amount: number;

    @IsOptional() @IsString() note?: string;
}

export class DisbursePayrollDto {
    @IsOptional()
    @IsDateString()
    payment_date?: string;

    @IsOptional()
    @IsEnum(['CASH', 'BANK', 'BKASH', 'NAGAD'] as any)
    payment_method?: string;
}
