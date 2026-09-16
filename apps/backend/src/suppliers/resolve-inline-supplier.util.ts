import { BadRequestException } from '@nestjs/common';

/** Prisma client or transaction client — both expose the model delegates used here. */
type DbLike = any;

/**
 * The subset of supplier fields a document-entry screen captures inline. Kept
 * deliberately small: the picker's quick-create form is a stopgap for "this
 * delivery came from someone new", not a replacement for the supplier form.
 */
export interface InlineSupplierDraft {
    name: string;
    phone?: string;
    email?: string;
    address?: string;
}

/** The submitted details, blank strings normalised away so they never overwrite with "". */
function detailsOf(draft: InlineSupplierDraft) {
    return {
        phone: draft.phone?.trim() || undefined,
        email: draft.email?.trim() || undefined,
        address: draft.address?.trim() || undefined,
    };
}

/**
 * Turns a quick-create supplier draft into a supplier id, inside the caller's
 * transaction, so an abandoned or failed document leaves no orphan supplier.
 *
 * Suppliers are unique per tenant on `name`, so an existing one is reused
 * rather than duplicated — two bills from "Fresh Farms" are the same supplier.
 *
 * `@@unique([tenant_id, name])` spans soft-deleted rows, so a deleted supplier
 * goes on holding its name: inserting beside it is impossible, and silently
 * pointing the document at the tombstone leaves a bill whose supplier no picker
 * and no supplier list will ever show. Reviving it is the only way through.
 */
export async function resolveInlineSupplier(
    tx: DbLike,
    tenantId: string,
    draft: InlineSupplierDraft,
): Promise<string> {
    const name = draft.name?.trim();
    if (!name) {
        throw new BadRequestException('A name is required to create a supplier.');
    }

    const existing = await tx.supplier.findUnique({
        where: { tenant_id_name: { tenant_id: tenantId, name } },
        select: { id: true, deleted_at: true },
    });

    if (existing) {
        if (existing.deleted_at) {
            await tx.supplier.update({
                where: { id: existing.id },
                data: { deleted_at: null, ...detailsOf(draft) },
            });
        }
        return existing.id;
    }

    const created = await tx.supplier.create({
        data: { tenant_id: tenantId, name, ...detailsOf(draft) },
        select: { id: true },
    });
    return created.id;
}
