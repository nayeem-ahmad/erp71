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
    'loan_disbursement',
    'loan_repayment',
] as const;

const POSTING_RULE_CONDITION_KEYS = [
    'payment_mode',
    'reason_type',
    'transfer_scope',
    'loan_direction',
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

export class ProfitLossQueryDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}

export class BalanceSheetQueryDto {
    @IsOptional()
    @IsDateString()
    asOfDate?: string;
}

export class CashbookQueryDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;

    @IsOptional()
    @IsString()
    accountId?: string;
}

export class BankbookQueryDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;

    @IsOptional()
    @IsString()
    accountId?: string;
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

export class TrialBalanceQueryDto {
    @IsOptional()
    @IsDateString()
    asOfDate?: string;
}

export class ArAgingQueryDto {
    @IsOptional()
    @IsDateString()
    asOfDate?: string;
}

export class ApAgingQueryDto {
    @IsOptional()
    @IsDateString()
    asOfDate?: string;
}

export class ComparativePLQueryDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}

export class VatTaxReportQueryDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}

export class FinancialRatiosQueryDto {
    @IsOptional()
    @IsDateString()
    asOfDate?: string;

    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}

export class CashFlowQueryDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}

// Feature 8: Fiscal Period Locking
export class LockFiscalPeriodDto {
    @Type(() => Number)
    @IsInt()
    @Min(2020)
    @Max(2099)
    year: number;

    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(12)
    month: number;
}

export class FiscalPeriodsQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    year?: number;
}

// Feature 9: Opening Balance Import
export class OpeningBalanceEntryDto {
    @IsUUID()
    accountId: string;

    @Type(() => Number)
    @IsNumber()
    @Min(0)
    debitAmount: number;

    @Type(() => Number)
    @IsNumber()
    @Min(0)
    creditAmount: number;
}

export class ImportOpeningBalancesDto {
    @IsDateString()
    asOfDate: string;

    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => OpeningBalanceEntryDto)
    entries: OpeningBalanceEntryDto[];
}

// Feature 10: Budget vs Actual
export class UpsertBudgetDto {
    @IsUUID()
    accountId: string;

    @Type(() => Number)
    @IsInt()
    @Min(2020)
    @Max(2099)
    fiscalYear: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(12)
    month?: number;

    @Type(() => Number)
    @IsNumber()
    @Min(0)
    amount: number;
}

export class BudgetVsActualQueryDto {
    @Type(() => Number)
    @IsInt()
    @Min(2020)
    fiscalYear: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(12)
    month?: number;
}

// Feature 11: Cost Centers
export class CreateCostCenterDto {
    @IsString()
    @IsNotEmpty()
    code: string;

    @IsString()
    @IsNotEmpty()
    name: string;
}

export class CostCenterPLQueryDto {
    @IsUUID()
    costCenterId: string;

    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}

// Feature 12: Fixed Assets
export class CreateFixedAssetDto {
    @IsString()
    @IsNotEmpty()
    assetCode: string;

    @IsString()
    @IsNotEmpty()
    name: string;

    @IsDateString()
    purchaseDate: string;

    @Type(() => Number)
    @IsNumber()
    @Min(0)
    cost: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    residualValue?: number;

    @Type(() => Number)
    @IsInt()
    @Min(1)
    usefulLifeMonths: number;

    @IsOptional()
    @IsIn(['STRAIGHT_LINE', 'DECLINING_BALANCE'])
    depreciationMethod?: string;

    @IsOptional()
    @IsUUID()
    assetAccountId?: string;

    @IsOptional()
    @IsUUID()
    depreciationAccountId?: string;
}

export class RunDepreciationDto {
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

// Feature 13: Recurring Journals
export class CreateRecurringJournalLineDto {
    @IsUUID()
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

export class CreateRecurringJournalDto {
    @IsString()
    @IsNotEmpty()
    name: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsIn(['MONTHLY', 'WEEKLY', 'DAILY'])
    frequency: string;

    @IsDateString()
    nextDueDate: string;

    @ArrayMinSize(2)
    @ValidateNested({ each: true })
    @Type(() => CreateRecurringJournalLineDto)
    lines: CreateRecurringJournalLineDto[];
}

// Recurring Vouchers: like recurring journals, but any voucher type
export class CreateRecurringVoucherLineDto {
    @IsUUID()
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

export class CreateRecurringVoucherDto {
    @IsString()
    @IsNotEmpty()
    name: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsString()
    @IsIn(Object.values(VoucherType))
    voucherType?: VoucherType;

    @IsIn(['MONTHLY', 'WEEKLY', 'DAILY'])
    frequency: string;

    @IsDateString()
    nextDueDate: string;

    @ArrayMinSize(2)
    @ValidateNested({ each: true })
    @Type(() => CreateRecurringVoucherLineDto)
    lines: CreateRecurringVoucherLineDto[];
}

export class ListRecurringVouchersQueryDto {
    @IsOptional()
    @IsString()
    @IsIn(Object.values(VoucherType))
    voucherType?: VoucherType;
}

// Voucher Templates: reusable named line templates for quick voucher entry
export class CreateVoucherTemplateLineDto {
    @IsUUID()
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

export class CreateVoucherTemplateDto {
    @IsString()
    @IsNotEmpty()
    name: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsString()
    @IsIn(Object.values(VoucherType))
    voucherType: VoucherType;

    @ArrayMinSize(2)
    @ValidateNested({ each: true })
    @Type(() => CreateVoucherTemplateLineDto)
    lines: CreateVoucherTemplateLineDto[];
}

export class ListVoucherTemplatesQueryDto {
    @IsOptional()
    @IsString()
    @IsIn(Object.values(VoucherType))
    voucherType?: VoucherType;
}

// Feature 14: Bank Reconciliation
export class CreateBankReconciliationDto {
    @IsUUID()
    accountId: string;

    @IsDateString()
    statementDate: string;

    @Type(() => Number)
    @IsNumber()
    statementClosingBalance: number;
}

export class BankStatementEntryDto {
    @IsDateString()
    entryDate: string;

    @IsOptional()
    @IsString()
    description?: string;

    @Type(() => Number)
    @IsNumber()
    amount: number;

    @IsIn(['DEBIT', 'CREDIT'])
    entryType: string;
}

export class ImportBankStatementDto {
    @IsUUID()
    reconciliationId: string;

    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => BankStatementEntryDto)
    entries: BankStatementEntryDto[];
}

export class MatchBankEntryDto {
    @IsUUID()
    statementEntryId: string;

    @IsUUID()
    voucherDetailId: string;
}