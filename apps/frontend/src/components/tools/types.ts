import type {
    BillScanResult,
    BillScanTarget,
    BusinessDocumentType,
    ChequeDirection,
    ChequeStatus,
} from '@erp71/shared-types';

/** A cheque as `GET /cheques` returns it: the amount a number, the date a `YYYY-MM-DD`. */
export interface Cheque {
    id: string;
    direction: ChequeDirection;
    status: ChequeStatus;
    bank_name: string;
    branch_name: string | null;
    account_number: string | null;
    cheque_number: string;
    party_name: string;
    amount: number;
    cheque_date: string;
    account_payee: boolean;
    memo: string | null;
    status_changed_at: string | null;
    created_at: string;
}

export interface ChequeInput {
    direction: ChequeDirection;
    bankName: string;
    branchName?: string;
    accountNumber?: string;
    chequeNumber: string;
    partyName: string;
    amount: number;
    chequeDate: string;
    accountPayee?: boolean;
    memo?: string;
    status?: ChequeStatus;
}

export interface ChequeTally {
    count: number;
    amount: number;
}

export interface ChequeRegister {
    items: Cheque[];
    summary: {
        issuedOpen: ChequeTally;
        receivedOpen: ChequeTally;
        issuedDueSoon: ChequeTally;
        receivedDueSoon: ChequeTally;
        dueSoonDays: number;
    };
}

export interface ChequeListQuery {
    direction?: ChequeDirection;
    status?: ChequeStatus | 'open';
    search?: string;
}

export interface BusinessDocument {
    id: string;
    doc_type: BusinessDocumentType;
    title: string;
    number: string | null;
    issuing_authority: string | null;
    issue_date: string | null;
    expiry_date: string | null;
    remind_days_before: number;
    notes: string | null;
    file_url: string | null;
    file_name: string | null;
    mime_type: string | null;
    file_size: number | null;
    created_at: string;
    updated_at: string;
}

export interface BusinessDocumentInput {
    docType: BusinessDocumentType;
    title: string;
    number?: string | null;
    issuingAuthority?: string | null;
    issueDate?: string | null;
    expiryDate?: string | null;
    remindDaysBefore?: number;
    notes?: string | null;
}

export interface PriceCheckBranch {
    storeId: string;
    storeName: string;
    quantity: number;
    warehouses: Array<{ warehouseId: string; name: string; quantity: number }>;
}

export interface PriceCheckProduct {
    id: string;
    name: string;
    sku: string | null;
    price: number;
    compareAtPrice: number | null;
    unitType: string;
    imageUrl: string | null;
    brand: string | null;
    group: string | null;
    totalQuantity: number;
    branches: PriceCheckBranch[];
}

export interface PriceCheckResult {
    exact: boolean;
    products: PriceCheckProduct[];
}

export type { BillScanResult, BillScanTarget };
