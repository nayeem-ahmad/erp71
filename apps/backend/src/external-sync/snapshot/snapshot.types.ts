export const SNAPSHOT_FORMAT_VERSION = 1 as const;

export interface SnapshotCounts {
    products: number;
    customers: number;
    suppliers: number;
    sales: number;
    purchases: number;
    customerPayments: number;
    supplierPayments: number;
    saleReturns: number;
}

export interface SnapshotManifest {
    formatVersion: typeof SNAPSHOT_FORMAT_VERSION;
    tenantId: string;
    connectionId: string;
    provider: string;
    externalOrgId: string;
    windowFrom: string;
    windowTo: string;
    extractedAt: string;
    counts: SnapshotCounts;
    sha256: string;
}

export interface SnapshotDocument {
    formatVersion: typeof SNAPSHOT_FORMAT_VERSION;
    manifest: SnapshotManifest;
    products: unknown[];
    customers: unknown[];
    suppliers: unknown[];
    sales: unknown[];
    purchases: unknown[];
    customerPayments: unknown[];
    supplierPayments: unknown[];
    saleReturns: unknown[];
}
