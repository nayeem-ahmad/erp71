/**
 * Shapes and labels for the prepaid messaging balances — SMS, WhatsApp and
 * email — shared by the shop's credits screen and the admin top-up queue.
 */

export const MESSAGING_CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL'] as const;
export type MessagingChannel = (typeof MESSAGING_CHANNELS)[number];

export const CHANNEL_LABEL: Record<MessagingChannel, string> = {
    SMS: 'SMS',
    WHATSAPP: 'WhatsApp',
    EMAIL: 'Email',
};

/** What one credit buys on each channel, for the balance cards. */
export const CHANNEL_UNIT_HINT: Record<MessagingChannel, string> = {
    SMS: '1 credit per 160-character SMS (70 for Bangla)',
    WHATSAPP: '1 credit per WhatsApp message',
    EMAIL: '1 credit per email recipient',
};

export type MessagingCreditPackage = {
    id: string;
    channel: MessagingChannel;
    name: string;
    credits: number;
    price: number;
    currency: string;
    is_active: boolean;
    sort_order: number;
};

export type MessagingCreditTransaction = {
    id: string;
    channel: MessagingChannel;
    type: 'PURCHASE' | 'USAGE' | 'ADJUSTMENT' | 'REFUND';
    credits: number;
    balance_after: number;
    description?: string | null;
    recipient?: string | null;
    reference?: string | null;
    created_at: string;
};

export type CreditTopupStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type CreditTopupRequestRecord = {
    id: string;
    channel: MessagingChannel;
    package_id: string | null;
    package_name: string;
    credits: number;
    amount: number;
    currency: string;
    method: string;
    transaction_id: string;
    sender_number: string | null;
    note: string | null;
    status: CreditTopupStatus;
    ticket_number: number | null;
    review_note: string | null;
    reviewed_at: string | null;
    credits_granted: number | null;
    amount_received: number | null;
    created_at: string;
};

export type AdminCreditTopupRequest = CreditTopupRequestRecord & {
    tenant: { id: string; name: string };
    submitted_by: { name: string | null; email: string; mobile: string | null } | null;
    reviewed_by: { name: string | null; email: string } | null;
};

export type MessagingCreditSummary = {
    tenant: { id: string; name: string };
    role: string;
    can_manage_billing: boolean;
    sms_enabled: boolean;
    balances: Record<MessagingChannel, number>;
    low_balance: Record<MessagingChannel, boolean>;
    packages: MessagingCreditPackage[];
    transactions: MessagingCreditTransaction[];
    requests: CreditTopupRequestRecord[];
    payment: {
        method: 'BKASH';
        account_type: 'personal';
        bkash_number: string | null;
        instructions: string | null;
    };
};

/** A bKash TrxID as the backend will accept it: letters and digits, 6–32 long. */
export function isPlausibleTrxId(value: string): boolean {
    return /^[A-Za-z0-9]{6,32}$/.test(value.replace(/\s+/g, ''));
}

/** A wallet number as the backend will accept it. */
export function isPlausibleWalletNumber(value: string): boolean {
    return /^\+?[0-9][0-9\s-]{7,18}$/.test(value.trim());
}
