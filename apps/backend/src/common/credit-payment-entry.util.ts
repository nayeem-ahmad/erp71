import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DEFAULT_TENANT_TIMEZONE, parseTenantDateTime } from './tenant-time.util';

/**
 * Shared by customer and supplier payment entry: both let the operator pick
 * the payment's date and edit its serial, and the two must not drift apart.
 */

/**
 * How far past the server's clock a payment date may sit. The picker works in
 * whole minutes and the browser's clock drifts, so "now" can arrive a little
 * ahead; anything further out is a typo, not a payment.
 */
const PAYMENT_DATE_SKEW_MS = 5 * 60 * 1000;

/**
 * A payment's date as the operator picked it, or undefined when they did not
 * pick one. Backdating is the point — money taken yesterday and entered
 * today — but a date in the future is refused. An offsetless value is read as
 * the tenant's wall clock.
 */
export function resolvePaymentDate(value: string | undefined, timeZone?: string): Date | undefined {
    if (!value) return undefined;
    const date = parseTenantDateTime(value, timeZone ?? DEFAULT_TENANT_TIMEZONE);
    if (!date) throw new BadRequestException('Invalid payment date');
    if (date.getTime() > Date.now() + PAYMENT_DATE_SKEW_MS) {
        throw new BadRequestException('Payment date cannot be in the future');
    }
    return date;
}

/** A serial the operator typed, trimmed; undefined when left blank. */
export function typedSerial(value: string | null | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

type CreditTable = 'CustomerCreditTransaction' | 'SupplierCreditTransaction';
type CreditModel = 'customerCreditTransaction' | 'supplierCreditTransaction';

/**
 * The next number in a `PREFIX#####` series: one past the highest number any
 * row of the table carries under that prefix.
 *
 * Read numerically rather than as the string-highest row, because serials are
 * editable: a hand-typed `CPY-9` sorts above `CPY-00011` as text and would
 * send every later payment back onto a number already taken. Not filtered by
 * type either — an edit can turn a receipt into a payout without changing its
 * number, and the series still has to step over it.
 */
export async function nextSerialInSeries(
    tx: any,
    table: CreditTable,
    tenantId: string,
    prefix: string,
): Promise<string> {
    const pattern = `^${prefix.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}([0-9]+)$`;
    const rows: Array<{ next: string }> = await tx.$queryRaw(Prisma.sql`
        SELECT (COALESCE(MAX(substring(payment_number from ${pattern})::numeric), 0) + 1)::text AS next
        FROM ${Prisma.raw(`"${table}"`)}
        WHERE tenant_id = ${tenantId} AND payment_number LIKE ${`${prefix}%`}
    `);
    const next = rows[0]?.next ?? '1';
    return `${prefix}${next.padStart(5, '0')}`;
}

/**
 * Refuses a typed serial another row of the same table already carries.
 * Checked up front so the operator gets a plain message; the unique index
 * still settles a race (see `isSerialConflict`).
 */
export async function assertSerialFree(
    tx: any,
    model: CreditModel,
    tenantId: string,
    serial: string,
    exceptId?: string,
): Promise<void> {
    const taken = await tx[model].findFirst({
        where: {
            tenant_id: tenantId,
            payment_number: serial,
            ...(exceptId ? { id: { not: exceptId } } : {}),
        },
        select: { id: true },
    });
    if (taken) throw serialTaken(serial);
}

/** Whether a write failed on `@@unique([tenant_id, payment_number])`. */
export function isSerialConflict(err: any): boolean {
    const target = err?.meta?.target;
    const fields = Array.isArray(target) ? target : [target];
    return err?.code === 'P2002' && fields.some((field) => String(field).includes('payment_number'));
}

export function serialTaken(serial: string): ConflictException {
    return new ConflictException(`Serial ${serial} is already used by another payment.`);
}
