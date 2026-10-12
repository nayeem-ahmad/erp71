import { StorePermission } from '@erp71/shared-types';

/**
 * The entries the phone's inbox gathers, each still decided by its own
 * module's approve/reject path. Shaped so the approval engine planned in
 * docs/approval-workflow-plan.md can replace the providers behind it without
 * the phone noticing.
 *
 * Left out on purpose: payroll runs (a DRAFT run is work in progress, not a
 * request someone submitted, and has no reject), overtime and warranty claims
 * (their review endpoints have no permission guard to mirror yet), fund
 * transfers (no approval state at all), and CRM activity approvals (high
 * volume, low stakes — they stay a web queue).
 */
export const APPROVAL_KINDS = [
    'EXPENSE_CLAIM',
    'LEAVE_REQUEST',
    'PRODUCT_DEMAND',
    'WAREHOUSE_TRANSFER',
    'VOUCHER',
] as const;

export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

/** The permission each kind's own approve endpoint requires. */
export const APPROVAL_PERMISSION: Record<ApprovalKind, StorePermission> = {
    EXPENSE_CLAIM: StorePermission.MANAGE_HR,
    LEAVE_REQUEST: StorePermission.MANAGE_HR,
    PRODUCT_DEMAND: StorePermission.APPROVE_PRODUCT_DEMAND,
    WAREHOUSE_TRANSFER: StorePermission.APPROVE_GOODS_TRANSFER,
    VOUCHER: StorePermission.APPROVE_VOUCHER,
};

/**
 * Everything the kind's approve endpoint requires (all of them, as
 * `@RequireStorePermission` reads a list). Vouchers need the ledger as well.
 */
export const APPROVAL_REQUIRES: Record<ApprovalKind, StorePermission[]> = {
    EXPENSE_CLAIM: [StorePermission.MANAGE_HR],
    LEAVE_REQUEST: [StorePermission.MANAGE_HR],
    PRODUCT_DEMAND: [StorePermission.APPROVE_PRODUCT_DEMAND],
    WAREHOUSE_TRANSFER: [StorePermission.APPROVE_GOODS_TRANSFER],
    VOUCHER: [StorePermission.VIEW_LEDGER, StorePermission.APPROVE_VOUCHER],
};

export const APPROVAL_LABEL: Record<ApprovalKind, string> = {
    EXPENSE_CLAIM: 'Expense claim',
    LEAVE_REQUEST: 'Leave request',
    PRODUCT_DEMAND: 'Product demand',
    WAREHOUSE_TRANSFER: 'Stock transfer',
    VOUCHER: 'Voucher',
};

/**
 * Where each kind lives on the web, for the bell's link. Expense claims have
 * no web screen yet (TODO.md), so theirs opens HR; the phone ignores these and
 * opens its Approvals tab for every approval notification.
 */
export const APPROVAL_WEB_LINK: Record<ApprovalKind, string> = {
    EXPENSE_CLAIM: '/hr',
    LEAVE_REQUEST: '/hr/leaves',
    PRODUCT_DEMAND: '/inventory/demands',
    WAREHOUSE_TRANSFER: '/inventory/transfers',
    VOUCHER: '/accounting/vouchers',
};

/** One entry waiting for a decision, as the phone shows it. */
export type ApprovalItem = {
    kind: ApprovalKind;
    id: string;
    title: string;
    /** Taka, when the entry is about money; null for leave and stock. */
    amount: number | null;
    requested_by: string | null;
    requested_at: Date;
    branch: string | null;
    /** What an approver needs to decide without opening anything else. */
    details: { label: string; value: string }[];
};
