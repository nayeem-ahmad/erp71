function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Turns a stored campaign message into the HTML body of an email.
 *
 * TEXT is the default and the safe one: the message came out of a spreadsheet
 * cell, so a stray `<` or `&` must not be able to break the email or inject
 * markup. HTML is opt-in, for senders who deliberately wrote markup.
 */
export function renderCampaignBody(message: string, format: string | null | undefined): string {
    if (format === 'HTML') return message;
    return escapeHtml(message).replace(/\r\n|\r|\n/g, '<br>');
}
