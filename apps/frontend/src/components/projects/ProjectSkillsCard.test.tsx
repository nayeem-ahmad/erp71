import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ProjectSkillsCard from './ProjectSkillsCard';

const addProjectSkill = jest.fn().mockResolvedValue({});

jest.mock('@/lib/api', () => ({
    api: {
        getSkills: jest.fn().mockResolvedValue([
            { id: 's1', name: 'Welding', category: 'TECHNICAL', is_active: true, sort_order: 0 },
            { id: 's2', name: 'English', category: 'LANGUAGE', is_active: true, sort_order: 1 },
        ]),
        addProjectSkill: (...args: unknown[]) => addProjectSkill(...args),
        updateProjectSkill: jest.fn().mockResolvedValue({}),
        removeProjectSkill: jest.fn().mockResolvedValue({}),
    },
}));

const skillSelect = () => screen.getAllByRole('combobox')[0];

const open = async () => {
    fireEvent.click(screen.getByText('Add skill'));
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(1));
};

describe('ProjectSkillsCard', () => {
    beforeEach(() => addProjectSkill.mockClear());

    it('lists a required skill', () => {
        render(
            <ProjectSkillsCard
                projectId="p1"
                assignments={[{
                    id: 'ps1',
                    requirement: 'REQUIRED',
                    min_proficiency: 'ADVANCED',
                    skill: { id: 's1', name: 'Welding', category: 'TECHNICAL', is_active: true },
                }]}
                onChanged={jest.fn()}
            />,
        );

        expect(screen.getByText('Welding')).toBeInTheDocument();
        expect(screen.getByText(/Required/)).toBeInTheDocument();
        expect(screen.getByText(/Advanced/)).toBeInTheDocument();
    });

    it('sends skillId and requirement when adding', async () => {
        render(<ProjectSkillsCard projectId="p1" assignments={[]} onChanged={jest.fn()} />);
        await open();

        fireEvent.change(skillSelect(), { target: { value: 's1' } });
        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => expect(addProjectSkill).toHaveBeenCalled());
        expect(addProjectSkill).toHaveBeenCalledWith(
            'p1',
            expect.objectContaining({ skillId: 's1', requirement: 'REQUIRED' }),
        );
    });

    it('hides skills the project already lists', async () => {
        render(
            <ProjectSkillsCard
                projectId="p1"
                assignments={[{
                    id: 'ps1',
                    requirement: 'REQUIRED',
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
