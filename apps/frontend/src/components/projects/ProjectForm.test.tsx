import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProjectForm from './ProjectForm';
import { ApiError } from '@/lib/api';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push, back: jest.fn() }) }));

jest.mock('@/lib/i18n', () => {
    const { enMessages } = require('../../lib/localization/messages/en');
    const fill = (template: string, values: Record<string, string | number>) =>
        Object.entries(values).reduce(
            (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
            template,
        );
    return { useI18n: () => ({ t: enMessages, fmt: fill }), formatMessage: fill };
});

jest.mock('@/lib/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const suggestProjectCode = jest.fn();
const createProject = jest.fn();
const updateProject = jest.fn();
jest.mock('@/lib/api', () => {
    const actual = jest.requireActual('@/lib/api');
    return {
        ApiError: actual.ApiError,
        api: {
            getProjectTypes: jest.fn().mockResolvedValue([]),
            getCustomers: jest.fn().mockResolvedValue([]),
            suggestProjectCode: (...args: unknown[]) => suggestProjectCode(...args),
            createProject: (...args: unknown[]) => createProject(...args),
            updateProject: (...args: unknown[]) => updateProject(...args),
        },
    };
});

const nameInput = () => screen.getAllByRole('textbox')[0] as HTMLInputElement;
const codeInput = () => screen.getByLabelText('Code') as HTMLInputElement;

beforeEach(() => {
    jest.useFakeTimers();
    suggestProjectCode.mockReset().mockImplementation((name: string) =>
        Promise.resolve({ code: name === 'Warehouse System' ? 'WS' : 'OTHER' }),
    );
    createProject.mockReset().mockResolvedValue({ id: 'p1' });
    updateProject.mockReset().mockResolvedValue({ id: 'p1' });
    push.mockReset();
});

afterEach(() => jest.useRealTimers());

const typeName = async (value: string) => {
    fireEvent.change(nameInput(), { target: { value } });
    await act(async () => {
        jest.advanceTimersByTime(300);
    });
};

describe('ProjectForm code', () => {
    it('proposes a code from the name on create', async () => {
        render(<ProjectForm mode="create" />);
        await typeName('Warehouse System');

        await waitFor(() => expect(codeInput().value).toBe('WS'));
        expect(suggestProjectCode).toHaveBeenCalledWith('Warehouse System');
        expect(screen.getByText(/WS-14/)).toBeInTheDocument();
    });

    it('stops following the name once the code is typed by hand', async () => {
        render(<ProjectForm mode="create" />);
        await typeName('Warehouse System');
        await waitFor(() => expect(codeInput().value).toBe('WS'));

        fireEvent.change(codeInput(), { target: { value: 'wh-1' } });
        expect(codeInput().value).toBe('WH-1');

        suggestProjectCode.mockClear();
        await typeName('Something else');
        expect(suggestProjectCode).not.toHaveBeenCalled();
        expect(codeInput().value).toBe('WH-1');
    });

    it('sends the chosen code when creating', async () => {
        render(<ProjectForm mode="create" />);
        await typeName('Warehouse System');
        await waitFor(() => expect(codeInput().value).toBe('WS'));

        fireEvent.submit(codeInput().closest('form')!);
        await waitFor(() => expect(createProject).toHaveBeenCalled());
        expect(createProject.mock.calls[0][0]).toMatchObject({ code: 'WS', name: 'Warehouse System' });
    });

    it('flags an invalid code inline instead of submitting', async () => {
        render(<ProjectForm mode="create" />);
        await typeName('Warehouse System');
        fireEvent.change(codeInput(), { target: { value: '9X' } });

        fireEvent.submit(codeInput().closest('form')!);
        expect(await screen.findByText(/starting with a letter/)).toBeInTheDocument();
        expect(createProject).not.toHaveBeenCalled();
    });

    it('shows a taken code on the field', async () => {
        createProject.mockRejectedValue(new ApiError('Project code WS is already in use', 409));
        render(<ProjectForm mode="create" />);
        await typeName('Warehouse System');
        await waitFor(() => expect(codeInput().value).toBe('WS'));

        fireEvent.submit(codeInput().closest('form')!);
        expect(await screen.findByText('Project code WS is already in use')).toBeInTheDocument();
        expect(push).not.toHaveBeenCalled();
    });

    it('lets an existing project change its code without re-proposing one', async () => {
        const initial = {
            code: 'PRJ-0002', name: 'Fit-out', shortName: '', description: '', customerId: '',
            projectTypeId: '', status: 'ACTIVE', priority: 'MEDIUM', visibility: 'PUBLIC',
            startDate: '', targetEndDate: '', budgetAmount: '',
        };
        render(<ProjectForm mode="edit" projectId="p1" initial={initial} />);
        expect(codeInput().value).toBe('PRJ-0002');

        await typeName('Renamed');
        expect(suggestProjectCode).not.toHaveBeenCalled();

        fireEvent.change(codeInput(), { target: { value: 'FIT' } });
        fireEvent.submit(codeInput().closest('form')!);
        await waitFor(() => expect(updateProject).toHaveBeenCalled());
        expect(updateProject.mock.calls[0][1]).toMatchObject({ code: 'FIT' });
    });
});
