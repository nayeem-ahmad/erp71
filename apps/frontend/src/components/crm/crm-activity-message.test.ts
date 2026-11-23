import { activityHistoryParts, formatActivityMessage } from './crm-activity-message';

describe('formatActivityMessage', () => {
    it('returns an empty string for blank input', () => {
        expect(formatActivityMessage(null)).toBe('');
        expect(formatActivityMessage(undefined)).toBe('');
        expect(formatActivityMessage('   ')).toBe('');
    });

    it('keeps real line breaks', () => {
        expect(formatActivityMessage('Dear Karim,\n\nHere is the catalogue.')).toBe(
            'Dear Karim,\n\nHere is the catalogue.',
        );
    });

    it('turns escaped newlines into real ones', () => {
        expect(formatActivityMessage('Dear Karim,\\n\\nHere is the catalogue.')).toBe(
            'Dear Karim,\n\nHere is the catalogue.',
        );
    });

    it('turns HTML line breaks and paragraphs into real ones and drops the tags', () => {
        expect(formatActivityMessage('Dear Karim,<br><br>Here is the catalogue.')).toBe(
            'Dear Karim,\n\nHere is the catalogue.',
        );
        expect(formatActivityMessage('<p>Dear Karim,</p><p>Here is the catalogue.</p>')).toBe(
            'Dear Karim,\n\nHere is the catalogue.',
        );
    });

    it('collapses runs of blank lines', () => {
        expect(formatActivityMessage('Hello\n\n\n\nWorld')).toBe('Hello\n\nWorld');
    });
});

describe('activityHistoryParts', () => {
    it('uses the summary as the body when there is no subject', () => {
        expect(activityHistoryParts({
            subject: null,
            summary: 'Dear Karim,\\n\\nHere is the catalogue.',
            notes: null,
            outcome: null,
        })).toEqual({
            title: null,
            body: 'Dear Karim,\n\nHere is the catalogue.',
            notes: null,
            outcome: null,
        });
    });

    it('keeps a short subject as the title above a different body', () => {
        expect(activityHistoryParts({
            subject: 'Chase the invoice',
            summary: 'Spoke to Karim.\nHe will pay Thursday.',
            notes: null,
            outcome: 'Promised',
        })).toEqual({
            title: 'Chase the invoice',
            body: 'Spoke to Karim.\nHe will pay Thursday.',
            notes: null,
            outcome: 'Promised',
        });
    });

    it('does not repeat the subject when it is the same as the summary', () => {
        expect(activityHistoryParts({
            subject: 'Sent the catalogue',
            summary: 'Sent the catalogue',
            notes: null,
            outcome: null,
        })).toEqual({
            title: null,
            body: 'Sent the catalogue',
            notes: null,
            outcome: null,
        });
    });

    it('hides notes that only repeat the message body', () => {
        const message = 'Dear Karim,\n\nHere is the catalogue.';
        expect(activityHistoryParts({
            subject: 'Quote follow-up',
            summary: message,
            notes: message,
            outcome: null,
        })).toEqual({
            title: 'Quote follow-up',
            body: message,
            notes: null,
            outcome: null,
        });
    });

    it('keeps notes that add something the body does not say', () => {
        expect(activityHistoryParts({
            subject: null,
            summary: 'Sent the catalogue',
            notes: 'He will pay Thursday.',
            outcome: 'Left a message',
        })).toEqual({
            title: null,
            body: 'Sent the catalogue',
            notes: 'He will pay Thursday.',
            outcome: 'Left a message',
        });
    });
});
