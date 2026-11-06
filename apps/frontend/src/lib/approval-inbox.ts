/**
 * How an overdue "LinkedIn follow-up DRAFT" planned activity is tagged in the
 * Approvals Inbox.
 *
 * One function, used by the inbox only. It reads the planned title and the
 * lead's History (DONE / cancelled activities). It never reads the draft body:
 * that text is the unsent message, and words like "DM" or "invite" inside it
 * are not evidence that anything was already logged.
 *
 * First match wins:
 * 1. Hold — the title or a history line says to hold / not send.
 * 2. Lapsed invite — the title or a history line says the invite was
 *    withdrawn, expired, or lapsed.
 * 3. Already DMd — a history line is an outbound LinkedIn DM, or the title
 *    itself says one was already sent.
 * 4. Needs rewrite — the title asks for a rewrite.
 * 5. Ready to send — none of the above.
 */

export const APPROVAL_BUCKETS = [
    'ready',
    'already_dmd',
    'lapsed_invite',
    'needs_rewrite',
    'hold',
] as const;

export type ApprovalBucket = (typeof APPROVAL_BUCKETS)[number];

/** Channel code passed to the existing complete API. Not a LinkedIn call. */
export const APPROVAL_INBOX_CHANNEL = 'LINKEDIN';

/** Shared bulk actions refuse a larger selection than this. */
export const APPROVAL_INBOX_BATCH_CAP = 20;

export const DRAFT_PREVIEW_CHARS = 120;

/**
 * Lead custom field that stores Grade. The inbox defaults to "A". The field
 * is tenant-defined data, not a schema column — if `cf_4` is missing the
 * grade is blank and the Grade A filter shows nothing.
 */
export const APPROVAL_INBOX_GRADE_FIELD = 'cf_4';

export interface ApprovalHistoryLine {
    subject?: string | null;
    summary?: string | null;
    outcome?: string | null;
    notes?: string | null;
    channelCode?: string | null;
    direction?: string | null;
}

export interface ApprovalDraftInput {
    title?: string | null;
    notes?: string | null;
    history?: readonly ApprovalHistoryLine[] | null;
}

const HOLD_PATTERN = /\bon hold\b|\bdo not send\b|\bdon't send\b|\bdo-not-send\b|\bhold\b/i;

const LAPSED_PATTERN =
    /invit(?:e|ation)\s+(?:was\s+)?(?:withdrawn|expired|lapsed)|(?:withdrawn|expired|lapsed)\s+invit(?:e|ation)|lapsed invite|connection (?:request|invite)\s+(?:was\s+)?(?:withdrawn|expired)/i;

const REWRITE_PATTERN = /\bneeds?\s+rewrite\b|\brewrite\b|\bplaceholder\b|\bfix (?:the )?draft\b|\btbd\b/i;

const ALREADY_DM_TITLE = /\balready\s+dms?\b|\bdm['’]?d\b|\balready messaged\b/i;

const DM_LANGUAGE = /\bdm(?:['’]?d|ed)?\b|\bdirect messages?\b|\binmail\b|\bmessaged\b/i;

const INVITE_LANGUAGE = /\binvit|\bconnection request\b/i;

function textOf(parts: readonly (string | null | undefined)[]): string {
    return parts.filter((part) => typeof part === 'string' && part.trim()).join('\n');
}

function historyText(line: ApprovalHistoryLine): string {
    return textOf([line.subject, line.summary, line.outcome, line.notes]);
}

function isInbound(direction: string | null | undefined): boolean {
    return (direction ?? '').trim().toUpperCase() === 'INBOUND';
}

function isLinkedInChannel(channelCode: string | null | undefined): boolean {
    return (channelCode ?? '').toLowerCase().includes('linkedin');
}

/** An outbound LinkedIn DM already written to History. */
export function isOutboundLinkedInDm(line: ApprovalHistoryLine): boolean {
    if (isInbound(line.direction)) return false;
    const text = historyText(line);
    const linkedin = isLinkedInChannel(line.channelCode) || /\blinkedin\b/i.test(text);
    if (!linkedin) return false;
    if (DM_LANGUAGE.test(text)) return true;
    // A LinkedIn-channel outbound log that is not an invite is the DM itself.
    return isLinkedInChannel(line.channelCode) && !INVITE_LANGUAGE.test(text);
}

export function classifyApprovalDraft(input: ApprovalDraftInput): ApprovalBucket {
    const title = input.title ?? '';
    const history = input.history ?? [];
    const historyBlob = history.map(historyText).join('\n');
    const signal = `${title}\n${historyBlob}`;

    if (HOLD_PATTERN.test(title) || HOLD_PATTERN.test(historyBlob)) return 'hold';
    if (LAPSED_PATTERN.test(signal)) return 'lapsed_invite';
    if (ALREADY_DM_TITLE.test(title) || history.some(isOutboundLinkedInDm)) return 'already_dmd';
    if (REWRITE_PATTERN.test(title)) return 'needs_rewrite';
    return 'ready';
}

/** Grade A is the stored value "A" or "Grade A", ignoring case and surrounding space. */
export function isGradeA(grade: string | null | undefined): boolean {
    if (!grade) return false;
    const value = grade.trim().toLowerCase();
    return value === 'a' || value === 'grade a';
}

/** ~120 characters of the planned notes, falling back to the title. */
export function draftPreview(
    notes: string | null | undefined,
    title: string | null | undefined,
    max = DRAFT_PREVIEW_CHARS,
): string {
    const source = (notes?.trim() || title?.trim() || '').replace(/\s+/g, ' ');
    if (source.length <= max) return source;
    return `${source.slice(0, max).trimEnd()}…`;
}

/** The newest history line's "what happened", else its title. */
export function lastHistoryLine(history: readonly ApprovalHistoryLine[]): string {
    const line = history[0];
    if (!line) return '';
    return line.summary?.trim() || line.subject?.trim() || line.outcome?.trim() || '';
}

/** Shortcuts stay off while a person is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
    if (!target || typeof target !== 'object' || !('tagName' in target)) return false;
    const el = target as HTMLElement;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return Boolean(el.isContentEditable);
}
