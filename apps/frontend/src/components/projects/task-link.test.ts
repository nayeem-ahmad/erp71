import { copyTaskLink, taskUrl } from './task-link';
import { toast } from '@/lib/toast';

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const messages = { linkCopied: 'Link copied', copyLinkFailed: 'Could not copy the link' };

describe('taskUrl', () => {
    it('points at the task page on the given origin', () => {
        expect(taskUrl('t1', 'https://app.erp71.com')).toBe('https://app.erp71.com/projects/tasks/t1');
    });
});

describe('copyTaskLink', () => {
    beforeEach(() => jest.clearAllMocks());

    it('copies the absolute task URL and confirms it', async () => {
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });

        await expect(copyTaskLink('t1', messages)).resolves.toBe(true);
        expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/projects/tasks/t1`);
        expect(toast.success).toHaveBeenCalledWith('Link copied');
    });

    it('says so when the clipboard refuses', async () => {
        Object.assign(navigator, { clipboard: { writeText: jest.fn().mockRejectedValue(new Error('denied')) } });

        await expect(copyTaskLink('t1', messages)).resolves.toBe(false);
        expect(toast.error).toHaveBeenCalledWith('Could not copy the link');
        expect(toast.success).not.toHaveBeenCalled();
    });
});
