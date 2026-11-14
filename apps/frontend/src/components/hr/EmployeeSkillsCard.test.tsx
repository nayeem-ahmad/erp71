import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import EmployeeSkillsCard from './EmployeeSkillsCard';

const addPersonSkill = jest.fn().mockResolvedValue({});

jest.mock('@/lib/api', () => ({
    api: {
        getSkills: jest.fn().mockResolvedValue([
            { id: 's1', name: 'Welding', category: 'TECHNICAL', is_active: true, sort_order: 0 },
            { id: 's2', name: 'English', category: 'LANGUAGE', is_active: true, sort_order: 1 },
        ]),
        addPersonSkill: (...args: unknown[]) => addPersonSkill(...args),
        updatePersonSkill: jest.fn().mockResolvedValue({}),
        removePersonSkill: jest.fn().mockResolvedValue({}),
    },
}));

const skillSelect = () => screen.getAllByRole('combobox')[0];

const open = async () => {
    fireEvent.click(screen.getByText('Add skill'));
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0));
};

describe('EmployeeSkillsCard', () => {
    beforeEach(() => addPersonSkill.mockClear());

    it('lists an assigned skill and its proficiency', () => {
        render(
            <EmployeeSkillsCard
                employeeId="e1"
                assignments={[{
                    id: 'ps1',
                    proficiency: 'ADVANCED',
                    skill: { id: 's1', name: 'Welding', category: 'TECHNICAL', is_active: true },
                }]}
                onChanged={jest.fn()}
            />,
        );

        expect(screen.getByText('Welding')).toBeInTheDocument();
        expect(screen.getByText('Advanced')).toBeInTheDocument();
    });

    it('sends employeeId and skillId when adding', async () => {
        render(<EmployeeSkillsCard employeeId="e1" assignments={[]} onChanged={jest.fn()} />);
        await open();

        fireEvent.change(skillSelect(), { target: { value: 's1' } });
        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => expect(addPersonSkill).toHaveBeenCalled());
        expect(addPersonSkill).toHaveBeenCalledWith(
            expect.objectContaining({ employeeId: 'e1', skillId: 's1', proficiency: 'INTERMEDIATE' }),
        );
    });

    it('hides skills the person already has', async () => {
        render(
            <EmployeeSkillsCard
                employeeId="e1"
                assignments={[{
                    id: 'ps1',
                    proficiency: 'BEGINNER',
                    skill: { id: 's1', name: 'Welding', category: 'TECHNICAL', is_active: true },
                }]}
                onChanged={jest.fn()}
            />,
        );
        await open();

        expect(
            screen.getAllByRole('option').filter((o) => o.textContent === 'Welding'),
        ).toHaveLength(0);
        expect(
            screen.getAllByRole('option').filter((o) => o.textContent === 'English'),
        ).toHaveLength(1);
    });
});
