import {
    IsArray, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID,
    Max, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ClaimLineDto {
    @IsString()
    description: string;

    @IsNumber()
    @Min(0)
    @Type(() => Number)
    amount: number;

    @IsDateString()
    spent_on: string;

    @IsOptional()
    @IsUUID()
    category_id?: string;
}

export class CreateExpenseClaimDto {
    @IsString()
    title: string;

    @IsDateString()
    claim_date: string;

    @IsOptional()
    @IsString()
    notes?: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ClaimLineDto)
    lines: ClaimLineDto[];
}

export class UpdateExpenseClaimDto {
    @IsOptional() @IsString() title?: string;
    @IsOptional() @IsDateString() claim_date?: string;
    @IsOptional() @IsString() notes?: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ClaimLineDto)
    lines?: ClaimLineDto[];
}

export class ReviewExpenseClaimDto {
    @IsEnum(['APPROVED', 'REJECTED'] as any)
    status: 'APPROVED' | 'REJECTED';

    @IsOptional()
    @IsString()
    approver_note?: string;
}

export class ReimburseExpenseClaimDto {
    @IsEnum(['DIRECT', 'PAYROLL'] as any)
    via: 'DIRECT' | 'PAYROLL';

    @IsOptional() @IsInt() @Min(2000) @Max(2200) @Type(() => Number) year?: number;
    @IsOptional() @IsInt() @Min(1) @Max(12) @Type(() => Number) month?: number;
}

export class ExpenseClaimQueryDto {
    @IsOptional() @IsUUID() employeeId?: string;
    @IsOptional() @IsString() status?: string;
}
