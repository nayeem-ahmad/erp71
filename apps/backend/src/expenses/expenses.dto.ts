import {
    IsDateString,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Min,
} from 'class-validator';
import { PaginationDto } from '../common/pagination.dto';

export class CreateExpenseCategoryDto {
    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    description?: string;
}

export class UpdateExpenseCategoryDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    description?: string;
}

export class CreateExpenseEntryDto {
    @IsUUID()
    categoryId: string;

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
    categoryId?: string;

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
    @IsUUID()
    storeId?: string;
}