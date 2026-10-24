import { BadRequestException } from '@nestjs/common';
import { assertSaleCustomerBranch } from './sale-customer-branch.util';

function makeTx({
    settings = null as { branch_customers_only?: boolean } | null,
    customer = null as { name: string; store_id: string; store: { name: string } } | null,
} = {}) {
    return {
        salesSettings: { findUnique: jest.fn().mockResolvedValue(settings) },
        customer: { findFirst: jest.fn().mockResolvedValue(customer) },
    };
}

const MAIN_CUSTOMER = { name: 'Rahim', store_id: 'store-main', store: { name: 'Main' } };

describe('assertSaleCustomerBranch', () => {
    it("refuses another branch's customer, naming them and their branch", async () => {
        const tx = makeTx({ customer: MAIN_CUSTOMER });

        const check = assertSaleCustomerBranch(tx, 'tenant-1', 'cust-1', 'store-mirpur');

        await expect(check).rejects.toThrow(BadRequestException);
        await expect(check).rejects.toThrow(
            'Rahim is a customer of Main. Pick a customer of this branch, or ask an owner to move them here.',
        );
    });

    it("accepts the branch's own customer", async () => {
        const tx = makeTx({ customer: MAIN_CUSTOMER });

        await expect(assertSaleCustomerBranch(tx, 'tenant-1', 'cust-1', 'store-main')).resolves.toBeUndefined();
    });

    it('looks the customer up within the tenant only', async () => {
        const tx = makeTx({ customer: MAIN_CUSTOMER });

        await assertSaleCustomerBranch(tx, 'tenant-1', 'cust-1', 'store-main');

        expect(tx.customer.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'cust-1', tenant_id: 'tenant-1' },
        }));
    });

    it('is on for a tenant that has never saved its sales settings', async () => {
        const tx = makeTx({ settings: null, customer: MAIN_CUSTOMER });

        await expect(assertSaleCustomerBranch(tx, 'tenant-1', 'cust-1', 'store-mirpur'))
            .rejects.toThrow(BadRequestException);
    });

    it('lets any customer through once the tenant turns the rule off', async () => {
        const tx = makeTx({ settings: { branch_customers_only: false }, customer: MAIN_CUSTOMER });

        await expect(assertSaleCustomerBranch(tx, 'tenant-1', 'cust-1', 'store-mirpur')).resolves.toBeUndefined();
        expect(tx.customer.findFirst).not.toHaveBeenCalled();
    });

    it('leaves an unknown customer to the checks that already report it', async () => {
        const tx = makeTx({ customer: null });

        await expect(assertSaleCustomerBranch(tx, 'tenant-1', 'cust-x', 'store-mirpur')).resolves.toBeUndefined();
    });

    it('has nothing to check on a walk-in sale', async () => {
        const tx = makeTx({ customer: MAIN_CUSTOMER });

        await expect(assertSaleCustomerBranch(tx, 'tenant-1', undefined, 'store-mirpur')).resolves.toBeUndefined();
        await expect(assertSaleCustomerBranch(tx, 'tenant-1', null, 'store-mirpur')).resolves.toBeUndefined();
        expect(tx.salesSettings.findUnique).not.toHaveBeenCalled();
    });
});
