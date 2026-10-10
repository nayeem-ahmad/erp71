import type { BreadcrumbItem } from '@/lib/page-breadcrumbs';
import type { MessageDictionary } from '@/lib/localization/messages';
import type { DeepPartial, PrintHeaderConfig } from '@/lib/print/types';
import type { PaymentDiscountLabels } from '../PaymentDiscountField';

/**
 * Which way the money moved, in the API's own terms: `receive` is money into
 * the shop and `pay` is money out, for customers and suppliers alike. A
 * customer receipt and a supplier refund are both `receive`.
 */
export type MoneyFlow = 'receive' | 'pay';

export interface PaymentParty {
    id: string;
    name: string;
    phone?: string | null;
    customer_code?: string | null;
}

/** A row of the party picker. `due_balance` is what the party owes (customer) or is owed (supplier). */
export interface PartyOption extends PaymentParty {
    due_balance?: number | string;
    [key: string]: unknown;
}

/** A customer or supplier payment as the list, record and update endpoints return it. */
export interface PartyPayment {
    id: string;
    /** PAYMENT | PAYOUT — what they mean depends on the party; use the adapter's `directionOf`. */
    type?: string;
    payment_number?: string | null;
    amount: string | number;
    /** Settled with the money; only ever on the primary direction. */
    discount_amount?: string | number;
    balance_after?: string | number;
    notes?: string | null;
    created_at: string;
    creator?: { id: string; name: string } | null;
    voucher_id?: string | null;
    accounting_voucher_number?: string | null;
    /** What record/update return in place of `accounting_voucher_number`. */
    voucher_number?: string | null;
    discount_voucher_number?: string | null;
    payment_method_id?: string | null;
    payment_method_name?: string | null;
    /** Supplier payments only: settled but not yet matched to a bill. */
    unapplied_amount?: number;
    customer?: PaymentParty | null;
    supplier?: PaymentParty | null;
}

export interface OpenBill {
    id: string;
    purchase_number: string;
    total_amount: number;
    paid_amount: number;
    balance_due: number;
    payment_status: string;
    created_at?: string;
}

export interface BillAllocationInput {
    purchaseId: string;
    amount: number;
}

export interface RecordPaymentInput {
    amount: number;
    discount?: number;
    direction: MoneyFlow;
    notes?: string;
    date?: string;
    paymentNumber?: string;
    paymentMethodId?: string;
    allocations?: BillAllocationInput[];
}

export interface UpdatePaymentInput {
    amount: number;
    discount: number;
    direction: MoneyFlow;
    notes?: string;
    date?: string;
    paymentNumber?: string;
    paymentMethodId?: string;
}

/** Every string the workspace shows, already resolved for one party. */
export interface PartyPaymentsLabels {
    title: string;
    subtitle: string;
    listTitle: string;
    newPayment: string;
    editPayment: string;
    viewPayment: string;
    duplicatePayment: string;
    duplicateNotice: string;
    /** The party, as a column and a field caption: "Customer" / "Supplier". */
    party: string;
    filterParty: string;
    allParties: string;
    pickParty: string;
    noParties: string;
    loadingParties: string;
    partiesLoadFailed: string;
    retry: string;
    searchPayments: string;
    noPayments: string;
    loading: string;
    loadFailed: string;
    saveFailed: string;
    invalidAmount: string;
    requiredFields: string;
    direction: string;
    receive: string;
    pay: string;
    dueBalance: string;
    advanceBalance: string;
    paymentDate: string;
    dateInFuture: string;
    serialTaken: string;
    serialAhead: string;
    amount: string;
    amountPlaceholder: string;
    notes: string;
    notesPlaceholder: string;
    paymentUpdated: string;
    paymentDeleted: string;
    deleteConfirm: string;
    deleteFailed: string;
    printReceipt: string;
    printVoucher: string;
    voucherNumber: string;
    balanceAfter: string;
    kpiIn: string;
    kpiOut: string;
    kpiNet: string;
    discount: PaymentDiscountLabels & { amountOrDiscount: string; voucher: string };
    columns: { serial: string; dateTime: string; recordedBy: string; amount: string; notes: string };
    /** Supplier only: matching payments to bills. */
    allocation?: {
        noOpenBills: string;
        exceedsAmount: string;
        unappliedAmount: string;
        allocateModalTitle: string;
        allocateSubmit: string;
        allocateSuccess: string;
        allocateFailed: string;
    };
}

export interface PrintContext {
    businessName?: string;
    headerConfig?: DeepPartial<PrintHeaderConfig>;
    locale: string;
    t: MessageDictionary;
}

/**
 * Everything that differs between the customer and the supplier screen. The
 * workspace is the same page for both; this is what it is told about the party.
 */
export interface PartyPaymentsAdapter {
    kind: 'customer' | 'supplier';
    tableId: string;
    /** The search param that preselects a party: `?customerId=` / `?supplierId=`. */
    partyParam: string;
    /** The usual direction: a new payment starts here, and only it takes a discount or bills. */
    primary: MoneyFlow;
    labels: (t: MessageDictionary) => PartyPaymentsLabels;
    breadcrumbs: (t: MessageDictionary, title: string) => BreadcrumbItem[];
    directionOf: (payment: PartyPayment) => MoneyFlow;
    partyOf: (payment: PartyPayment) => PaymentParty | null;
    ledgerHref: (partyId: string) => string;
    /** Server-side party lists take several requests on a big shop; loaded once, on their own. */
    listParties: () => Promise<PartyOption[]>;
    /** `storeId`: the page's branch filter (a branch id or `all`). */
    listPayments: (query: { from?: string; to?: string; partyId?: string; storeId?: string }) => Promise<PartyPayment[]>;
    nextNumber: (direction: MoneyFlow) => Promise<{ payment_number?: string } | null | undefined>;
    record: (partyId: string, input: RecordPaymentInput) => Promise<PartyPayment>;
    update: (paymentId: string, input: UpdatePaymentInput) => Promise<PartyPayment>;
    remove: (paymentId: string) => Promise<unknown>;
    /** Supplier only: the party's unpaid bills, oldest first. */
    openBills?: (partyId: string) => Promise<OpenBill[]>;
    /** Supplier only: match an existing payment's unapplied amount to bills. */
    allocate?: (paymentId: string, allocations: BillAllocationInput[]) => Promise<unknown>;
    print: (payment: PartyPayment, context: PrintContext) => void;
}
