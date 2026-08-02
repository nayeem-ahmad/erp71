import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ProjectTeamCard from './ProjectTeamCard';

const addProjectMember = jest.fn().mockResolvedValue({});

jest.mock('@/lib/api', () => ({
    api: {
        getTeamMembers: jest.fn().mockResolvedValue([
            { id: 'u1', name: 'Rakib Hasan', email: 'rakib@x.com' },
        ]),
        getEmployees: jest.fn().mockResolvedValue([
            // Linked to u1 — the same person, who must not appear twice.
            { id: 'e1', name: 'Rakib Hasan', employee_code: 'EMP-001', user_id: 'u1' },
            { id: 'e2', name: 'Imran Kabir', employee_code: 'EMP-002', user_id: null },
        ]),
        addProjectMember: (...args: unknown[]) => addProjectMember(...args),
        removeProjectMember: jest.fn().mockResolvedValue({}),
    },
}));

/** The picker is the first of the modal's two selects (person, then role). */
const personSelect = () => screen.getAllByRole('combobox')[0];

const open = async () => {
    fireEvent.click(screen.getByText('Add member'));
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(1));
};

describe('ProjectTeamCard picker', () => {
    beforeEach(() => addProjectMember.mockClear());

    it('offers an employee who has no login', async () => {
        render(<ProjectTeamCard projectId="p1" members={[]} onChanged={jest.fn()} />);
        await open();

        const options = screen.getAllByRole('option').map((o) => o.textContent);
        expect(options.some((o) => o?.includes('Imran Kabir') && o?.includes('no login'))).toBe(true);
    });

    it('lists a linked employee once, as the user, so they keep their permissions', async () => {
        render(<ProjectTeamCard projectId="p1" members={[]} onChanged={jest.fn()} />);
        await open();

        const rakib = screen.getAllByRole('option').filter((o) => o.textContent?.includes('Rakib Hasan'));
        expect(rakib).toHaveLength(1);
        expect(rakib[0]).toHaveValue('user:u1');
    });

    it('sends employeeId, not userId, for a person with no account', async () => {
        render(<ProjectTeamCard projectId="p1" members={[]} onChanged={jest.fn()} />);
        await open();

        fireEvent.change(personSelect(), { target: { value: 'employee:e2' } });
        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => expect(addProjectMember).toHaveBeenCalled());
        expect(addProjectMember).toHaveBeenCalledWith(
            'p1',
            expect.objectContaining({ employeeId: 'e2', userId: undefined }),
        );
    });

    it('hides people already on the team', async () => {
        render(
            <ProjectTeamCard
                projectId="p1"
                members={[{ id: 'pm1', role: 'MEMBER', user: { id: 'u1', name: 'Rakib Hasan', email: 'rakib@x.com' } }]}
                onChanged={jest.fn()}
            />,
        );
        await open();

        expect(
            screen.getAllByRole('option').filter((o) => o.textContent?.includes('Rakib Hasan')),
        ).toHaveLength(0);
    });

    it('marks an employee member on the roster as having no login', () => {
        render(
            <ProjectTeamCard
                projectId="p1"
                members={[{ id: 'pm2', role: 'MEMBER', employee: { id: 'e2', name: 'Imran Kabir', employee_code: 'EMP-002' } }]}
                onChanged={jest.fn()}
            />,
        );

        expect(screen.getByText('Imran Kabir')).toBeInTheDocument();
        expect(screen.getByText('no login')).toBeInTheDocument();
    });
});
