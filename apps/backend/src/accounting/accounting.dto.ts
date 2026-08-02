import { Transform, Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsDateString,
    IsIn,
    IsNotEmpty,
    IsNumber,
    IsInt,
    IsOptional,
    IsString,
    ValidateIf,
    ValidateNested,
    IsBoolean,
    IsUUID,
    MaxLength,
    Min,
    Max,
} from 'class-validator';
import { AccountCategory, AccountType, VoucherApprovalStatus, VoucherAttribution, VoucherType } from './accounting.constants';
import { REPORT_LEVELS } from './report-level.utils';

const REPORT_SCOPES = ['branch', 'company', 'compare'] as const;

function parseBooleanQuery(value: unknown): boolean | undefined {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    if (value === 'true' || value === '1') {
        return true;
    }
    if (value === 'false' || value === '0') {
        return false;
    }
    return undefined;
}

/**
 * Mixed into every report query. `?approvedOnly=true|false` overrides the
 * tenant's `reports_approved_only` accounting setting for one request; omitted,
 * the setting decides.
 */
export class ApprovedOnlyQueryDto {
    @IsOptional()
    @Transform(({ value }) => parseBooleanQuery(value))
    @IsBoolean()
    approvedOnly?: boolean;
}

export class CreateAccountGroupDto {
    @IsString()
    @IsNotEmpty()
    name: string;

    /** Left blank, the server allocates the next free code. */
    @IsOptional()
    @IsString()
    @MaxLength(2)
    code?: string;

    @IsString()
    @IsIn(Object.values(AccountType))
    type: AccountType;
}

export class NextAccountGroupCodeQueryDto {
    @IsString()
    @IsIn(Object.values(AccountType))
    type: AccountType;
}

export class UpdateAccountGroupDto {
    @IsString()
    @IsNotEmpty()
    name: string;
}

export class CreateAccountSubgroupDto {
    @IsString()
    @IsNotEmpty()
    groupId: string;

    @IsString()
    @IsNotEmpty()
    name: string;

    /** Left blank, the server allocates the next free code under the group. */
    @IsOptional()
    @IsString()
    @MaxLength(4)
    code?: string;
}

export class NextAccountSubgroupCodeQueryDto {
    @IsString()
    @IsNotEmpty()
    groupId: string;
}

export class NextAccountCodeQueryDto {
    @IsString()
    @IsNotEmpty()
    groupId: string;

    @IsOptional()
    @IsString()
    subgroupId?: string;
}

export class UpdateAccountSubgroupDto {
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
    @MaxLength(6)
    code?: string;

    @IsString()
    @IsIn(Object.values(AccountType))
    type: AccountType;

    @IsString()
    @IsIn(Object.values(AccountCategory))
    category: AccountCategory;
}

/**
 * `type` is intentionally absent: it is derived from the target group so an
 * account can never drift out of sync with the group it reports under.
 */
export class UpdateAccountDto {
    @IsString()
    @IsNotEmpty()
    groupId: string;

    /** Empty string or null detaches the account from its subgroup. */
    @IsOptional()
    @ValidateIf((_object, value) => value !== null && value !== '')
    @IsString()
    subgroupId?: string | null;

    @IsString()
    @IsNotEmpty()
    name: string;

    @IsOptional()
    @IsString()
    @MaxLength(6)
    code?: string;

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

export class CreateVoucherAttachmentDto {
    @IsString()
    @IsNotEmpty()
    url: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    fileName: string;

    @IsOptional()
    @IsString()
    mimeType?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    fileSize?: number;
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

    @IsOptional()
    @IsUUID()
    costCenterId?: string;
}

export class CreateVoucherDto {
    @IsString()
    @IsIn(Object.values(VoucherType))
    voucherType: VoucherType;

    @IsString()
    @IsNotEmpty()
    @MaxLength(500)
    description: string;

    @IsOptional()
    @IsString()
    referenceNumber?: string;

    @IsOptional()
    @IsDateString()
    date?: string;

    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsString()
    @IsIn(Object.values(VoucherAttribution))
    attribution?: VoucherAttribution;

    @IsOptional()
    @IsUUID()
    counterpartyStoreId?: string;

    @ArrayMinSize(2)
    @ValidateNested({ each: true })
    @Type(() => CreateVoucherDetailDto)
    details: CreateVoucherDetailDto[];

    @IsOptional()
    @ValidateNested({ each: true })
    @Type(() => CreateVoucherAttachmentDto)
    attachments?: CreateVoucherAttachmentDto[];
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

    /** Drives the approval queue: `?approvalStatus=PENDING`. */
    @IsOptional()
    @IsString()
    @IsIn(Object.values(VoucherApprovalStatus))
    approvalStatus?: VoucherApprovalStatus;

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

export class RejectVoucherDto {
    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;
}

/**
 * Bulk sign-off from the approval queue. Capped at 200 so one request cannot
 * rewrite an unbounded slice of the ledger; the queue pages at 20.
 */
export class BulkVoucherApprovalDto {
    @ArrayMinSize(1)
    @ArrayMaxSize(200)
    @IsUUID(undefined, { each: true })
    ids: string[];

    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;
}

export class UpdateAccountingSettingsDto {
    @IsOptional()
    @Transform(({ value }) => parseBooleanQuery(value))
    @IsBoolean()
    requireVoucherApproval?: boolean;

    @IsOptional()
    @Transform(({ value }) => parseBooleanQuery(value))
    @IsBoolean()
    autoApproveSystemVouchers?: boolean;

    @IsOptional()
    @Transform(({ value }) => parseBooleanQuery(value))
    @IsBoolean()
    reportsApprovedOnly?: boolean;
}

export class ListLedgerQueryDto extends ApprovedOnlyQueryDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}

export class FinancialKpiQueryDto extends ApprovedOnlyQueryDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}

export class FinancialTrendQueryDto extends ApprovedOnlyQueryDto {
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

export class ProfitLossQueryDto extends ApprovedOnlyQueryDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;

    @IsOptional()
    @IsString()
    @IsIn(REPORT_SCOPES)
    scope?: string;

    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsString()
    storeIds?: string;

    @IsOptional()
    @Transform(({ value }) => parseBooleanQuery(value))
    @IsBoolean()
    includeCompanyBucket?: boolean;

    @IsOptional()
    @IsString()
    @IsIn(REPORT_LEVELS)
    level?: string;
}

export class BalanceSheetQueryDto extends ApprovedOnlyQueryDto {
    @IsOptional()
    @IsDateString()
    asOfDate?: string;

    @IsOptional()
    @IsString()
    @IsIn(REPORT_SCOPES)
    scope?: string;

    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsString()
    storeIds?: string;

    @IsOptional()
    @Transform(({ value }) => parseBooleanQuery(value))
    @IsBoolean()
    includeCompanyBucket?: boolean;

    @IsOptional()
    @IsString()
    @IsIn(REPORT_LEVELS)
    level?: string;
}

export class CashbookQueryDto extends ApprovedOnlyQueryDto {
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

export class BankbookQueryDto extends ApprovedOnlyQueryDto {
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

export class ExportLedgerQueryDto extends ApprovedOnlyQueryDto {
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

export class TrialBalanceQueryDto extends ApprovedOnlyQueryDto {
    @IsOptional()
    @IsDateString()
    asOfDate?: string;

    @IsOptional()
    @IsString()
    @IsIn(REPORT_SCOPES)
    scope?: string;

    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsString()
    storeIds?: string;

    @IsOptional()
    @Transform(({ value }) => parseBooleanQuery(value))
    @IsBoolean()
    includeCompanyBucket?: boolean;

    @IsOptional()
    @IsString()
    @IsIn(REPORT_LEVELS)
    level?: string;
}

export class ArAgingQueryDto extends ApprovedOnlyQueryDto {
    @IsOptional()
    @IsDateString()
    asOfDate?: string;
}

export class ApAgingQueryDto extends ApprovedOnlyQueryDto {
    @IsOptional()
    @IsDateString()
    asOfDate?: string;
}

export class ComparativePLQueryDto extends ApprovedOnlyQueryDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}

export class VatTaxReportQueryDto extends ApprovedOnlyQueryDto {
    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}

export class FinancialRatiosQueryDto extends ApprovedOnlyQueryDto {
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

export class CashFlowQueryDto extends ApprovedOnlyQueryDto {
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

export class BudgetVsActualQueryDto extends ApprovedOnlyQueryDto {
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

export class CostCenterPLQueryDto extends ApprovedOnlyQueryDto {
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

    /** How the asset was paid for; classified to a payment mode. Defaults to cash. */
    @IsOptional()
    @IsString()
    paymentMethod?: string;
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