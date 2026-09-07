import { BadRequestException } from '@nestjs/common';

/** Prisma client or transaction client — both expose the model delegates used here. */
type DbLike = any;

/**
 * The subset of customer fields a document-entry screen captures inline. Kept
 * deliberately small: the picker's quick-create form is a stopgap for "this
 * walk-in is a repeat customer", not a replacement for the full customer form.
 */
export interface InlineCustomerDraft {
    name: string;
    phone?: string;
    email?: string;
    address?: string;
}

/** Next code in the auto-generated `CUST-#####` series, read through `tx`. */
async function nextCustomerCode(tx: DbLike, tenantId: string): Promise<string> {
    const last = await tx.customer.findFirst({
        where: { tenant_id: tenantId, customer_code: { startsWith: 'CUST-' } },
        orderBy: { customer_code: 'desc' },
        select: { customer_code: true },
    });

    if (!last) return 'CUST-00001';

    const match = last.customer_code.match(/CUST-(\d+)/);
    const nextNum = match ? parseInt(match[1], 10) + 1 : 1;
    return `CUST-${String(nextNum).padStart(5, '0')}`;
}

/**
 * Turns a quick-create customer draft into a customer id, inside the caller's
 * transaction, so an abandoned or failed document leaves no orphan customer.
 *
 * Unlike suppliers — deduped by name, which is unique for them — customers are
 * unique per tenant on `phone` and may legitimately share a name (two walk-in
 * "Rahim"s are two people). So an existing customer is reused only on a phone
 * match; a draft without a phone always creates a new record.
 */
export async function resolveInlineCustomer(
    tx: DbLike,
    tenantId: string,
    draft: InlineCustomerDraft,
): Promise<string> {
    const name = draft.name?.trim();
    if (!name) {
        throw new BadRequestException('A name is required to create a customer.');
    }

    const phone = draft.phone?.trim() || undefined;

    if (phone) {
        const existing = await tx.customer.findUnique({
            where: { tenant_id_phone: { tenant_id: tenantId, phone } },
            select: { id: true, deleted_at: true },
        });

        // A soft-deleted customer still holds the phone number, so reusing it
        // is the only way through — the unique index would reject a new row.
        if (existing) {
            if (existing.deleted_at) {
                await tx.customer.update({
                    where: { id: existing.id },
                    data: { deleted_at: null, name, email: draft.email, address: draft.address },
                });
            }
            return existing.id;
        }
    }

    // Retry the generated code past the unique collision two concurrent
    // documents can produce, exactly as the customers service does.
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            const created = await tx.customer.create({
                data: {
                    tenant_id: tenantId,
                    customer_code: await nextCustomerCode(tx, tenantId),
                    name,
                    phone,
                    email: draft.email?.trim() || undefined,
                    address: draft.address?.trim() || undefined,
                },
                select: { id: true },
            });
            return created.id;
        } catch (err: any) {
            const target = err?.meta?.target;
            const fields = Array.isArray(target) ? target : [target];
            if (!(err?.code === 'P2002' && fields.includes('customer_code'))) throw err;
        }
    }

    throw new BadRequestException('Could not allocate a unique customer code. Please try again.');
}
