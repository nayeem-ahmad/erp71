import {
    IsDateString,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Min,
} from 'class-validator';
import { IsStoreIdOrAll } from '../common/store-id-or-all.validator';
import { PaginationDto } from '../common/pagination.dto';

export class CreateExpenseCategoryDto {
    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    description?: string;

    /** Expense account this category is charged to. Omit to use the posting rule. */
    @IsOptional()
    @IsUUID()
    accountId?: string | null;
}

export class UpdateExpenseCategoryDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    description?: string;

    /** Null clears the link and posts to the rule's debit account again. */
    @IsOptional()
    @IsUUID()
    accountId?: string | null;
}

export class CreateExpenseHeadDto {
    @IsUUID()
    categoryId: string;

    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    description?: string;

    /** Null uses the category's account. */
    @IsOptional()
    @IsUUID()
    accountId?: string | null;
}

export class UpdateExpenseHeadDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    description?: string;

    /** Null clears a direct link so the head posts through its category. */
    @IsOptional()
    @IsUUID()
    accountId?: string | null;
}

export class ListExpenseHeadsQueryDto {
    @IsOptional()
    @IsUUID()
    categoryId?: string;
}

export class CreateExpenseEntryDto {
    @IsUUID()
    headId: string;

    @IsNumber()
    @Min(0.01)
    amount: number;

    @IsDateString()
    expenseDate: string;

    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsString()
    paymentMethod?: string;
}

export class UpdateExpenseEntryDto {
    @IsOptional()
    @IsUUID()
    headId?: string;

    @IsOptional()
    @IsNumber()
    @Min(0.01)
    amount?: number;

    @IsOptional()
    @IsDateString()
    expenseDate?: string;

    @IsOptional()
    @IsUUID()
    storeId?: string | null;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsString()
    paymentMethod?: string;
}

export class ListExpenseEntriesQueryDto extends PaginationDto {
    @IsOptional()
    @IsUUID()
    categoryId?: string;

    @IsOptional()
    @IsUUID()
    headId?: string;

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
    @IsDateString()
    createdFrom?: string;

    @IsOptional()
    @IsDateString()
    createdTo?: string;
}

export class ExpenseReportQueryDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;

    @IsOptional()
    @IsStoreIdOrAll()
    storeId?: string;
}