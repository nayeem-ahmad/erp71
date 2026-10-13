import { copyTaskLink, shortTaskUrl, taskShareUrl, taskUrl } from './task-link';
import { toast } from '@/lib/toast';

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const messages = { linkCopied: 'Link copied', copyLinkFailed: 'Could not copy the link' };
const host = window.location.origin.replace(/^[a-z]+:\/\//, '');

describe('taskUrl', () => {
    it('points at the task page on the given origin', () => {
        expect(taskUrl('t1', 'https://app.erp71.com')).toBe('https://app.erp71.com/projects/tasks/t1');
    });
});

describe('shortTaskUrl', () => {
    it('is /t/<key> on the given origin', () => {
        expect(shortTaskUrl('ERP-14', 'https://app.erp71.com')).toBe('https://app.erp71.com/t/ERP-14');
    });
});

describe('taskShareUrl', () => {
    it('prefers the short link when the task has a key', () => {
        expect(taskShareUrl({ id: 't1', key: 'ERP-14' }, 'https://app.erp71.com')).toBe(
            'https://app.erp71.com/t/ERP-14',
        );
    });

    it('falls back to the id-based link before the key is known', () => {
        expect(taskShareUrl({ id: 't1', key: null }, 'https://app.erp71.com')).toBe(
            'https://app.erp71.com/projects/tasks/t1',
        );
        expect(taskShareUrl({ id: 't1' }, 'https://app.erp71.com')).toBe(
            'https://app.erp71.com/projects/tasks/t1',
        );
    });
});

describe('copyTaskLink', () => {
    beforeEach(() => jest.clearAllMocks());

    it('copies the short link and names it in the confirmation', async () => {
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });

        await expect(copyTaskLink({ id: 't1', key: 'ERP-14' }, messages)).resolves.toBe(true);
        expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/t/ERP-14`);
        expect(toast.success).toHaveBeenCalledWith(`Link copied · ${host}/t/ERP-14`);
    });

    it('copies the id-based link when there is no key yet', async () => {
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });

        await expect(copyTaskLink({ id: 't1' }, messages)).resolves.toBe(true);
        expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/projects/tasks/t1`);
    });

    it('says so when the clipboard refuses, and still shows the link', async () => {
        Object.assign(navigator, { clipboard: { writeText: jest.fn().mockRejectedValue(new Error('denied')) } });

        await expect(copyTaskLink({ id: 't1', key: 'ERP-14' }, messages)).resolves.toBe(false);
        expect(toast.error).toHaveBeenCalledWith(`Could not copy the link · ${host}/t/ERP-14`);
        expect(toast.success).not.toHaveBeenCalled();
    });
});
