/**
 * Turns a stored audit row into something a shopkeeper can read.
 *
 * The table stores what the *server* needed to record the event, not what a
 * person needs to understand it: `action` is a dotted route derivation
 * (`sales.payments.create`) or a hand-written constant (`USER_LOGIN`),
 * `entity_id` is a UUID, and `payload` is the redacted request body with
 * whatever key names the DTO happened to use. None of that is readable, and
 * the ids in particular are internal plumbing that a tenant user can do
 * nothing with.
 *
 * Two rules drive everything here:
 *
 *  - **Every row gets a description.** An audit trail whose value is being
 *    complete cannot silently drop rows it has no phrase for, so an unknown
 *    action falls back to `humanizeAction`, which reads the action name
 *    mechanically. A module added next year is legible the day it ships,
 *    without anyone editing this file.
 *  - **Ids never surface.** `looksLikeId` filters UUIDs, cuids and long opaque
 *    strings out of the detail list, and no phrase interpolates `entity_id`.
 */

export interface AuditRowLike {
    action: string;
    entity: string;
    entity_id?: string | null;
    payload?: Record<string, unknown> | null;
    user?: { email?: string; name?: string | null } | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPAQUE_ID_RE = /^[A-Za-z0-9_-]{16,}$/;

/**
 * True for values that are database plumbing rather than information.
 *
 * Deliberately conservative: a long human string ("Dhaka wholesale market
 * branch") contains spaces and so is kept, while `c1x9k2...` is not. Numbers
 * are never ids here — a bare `12` is far more likely a quantity than a key.
 */
export function looksLikeId(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    if (UUID_RE.test(value)) return true;
    if (/\s/.test(value)) return false;
    return OPAQUE_ID_RE.test(value);
}

/** Keys that are internal bookkeeping and never worth showing to anyone. */
const HIDDEN_KEYS = new Set([
    'id',
    'uuid',
    '_id',
    'tenant_id',
    'tenantid',
    'user_id',
    'userid',
    'store_id',
    'storeid',
    'created_at',
    'updated_at',
    'deleted_at',
    '_scope',
    '_truncated',
    '_bytes',
]);

/** `sale_items` -> `Sale items`, `customerName` -> `Customer name`. */
export function humanizeKey(key: string): string {
    const spaced = key
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .trim();
    if (!spaced) return key;
    return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * Read an action name mechanically when no phrase is written for it.
 *
 * Handles both stored conventions: the interceptor's dotted route derivation
 * (`purchase-orders.items.update`) and hand-written screaming constants
 * (`PASSWORD_RESET_REQUESTED`). The trailing segment of a dotted action is a
 * verb, so it leads the sentence and the rest becomes the object.
 */
export function humanizeAction(action: string): string {
    if (!action) return 'Performed an action';

    // `USER_LOGIN` / `SMS_CREDITS_PURCHASED` — no dots, all caps.
    if (!action.includes('.') && action === action.toUpperCase()) {
        const words = action.toLowerCase().replace(/_+/g, ' ').trim();
        return words ? words.charAt(0).toUpperCase() + words.slice(1) : action;
    }

    const parts = action.split('.').filter(Boolean);
    if (!parts.length) return 'Performed an action';

    const VERBS: Record<string, string> = {
        create: 'Created',
        update: 'Updated',
        delete: 'Deleted',
        approve: 'Approved',
        reject: 'Rejected',
        grant: 'Granted',
        revoke: 'Revoked',
        suspend: 'Suspended',
        record: 'Recorded',
        sell: 'Sold',
        promote: 'Promoted',
        demote: 'Demoted',
    };

    const last = parts[parts.length - 1].toLowerCase();
    const verb = VERBS[last];
    const rest = (verb ? parts.slice(0, -1) : parts)
        .map((part) => part.replace(/[_-]+/g, ' '))
        .join(' ')
        .trim();

    if (!verb) {
        // No recognisable verb: read the whole thing as a phrase rather than
        // inventing one, e.g. `tenant.impersonate` -> "Tenant impersonate".
        const phrase = parts.map((part) => part.replace(/[_-]+/g, ' ')).join(' ');
        return phrase.charAt(0).toUpperCase() + phrase.slice(1);
    }

    return rest ? `${verb} ${rest}` : verb;
}

/**
 * Phrases for the actions people actually see, keyed by exact action name.
 *
 * Only actions whose mechanical reading would be wrong or clumsy need an entry
 * — `sales.create` reads fine as "Created sales" but "Recorded a sale" is what
 * a shopkeeper would say. Everything else is left to `humanizeAction`.
 */
const ACTION_PHRASES: Record<string, string> = {
    // Account and access — the security questions owners actually ask.
    USER_LOGIN: 'Signed in',
    USER_LOGOUT: 'Signed out',
    USER_SIGNUP: 'Created their account',
    LOGIN_FAILED: 'Failed sign-in attempt',
    PASSWORD_CHANGED: 'Changed their password',
    PASSWORD_RESET_REQUESTED: 'Requested a password reset',
    PASSWORD_RESET_COMPLETED: 'Completed a password reset',
    STOREFRONT_CUSTOMER_LOGIN: 'Customer signed in to the online shop',
    STOREFRONT_CUSTOMER_LOGOUT: 'Customer signed out of the online shop',
    STOREFRONT_CUSTOMER_SIGNUP: 'Customer registered on the online shop',
    STOREFRONT_LOGIN_FAILED: 'Failed online-shop sign-in attempt',

    // Selling.
    'sales.create': 'Recorded a sale',
    'sales.update': 'Edited a sale',
    'sales.delete': 'Deleted a sale',
    'sales.payments.create': 'Recorded a payment against a sale',
    'sales-returns.create': 'Recorded a sales return',
    'sales-orders.create': 'Created a sales order',
    'sales-quotations.create': 'Created a quotation',

    // Buying and stock.
    'purchases.create': 'Recorded a purchase',
    'purchases.update': 'Edited a purchase',
    'purchase-orders.create': 'Created a purchase order',
    'products.create': 'Added a product',
    'products.update': 'Edited a product',
    'products.delete': 'Deleted a product',
    'stock-takes.create': 'Started a stock take',
    'warehouse-transfers.create': 'Transferred stock between stores',

    // People and money.
    'customers.create': 'Added a customer',
    'customers.update': 'Edited a customer',
    'suppliers.create': 'Added a supplier',
    'expenses.create': 'Recorded an expense',

    // Team and permissions — the other thing an owner audits.
    'team.invitation_sent': 'Invited someone to the team',
    'team.invitation_revoked': 'Revoked a team invitation',
    'team.member_removed': 'Removed a team member',
    'team.permissions_updated': 'Changed a member’s permissions',
    'team.role_created': 'Created a role',
    'team.role_updated': 'Edited a role',
    'team.role_deleted': 'Deleted a role',
    'team.role_permissions_synced': 'Updated a role’s permissions',
    'team.store_access_granted': 'Gave a member access to a store',
    'team.store_access_revoked': 'Removed a member’s access to a store',

    // Accounting.
    'accounting.voucher.create': 'Created a voucher',
    'accounting.voucher.update': 'Edited a voucher',
    'accounting.voucher.delete': 'Deleted a voucher',
    'accounting.voucher.approve': 'Approved a voucher',
    'accounting.voucher.reject': 'Rejected a voucher',
    'accounting.settings.update': 'Changed accounting settings',
    'accounting.posting_rule.update': 'Changed an accounting posting rule',

    // Platform-admin actions. A tenant user never sees these rows, but the
    // platform audit page reads through the same formatter.
    'tenant.suspend': 'Suspended a workspace',
    'tenant.delete': 'Deleted a workspace',
    'tenant.impersonate': 'Signed in as a workspace',
    'tenant.admin_create': 'Created a workspace',
    'tenant.payment.record': 'Recorded a payment',
    'tenant.refund.record': 'Recorded a refund',
    'tenant.fee.record': 'Recorded a fee',
    'tenant.addon.grant': 'Granted an add-on module',
    'tenant.addon.revoke': 'Revoked an add-on module',
    'tenant.sms_credits.sell': 'Sold SMS credits',
    'tenant.ai_credits.sell': 'Sold AI credits',
    'tenant.subscription.discount': 'Applied a subscription discount',
    'user.promote': 'Made someone a platform admin',
    'user.demote': 'Removed someone’s platform admin access',
    'user.platform.create': 'Created a platform user',
    'user.platform.update': 'Edited a platform user',
    'user.platform.delete': 'Deleted a platform user',
    'user.platform.reset_password': 'Reset a platform user’s password',
    'user.platform.reset_email': 'Changed a platform user’s email',
    'deploy.triggered': 'Triggered a deployment',
    SMS_CREDITS_PURCHASED: 'Purchased SMS credits',
};

/**
 * Payload keys that name the thing acted on, in the order we would rather
 * quote them. A sale is far better identified by its invoice number than by
 * its id, and every one of these is a value a person recognises.
 */
const SUBJECT_KEYS = [
    'invoice_number',
    'voucher_number',
    'sale_number',
    'order_number',
    'reference',
    'code',
    'email',
    'name',
    'title',
    'product_name',
    'customer_name',
    'supplier_name',
];

function findSubject(payload?: Record<string, unknown> | null): string | undefined {
    if (!payload) return undefined;
    for (const key of SUBJECT_KEYS) {
        const value = payload[key];
        if (typeof value === 'string' && value.trim() && !looksLikeId(value)) {
            return value.trim();
        }
        if (typeof value === 'number') return String(value);
    }
    return undefined;
}

export interface DescribeOptions {
    /**
     * Formats a money amount. Injected rather than imported so this module
     * stays free of locale wiring and is trivially testable.
     */
    formatAmount?: (value: number) => string;
}

/**
 * The one-line, plain-English sentence for a row.
 *
 * Appends the subject and amount when the payload carries them, so the common
 * case reads "Recorded a sale of ৳1,250" rather than the bare verb.
 */
export function describeAuditRow(row: AuditRowLike, options: DescribeOptions = {}): string {
    const base = ACTION_PHRASES[row.action] ?? humanizeAction(row.action);

    const payload = row.payload ?? undefined;
    const amountRaw = payload?.amount ?? payload?.total ?? payload?.grand_total;
    const amount =
        typeof amountRaw === 'number'
            ? amountRaw
            : typeof amountRaw === 'string' && amountRaw.trim() && !Number.isNaN(Number(amountRaw))
              ? Number(amountRaw)
              : undefined;

    const subject = findSubject(payload);

    let text = base;
    if (subject) text += ` — ${subject}`;
    if (amount !== undefined && options.formatAmount) {
        text += ` (${options.formatAmount(amount)})`;
    }
    return text;
}

export interface AuditDetail {
    label: string;
    value: string;
}

/**
 * The readable key/value pairs behind a row, for the expanded view.
 *
 * Everything internal is dropped rather than rendered as noise: ids, hidden
 * bookkeeping keys, nulls, and nested objects/arrays whose shape is a DTO
 * detail rather than information. What survives is the handful of scalars a
 * person can actually act on.
 */
export function auditDetails(
    row: AuditRowLike,
    options: DescribeOptions = {},
): AuditDetail[] {
    const payload = row.payload;
    if (!payload || typeof payload !== 'object') return [];

    const details: AuditDetail[] = [];
    for (const [key, value] of Object.entries(payload)) {
        if (HIDDEN_KEYS.has(key.toLowerCase())) continue;
        if (value === null || value === undefined || value === '') continue;
        if (looksLikeId(value)) continue;

        // A nested object or array is DTO shape, not information — summarise
        // a list by its length and drop the rest.
        if (Array.isArray(value)) {
            if (value.length) {
                details.push({ label: humanizeKey(key), value: `${value.length}` });
            }
            continue;
        }
        if (typeof value === 'object') continue;

        let rendered: string;
        if (typeof value === 'boolean') {
            rendered = value ? 'Yes' : 'No';
        } else if (
            typeof value === 'number'
            && options.formatAmount
            && /amount|total|price|paid|due/i.test(key)
        ) {
            rendered = options.formatAmount(value);
        } else {
            rendered = String(value);
        }

        details.push({ label: humanizeKey(key), value: rendered });
    }

    return details;
}
