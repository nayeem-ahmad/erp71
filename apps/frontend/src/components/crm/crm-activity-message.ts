/**
 * How a logged CRM activity's text is shown on the timeline.
 *
 * Stored summaries and notes are free text: WhatsApp and email bodies keep
 * their line breaks, some rows land with escaped `\n` or leftover HTML from a
 * paste, and completing a planned activity often leaves the original draft in
 * `notes` beside the same words in `summary`. History should read as the
 * message that was sent, once, with the line breaks the person typed.
 */

export function formatActivityMessage(text: string | null | undefined): string {
    if (!text) return '';
    let value = text.replace(/\r\n?/g, '\n');
    // Double-encoded breaks from JSON pastes and some upstream stores.
    value = value.replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\t/g, '\t');
    value = value.replace(/<br\s*\/?>/gi, '\n');
    value = value.replace(/<\/p>\s*<p\b[^>]*>/gi, '\n\n');
    value = value.replace(/<\/?p\b[^>]*>/gi, '\n');
    value = value.replace(/<\/div>/gi, '\n');
    value = value.replace(/<[^>]+>/g, '');
    value = value
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'");
    value = value.replace(/\n{3,}/g, '\n\n');
    return value.trim();
}

export type ActivityHistoryParts = {
    /** Short plan title, only when it is distinct from the body. */
    title: string | null;
    /** The message / what happened, with line breaks restored. */
    body: string | null;
    /** Extra notes that are not already in the body. */
    notes: string | null;
    outcome: string | null;
};

function compact(text: string): string {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** True when `candidate` adds nothing beyond `alreadyShown`. */
function isRedundant(candidate: string, alreadyShown: string): boolean {
    if (!candidate) return true;
    if (!alreadyShown) return false;
    const a = compact(candidate);
    const b = compact(alreadyShown);
    return a === b || b.includes(a);
}

export function activityHistoryParts(row: {
    subject?: string | null;
    summary?: string | null;
    notes?: string | null;
    outcome?: string | null;
}): ActivityHistoryParts {
    const subject = formatActivityMessage(row.subject);
    const summary = formatActivityMessage(row.summary);
    const notes = formatActivityMessage(row.notes);
    const outcome = formatActivityMessage(row.outcome);

    const body = summary || subject || null;
    const title = subject && summary && !isRedundant(subject, summary) ? subject : null;
    const extraNotes = notes && !isRedundant(notes, body ?? '') ? notes : null;
    const extraOutcome = outcome && !isRedundant(outcome, [body, extraNotes].filter(Boolean).join('\n'))
        ? outcome
        : null;

    return {
        title,
        body,
        notes: extraNotes,
        outcome: extraOutcome,
    };
}
