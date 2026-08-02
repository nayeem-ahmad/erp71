import { Prisma } from '@prisma/client';
import { VoucherApprovalStatus } from './accounting.constants';

/**
 * The three tenant-wide approval flags, defaulted. Kept as a plain shape rather
 * than the Prisma row so the pure helpers below stay trivially testable and the
 * "no settings row yet" case has exactly one definition.
 */
export type AccountingApprovalSettings = {
    requireVoucherApproval: boolean;
    autoApproveSystemVouchers: boolean;
    reportsApprovedOnly: boolean;
};

export const DEFAULT_ACCOUNTING_APPROVAL_SETTINGS: AccountingApprovalSettings = {
    requireVoucherApproval: false,
    autoApproveSystemVouchers: true,
    reportsApprovedOnly: false,
};

export type VoucherOrigin = 'manual' | 'system';

/**
 * Status a newly created voucher starts in.
 *
 * Approval off → everything is APPROVED, exactly as before the feature existed.
 * Approval on  → manual entries queue as PENDING; vouchers other modules post
 * automatically only queue when the tenant explicitly turned off
 * `autoApproveSystemVouchers`, because holding those back stalls sales,
 * purchases and payroll behind an approver.
 */
export function initialApprovalStatus(
    settings: AccountingApprovalSettings,
    origin: VoucherOrigin,
): VoucherApprovalStatus {
    if (!settings.requireVoucherApproval) {
        return VoucherApprovalStatus.APPROVED;
    }

    if (origin === 'system' && settings.autoApproveSystemVouchers) {
        return VoucherApprovalStatus.APPROVED;
    }

    return VoucherApprovalStatus.PENDING;
}

/**
 * Whether a report should be restricted to approved vouchers: an explicit
 * per-request `approvedOnly` always wins, otherwise the tenant setting decides.
 */
export function resolveApprovedOnly(
    settings: AccountingApprovalSettings,
    requested?: boolean,
): boolean {
    return requested ?? settings.reportsApprovedOnly;
}

/**
 * Voucher `where` fragment for a report. Empty when unrestricted, so spreading
 * it into an existing filter is a no-op for tenants that never enabled the
 * feature and no index is consulted needlessly.
 */
export function approvalVoucherFilter(approvedOnly: boolean): Prisma.VoucherWhereInput {
    return approvedOnly ? { approval_status: VoucherApprovalStatus.APPROVED } : {};
}

/** Maps a Prisma AccountingSettings row (or null) onto the defaulted shape. */
export function toApprovalSettings(row: {
    require_voucher_approval: boolean;
    auto_approve_system_vouchers: boolean;
    reports_approved_only: boolean;
} | null | undefined): AccountingApprovalSettings {
    if (!row) {
        return DEFAULT_ACCOUNTING_APPROVAL_SETTINGS;
    }

    return {
        requireVoucherApproval: row.require_voucher_approval,
        autoApproveSystemVouchers: row.auto_approve_system_vouchers,
        reportsApprovedOnly: row.reports_approved_only,
    };
}
