import { BadRequestException, ConflictException } from '@nestjs/common';
import {
    assertNotAheadOfSeries,
    assertSerialFree,
    canonicalSerial,
    isSerialConflict,
    nextSerialInSeries,
    resolvePaymentDate,
    typedSerial,
} from './credit-payment-entry.util';

describe('credit-payment-entry.util', () => {
    describe('nextSerialInSeries()', () => {
        const txReturning = (next: string | null) => ({
            $queryRaw: jest.fn().mockResolvedValue(next === null ? [] : [{ next }]),
        });

        it('pads the next number to five digits under the prefix', async () => {
            const tx = txReturning('12');
            await expect(nextSerialInSeries(tx, 'CustomerCreditTransaction', 't1', 'CPY-')).resolves.toBe('CPY-00012');
        });

        it('lets the series grow past five digits rather than truncating', async () => {
            const tx = txReturning('123456');
            await expect(nextSerialInSeries(tx, 'SupplierCreditTransaction', 't1', 'SPY-')).resolves.toBe('SPY-123456');
        });

        it('starts at 00001 when nothing came back', async () => {
            const tx = txReturning(null);
            await expect(nextSerialInSeries(tx, 'CustomerCreditTransaction', 't1', 'CWO-')).resolves.toBe('CWO-00001');
        });

        it('reads the whole prefix, numerically, scoped to the tenant and table', async () => {
            const tx = txReturning('1');
            await nextSerialInSeries(tx, 'SupplierCreditTransaction', 'tenant-9', 'SPO-');

            const query = tx.$queryRaw.mock.calls[0][0];
            expect(query.sql).toContain('FROM "SupplierCreditTransaction"');
            expect(query.sql).toContain('::numeric');
            // Anchored, so `SPO-12a` and `XSPO-99` cannot move the series.
            expect(query.values).toEqual(['^SPO\\-([0-9]+)$', 'tenant-9', 'SPO-%']);
        });
    });

    describe('typedSerial()', () => {
        it('trims, and reads blank as "not typed"', () => {
            expect(typedSerial('  MR-0457 ')).toBe('MR-0457');
            expect(typedSerial('   ')).toBeUndefined();
            expect(typedSerial(undefined)).toBeUndefined();
        });
    });

    describe('canonicalSerial()', () => {
        const PREFIXES = ['CPY-', 'CPO-', 'CWO-'];

        it('writes a serial in a series the way the series does, whatever its case or padding', () => {
            expect(canonicalSerial('cpy-12', PREFIXES)).toBe('CPY-00012');
            expect(canonicalSerial('CPY-012', PREFIXES)).toBe('CPY-00012');
            expect(canonicalSerial('Cwo-7', PREFIXES)).toBe('CWO-00007');
        });

        it('leaves a long number long, and anything outside the series as typed', () => {
            expect(canonicalSerial('CPY-123456', PREFIXES)).toBe('CPY-123456');
            expect(canonicalSerial('MR-0457', PREFIXES)).toBe('MR-0457');
            expect(canonicalSerial('CPY-12a', PREFIXES)).toBe('CPY-12a');
            expect(canonicalSerial('XCPY-99', PREFIXES)).toBe('XCPY-99');
        });
    });

    describe('assertNotAheadOfSeries()', () => {
        const PREFIXES = ['CPY-', 'CPO-'];
        const txWithNext = (next: string) => ({ $queryRaw: jest.fn().mockResolvedValue([{ next }]) });

        it('accepts the next number, and a free number below it', async () => {
            await expect(assertNotAheadOfSeries(txWithNext('13'), 'CustomerCreditTransaction', 't1', 'CPY-00013', PREFIXES)).resolves.toBeUndefined();
            await expect(assertNotAheadOfSeries(txWithNext('13'), 'CustomerCreditTransaction', 't1', 'CPY-00009', PREFIXES)).resolves.toBeUndefined();
        });

        it('refuses a number ahead of the series, which would skip every number between for good', async () => {
            await expect(assertNotAheadOfSeries(txWithNext('13'), 'CustomerCreditTransaction', 't1', 'CPY-000125', PREFIXES))
                .rejects.toThrow(new BadRequestException(
                    'CPY-000125 is ahead of the next number in this series, CPY-00013. Use CPY-00013, leave the serial blank, or use a serial of your own outside the series.',
                ));
        });

        it('does not look at a serial outside every series', async () => {
            const tx = txWithNext('13');
            await expect(assertNotAheadOfSeries(tx, 'CustomerCreditTransaction', 't1', 'MR-99999', PREFIXES)).resolves.toBeUndefined();
            expect(tx.$queryRaw).not.toHaveBeenCalled();
        });
    });

    describe('assertSerialFree()', () => {
        it('passes a serial nobody holds', async () => {
            const tx = { customerCreditTransaction: { findFirst: jest.fn().mockResolvedValue(null) } };
            await expect(assertSerialFree(tx, 'customerCreditTransaction', 't1', 'MR-1')).resolves.toBeUndefined();
        });

        it('refuses a serial another row holds, naming it', async () => {
            const tx = { supplierCreditTransaction: { findFirst: jest.fn().mockResolvedValue({ id: 'other' }) } };
            await expect(assertSerialFree(tx, 'supplierCreditTransaction', 't1', 'SPY-00004'))
                .rejects.toThrow(new ConflictException('Serial SPY-00004 is already used by another payment.'));
        });

        it('ignores the row being renamed', async () => {
            const tx = { customerCreditTransaction: { findFirst: jest.fn().mockResolvedValue(null) } };
            await assertSerialFree(tx, 'customerCreditTransaction', 't1', 'MR-1', 'pay-1');
            expect(tx.customerCreditTransaction.findFirst).toHaveBeenCalledWith({
                where: { tenant_id: 't1', payment_number: 'MR-1', id: { not: 'pay-1' } },
                select: { id: true },
            });
        });
    });

    describe('isSerialConflict()', () => {
        it('recognises the payment-number unique index and nothing else', () => {
            expect(isSerialConflict({ code: 'P2002', meta: { target: ['tenant_id', 'payment_number'] } })).toBe(true);
            expect(isSerialConflict({ code: 'P2002', meta: { target: 'CustomerCreditTransaction_tenant_id_payment_number_key' } })).toBe(true);
            expect(isSerialConflict({ code: 'P2002', meta: { target: ['customer_code'] } })).toBe(false);
            expect(isSerialConflict(new Error('boom'))).toBe(false);
        });
    });

    describe('resolvePaymentDate()', () => {
        it('reads an offsetless value as the tenant wall clock', () => {
            expect(resolvePaymentDate('2026-10-01T09:30', 'Asia/Dhaka')).toEqual(new Date('2026-10-01T03:30:00Z'));
        });

        it('is undefined when no date was picked', () => {
            expect(resolvePaymentDate(undefined, 'Asia/Dhaka')).toBeUndefined();
        });

        it('refuses a date in the future and an unreadable one', () => {
            const tomorrow = new Date(Date.now() + 24 * 3600e3).toISOString();
            expect(() => resolvePaymentDate(tomorrow)).toThrow('Payment date cannot be in the future');
            expect(() => resolvePaymentDate('not-a-date')).toThrow(BadRequestException);
        });
    });
});
