import { Type } from 'class-transformer';
import {
    IsBoolean,
    IsDateString,
    IsIn,
    IsInt,
    IsNumber,
    IsOptional,
    IsPositive,
    IsString,
    Max,
    MaxLength,
    Min,
    MinLength,
} from 'class-validator';
import { PLATFORM_PAYMENT_METHODS } from '@erp71/database';

export class SyncPlatformBillingDto {
    /** Only project events on or after this date. Omitted = from the beginning. */
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}

export class PlatformAccountingOverviewQueryDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}

export class CreatePlatformExpenseDto {
    @IsString()
    @MinLength(1)
    categoryId: string;

    @IsNumber({ maxDecimalPlaces: 2 })
    @IsPositive()
    amount: number;

    @IsDateString()
    expenseDate: string;

    @IsOptional()
    @IsString()
    @IsIn(PLATFORM_PAYMENT_METHODS)
    paidFrom?: string;

    @IsOptional()
    @IsString()
    @MaxLength(160)
    vendor?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    reference?: string;
}

/**
 * Editing an expense re-posts its voucher, so every field here is one the
 * ledger cares about. There is no partial "notes only" path for that reason —
 * `update` voids and re-posts regardless, which is cheaper than working out
 * which fields were ledger-relevant and getting it wrong.
 */
export class UpdatePlatformExpenseDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    categoryId?: string;

    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @IsPositive()
    amount?: number;

    @IsOptional()
    @IsDateString()
    expenseDate?: string;

    @IsOptional()
    @IsString()
    @IsIn(PLATFORM_PAYMENT_METHODS)
    paidFrom?: string;

    @IsOptional()
    @IsString()
    @MaxLength(160)
    vendor?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    reference?: string;
}

export class ListPlatformExpensesQueryDto {
    @IsOptional()
    @IsString()
    categoryId?: string;

    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    search?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number;
}

export class CreatePlatformExpenseCategoryDto {
    @IsString()
    @MinLength(2)
    @MaxLength(60)
    name: string;

    /**
     * The expense account this category debits. Validated against the platform
     * chart of accounts at save time rather than typed freely: an unknown name
     * would make every expense filed under it fail to post, and it would fail
     * at posting time rather than here.
     */
    @IsString()
    @MinLength(1)
    accountName: string;

    @IsOptional()
    @IsString()
    @MaxLength(300)
    description?: string;
}

export class UpdatePlatformExpenseCategoryDto {
    @IsOptional()
    @IsString()
    @MinLength(2)
    @MaxLength(60)
    name?: string;

    @IsOptional()
    @IsString()
    @MinLength(1)
    accountName?: string;

    @IsOptional()
    @IsString()
    @MaxLength(300)
    description?: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}
