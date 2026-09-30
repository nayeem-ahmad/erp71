import type { DateWindow, PaymentParty } from '../external-sync.mapper';
import type { ProviderClient, ProviderSession } from '../provider-adapter';
import { readSnapshotFile } from './snapshot-file';
import type { SnapshotDocument, SnapshotManifest } from './snapshot.types';

export class SnapshotClient implements ProviderClient {
    constructor(private readonly doc: SnapshotDocument) {}

    static async fromFile(absPath: string): Promise<SnapshotClient> {
        return new SnapshotClient(await readSnapshotFile(absPath));
    }

    getManifest(): SnapshotManifest {
        return this.doc.manifest;
    }

    async login(): Promise<ProviderSession> {
        return {
            organizationId: this.doc.manifest.externalOrgId,
            user: { name: 'snapshot', username: 'snapshot', role: 'SNAPSHOT' },
        };
    }

    async fetchProducts(): Promise<unknown[]> {
        return this.doc.products;
    }

    async fetchCustomers(): Promise<unknown[]> {
        return this.doc.customers;
    }

    async fetchSuppliers(): Promise<unknown[]> {
        return this.doc.suppliers;
    }

    async fetchSaleDocuments(_window: DateWindow): Promise<unknown[]> {
        return this.doc.sales;
    }

    async fetchPurchaseDocuments(_window: DateWindow): Promise<unknown[]> {
        return this.doc.purchases;
    }

    async fetchPayments(_window: DateWindow, party: PaymentParty): Promise<unknown[]> {
        return party === 'CUSTOMER' ? this.doc.customerPayments : this.doc.supplierPayments;
    }

    async fetchSaleReturnDocuments(_window: DateWindow): Promise<unknown[]> {
        return this.doc.saleReturns;
    }
}
