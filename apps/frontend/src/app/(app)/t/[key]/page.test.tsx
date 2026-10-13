import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TaskShortLinkPage from './page';

const push = jest.fn();
const replace = jest.fn();
// One object, as Next's is: the page's effect depends on the router.
const router = { push, replace, refresh: jest.fn(), back: jest.fn() };
let key = 'ERP-14';

jest.mock('next/navigation', () => ({
    useParams: () => ({ key }),
    useRouter: () => router,
}));

const resolveTaskKey = jest.fn();
jest.mock('@/lib/api', () => ({
    api: { resolveTaskKey: (...args: unknown[]) => resolveTaskKey(...args) },
}));

beforeEach(() => {
    key = 'ERP-14';
    push.mockReset();
    replace.mockReset();
    resolveTaskKey.mockReset();
});

describe('the short task link', () => {
    it('resolves the key and replaces itself with the task page', async () => {
        resolveTaskKey.mockResolvedValue({ id: 't1', currentKey: 'ERP-14', moved: false });
        render(<TaskShortLinkPage />);

        await waitFor(() => expect(replace).toHaveBeenCalledWith('/projects/tasks/t1'));
        expect(resolveTaskKey).toHaveBeenCalledWith('ERP-14');
        expect(push).not.toHaveBeenCalled();
    });

    it('lands on the task when its project code has changed since the link was copied', async () => {
        resolveTaskKey.mockResolvedValue({ id: 't1', currentKey: 'CRM-14', moved: true });
        render(<TaskShortLinkPage />);

        await waitFor(() => expect(replace).toHaveBeenCalledWith('/projects/tasks/t1'));
    });

    it('says the task is not available for an unknown key, and offers the task list', async () => {
        resolveTaskKey.mockRejectedValue(Object.assign(new Error('Task not found'), { status: 404 }));
        render(<TaskShortLinkPage />);

        expect(await screen.findByRole('alert')).toHaveTextContent("This task isn't available");
        fireEvent.click(screen.getByRole('button', { name: 'Go to Tasks' }));
        expect(push).toHaveBeenCalledWith('/projects/tasks');
        expect(replace).not.toHaveBeenCalled();
    });

    it('offers a retry when the lookup itself failed', async () => {
        resolveTaskKey.mockRejectedValueOnce(new Error('network'));
        resolveTaskKey.mockResolvedValueOnce({ id: 't1', currentKey: 'ERP-14', moved: false });
        render(<TaskShortLinkPage />);

        fireEvent.click(await screen.findByRole('button', { name: /refresh/i }));
        await waitFor(() => expect(replace).toHaveBeenCalledWith('/projects/tasks/t1'));
        expect(resolveTaskKey).toHaveBeenCalledTimes(2);
    });
});
