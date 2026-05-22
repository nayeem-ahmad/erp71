import { Type } from 'class-transformer';
import {
    ArrayMinSize,
    IsDateString,
    IsIn,
    IsNotEmpty,
    IsNumber,
    IsInt,
    IsOptional,
    IsString,
    ValidateNested,
    IsBoolean,
    IsUUID,
    MaxLength,
    Min,
    Max,
} from 'class-validator';
import { AccountCategory, AccountType, VoucherType } from './accounting.constants';

export class CreateAccountGroupDto {
    @IsString()
    @IsNotEmpty()
    name: string;

    @IsString()
    @IsIn(Object.values(AccountType))
    type: AccountType;
}

export class CreateAccountSubgroupDto {
    @IsString()
    @IsNotEmpty()
    groupId: string;

    @IsString()
    @IsNotEmpty()
    name: string;
}

export class CreateAccountDto {
    @IsString()
    @IsNotEmpty()
    groupId: string;

    @IsOptional()
    @IsString()
    subgroupId?: string;

    @IsString()
    @IsNotEmpty()
    name: string;

    @IsOptional()
    @IsString()
    code?: string;

    @IsString()
    @IsIn(Object.values(AccountType))
    type: AccountType;

    @IsString()
    @IsIn(Object.values(AccountCategory))
    category: AccountCategory;
}

export class ListAccountSubgroupsQueryDto {
    @IsOptional()
    @IsString()
    groupId?: string;
}

export class ListAccountsQueryDto {
    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @IsString()
    groupId?: string;

    @IsOptional()
    @IsString()
    @IsIn(Object.values(AccountType))
    type?: AccountType;

    @IsOptional()
    @IsString()
    @IsIn(Object.values(AccountCategory))
    category?: AccountCategory;
}

export class VoucherNumberPreviewQueryDto {
    @IsString()
    @IsIn(Object.values(VoucherType))
    voucherType: VoucherType;
}

export class CreateVoucherDetailDto {
    @IsString()
    @IsNotEmpty()
    accountId: string;

    @Type(() => Number)
    @IsNumber()
    debitAmount: number;

    @Type(() => Number)
    @IsNumber()
    creditAmount: number;

    @IsOptional()
    @IsString()
    comment?: string;
}

export class CreateVoucherDto {
    @IsString()
    @IsIn(Object.values(VoucherType))
    voucherType: VoucherType;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsString()
    referenceNumber?: string;

    @IsOptional()
    @IsDateString()
    date?: string;

    @ArrayMinSize(2)
    @ValidateNested({ each: true })
    @Type(() => CreateVoucherDetailDto)
    details: CreateVoucherDetailDto[];
}

export class ListVouchersQueryDto {
    @IsOptional()
    @IsString()
    @IsIn(Object.values(VoucherType))
    voucherType?: VoucherType;

    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    limit?: number;
}

export class ListLedgerQueryDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}

export class FinancialKpiQueryDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}

export class FinancialTrendQueryDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}

const POSTING_RULE_EVENT_TYPES = [
    'sale',
    'sale_return',
    'purchase',
    'purchase_return',
    'inventory_adjustment',
    'fund_movement',
] as const;

const POSTING_RULE_CONDITION_KEYS = [
    'payment_mode',
    'reason_type',
    'transfer_scope',
    'none',
] as const;

const POSTING_EVENT_STATUSES = ['pending', 'posted', 'failed', 'skipped'] as const;

export class ListPostingRulesQueryDto {
    @IsOptional()
    @IsString()
    @IsIn(POSTING_RULE_EVENT_TYPES)
    eventType?: typeof POSTING_RULE_EVENT_TYPES[number];

    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    isActive?: boolean;
}

export class UpdatePostingRuleDto {
    @IsUUID()
    debitAccountId: string;

    @IsUUID()
    creditAccountId: string;

    @IsString()
    @IsIn(POSTING_RULE_CONDITION_KEYS)
    conditionKey: typeof POSTING_RULE_CONDITION_KEYS[number];

    @IsOptional()
    @IsString()
    @MaxLength(64)
    conditionValue?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(1000)
    priority?: number;

    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    isActive?: boolean;
}

export class ListPostingExceptionsQueryDto {
    @IsOptional()
    @IsString()
    @IsIn(POSTING_EVENT_STATUSES)
    status?: typeof POSTING_EVENT_STATUSES[number];

    @IsOptional()
    @IsString()
    module?: string;

    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    limit?: number;
}

const EXPORT_FORMATS = ['tally', 'quickbooks'] as const;

export class ExportLedgerQueryDto {
    @IsString()
    @IsIn(EXPORT_FORMATS)
    format: typeof EXPORT_FORMATS[number];

    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}