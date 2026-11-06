import {
    APPROVAL_INBOX_BATCH_CAP,
    APPROVAL_INBOX_CHANNEL,
    APPROVAL_INBOX_GRADE_FIELD,
    classifyApprovalDraft,
    draftPreview,
    isGradeA,
    isOutboundLinkedInDm,
    isTypingTarget,
    lastHistoryLine,
} from './approval-inbox';

const DRAFT_TITLE = 'LinkedIn follow-up DRAFT — review before send';

describe('classifyApprovalDraft', () => {
    it('leaves a plain review draft ready to send', () => {
        expect(classifyApprovalDraft({
            title: DRAFT_TITLE,
            notes: 'Hi — following up on the note I sent last week.',
            history: [],
        })).toBe('ready');
    });

    it('does not read the unsent draft body as history', () => {
        expect(classifyApprovalDraft({
            title: DRAFT_TITLE,
            notes: 'If your invite expired I can DM you a fresh one. Please hold if busy.',
            history: [],
        })).toBe('ready');
    });

    it('tags an outbound LinkedIn DM already in history as Already DMd', () => {
        expect(classifyApprovalDraft({
            title: DRAFT_TITLE,
            history: [{
                channelCode: 'LINKEDIN',
                direction: 'OUTBOUND',
                summary: 'Sent a LinkedIn DM about the pilot.',
            }],
        })).toBe('already_dmd');
    });

    it('treats a LinkedIn-channel outbound log that is not an invite as a DM', () => {
        expect(classifyApprovalDraft({
            title: DRAFT_TITLE,
            history: [{
                channelCode: 'LINKEDIN',
                direction: 'OUTBOUND',
                summary: 'Hi — circling back on the intro.',
            }],
        })).toBe('already_dmd');
    });

    it('does not treat an outbound connection invite as a DM', () => {
        expect(classifyApprovalDraft({
            title: DRAFT_TITLE,
            history: [{
                channelCode: 'LINKEDIN',
                direction: 'OUTBOUND',
                summary: 'Connection request sent.',
            }],
        })).toBe('ready');
    });

    it('does not treat an inbound LinkedIn reply as an outbound DM', () => {
        expect(classifyApprovalDraft({
            title: DRAFT_TITLE,
            history: [{
                channelCode: 'LINKEDIN',
                direction: 'INBOUND',
                summary: 'Thanks, send me the deck.',
            }],
        })).toBe('ready');
    });

    it('tags a DM logged on another channel when the text says so', () => {
        expect(isOutboundLinkedInDm({
            channelCode: 'NOTE',
            direction: 'OUTBOUND',
            summary: 'Logged the LinkedIn DM I sent this morning.',
        })).toBe(true);
        expect(classifyApprovalDraft({
            title: DRAFT_TITLE,
            history: [{
                channelCode: 'NOTE',
                direction: 'OUTBOUND',
                summary: 'Logged the LinkedIn DM I sent this morning.',
            }],
        })).toBe('already_dmd');
    });

    it('tags a title that already says the DM went out', () => {
        expect(classifyApprovalDraft({
            title: 'LinkedIn follow-up DRAFT — already DMd',
            history: [],
        })).toBe('already_dmd');
    });

    it('tags a withdrawn or expired invite as Lapsed invite', () => {
        expect(classifyApprovalDraft({
            title: DRAFT_TITLE,
            history: [{ summary: 'Invite withdrawn by the lead.' }],
        })).toBe('lapsed_invite');
        expect(classifyApprovalDraft({
            title: DRAFT_TITLE,
            history: [{ summary: 'Connection request expired.' }],
        })).toBe('lapsed_invite');
        expect(classifyApprovalDraft({
            title: 'LinkedIn follow-up DRAFT — lapsed invite',
        })).toBe('lapsed_invite');
    });

    it('lets a lapsed invite win over an earlier DM', () => {
        expect(classifyApprovalDraft({
            title: DRAFT_TITLE,
            history: [
                { summary: 'Invitation expired last month.' },
                { channelCode: 'LINKEDIN', direction: 'OUTBOUND', summary: 'Sent a DM in January.' },
            ],
        })).toBe('lapsed_invite');
    });

    it('tags a hold on the title or in history, ahead of every other signal', () => {
        expect(classifyApprovalDraft({
            title: 'LinkedIn follow-up DRAFT — HOLD',
            history: [{ channelCode: 'LINKEDIN', direction: 'OUTBOUND', summary: 'Sent a DM.' }],
        })).toBe('hold');
        expect(classifyApprovalDraft({
            title: DRAFT_TITLE,
            history: [{ summary: 'On hold until they reply to finance.' }],
        })).toBe('hold');
        expect(classifyApprovalDraft({
            title: "LinkedIn follow-up DRAFT — don't send",
        })).toBe('hold');
    });

    it('tags a title that asks for a rewrite', () => {
        expect(classifyApprovalDraft({ title: 'LinkedIn follow-up DRAFT — needs rewrite' })).toBe('needs_rewrite');
        expect(classifyApprovalDraft({ title: 'LinkedIn follow-up DRAFT — placeholder' })).toBe('needs_rewrite');
    });
});

describe('approval inbox helpers', () => {
    it('treats A and Grade A as grade A', () => {
        expect(APPROVAL_INBOX_GRADE_FIELD).toBe('cf_4');
        expect(isGradeA('A')).toBe(true);
        expect(isGradeA(' a ')).toBe(true);
        expect(isGradeA('Grade A')).toBe(true);
        expect(isGradeA('B')).toBe(false);
        expect(isGradeA('')).toBe(false);
        expect(isGradeA(null)).toBe(false);
    });

    it('previews the notes, then the title, at about 120 characters', () => {
        expect(draftPreview('  Short note.  ', 'Title')).toBe('Short note.');
        const long = 'x'.repeat(200);
        expect(draftPreview(long, 'Title')).toHaveLength(121);
        expect(draftPreview(long, 'Title').endsWith('…')).toBe(true);
        expect(draftPreview('  ', 'Fallback title')).toBe('Fallback title');
        expect(draftPreview(null, null)).toBe('');
    });

    it('uses the newest history summary as the last line', () => {
        expect(lastHistoryLine([
            { summary: 'Invite withdrawn.', subject: 'Older title' },
        ])).toBe('Invite withdrawn.');
        expect(lastHistoryLine([{ subject: 'Connection request sent' }])).toBe('Connection request sent');
        expect(lastHistoryLine([])).toBe('');
    });

    it('ignores shortcuts while typing', () => {
        expect(isTypingTarget(null)).toBe(false);
        expect(isTypingTarget({ tagName: 'TR', isContentEditable: false } as unknown as EventTarget)).toBe(false);
        expect(isTypingTarget({ tagName: 'INPUT', isContentEditable: false } as unknown as EventTarget)).toBe(true);
        expect(isTypingTarget({ tagName: 'TEXTAREA', isContentEditable: false } as unknown as EventTarget)).toBe(true);
        expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    });

    it('caps a batch at 20 and completes on the LinkedIn channel code', () => {
        expect(APPROVAL_INBOX_BATCH_CAP).toBe(20);
        expect(APPROVAL_INBOX_CHANNEL).toBe('LINKEDIN');
    });
});
