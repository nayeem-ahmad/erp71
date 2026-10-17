/**
 * The three ways a shop messages its own customers, each with its own prepaid
 * balance on the Tenant row. A send on any of them is metered: no credit, no
 * message.
 */
export const MESSAGING_CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL'] as const;
export type MessagingChannel = (typeof MESSAGING_CHANNELS)[number];

export function isMessagingChannel(value: unknown): value is MessagingChannel {
    return typeof value === 'string' && (MESSAGING_CHANNELS as readonly string[]).includes(value);
}

/** The Tenant column holding a channel's balance. */
export const CHANNEL_BALANCE_COLUMN = {
    SMS: 'sms_credits',
    WHATSAPP: 'whatsapp_credits',
    EMAIL: 'email_credits',
} as const satisfies Record<MessagingChannel, string>;

export type ChannelBalanceColumn = (typeof CHANNEL_BALANCE_COLUMN)[MessagingChannel];

/** How a channel is named to people: in ledger notes, tickets and emails. */
export const CHANNEL_LABEL: Record<MessagingChannel, string> = {
    SMS: 'SMS',
    WHATSAPP: 'WhatsApp',
    EMAIL: 'Email',
};

/**
 * The BillingEvent type a paid top-up on each channel writes. Each one posts to
 * its own revenue account in the platform's books (see
 * platform-accounting.constants.ts) and counts as a payment on the tenant's
 * billing ledger (ledger-balance.util.ts).
 */
export const CHANNEL_SALE_EVENT_TYPE = {
    SMS: 'sms_credit_sale_payment',
    WHATSAPP: 'whatsapp_credit_sale_payment',
    EMAIL: 'email_credit_sale_payment',
} as const satisfies Record<MessagingChannel, string>;

/** Thrown by a metered send that the tenant's balance cannot cover. */
export class InsufficientMessagingCreditsError extends Error {
    constructor(readonly channel: MessagingChannel) {
        super(`Insufficient ${CHANNEL_LABEL[channel]} credits`);
        this.name = 'InsufficientMessagingCreditsError';
    }
}
