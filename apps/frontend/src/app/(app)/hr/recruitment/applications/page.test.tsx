'use client';

import { render, screen, waitFor, within } from '@testing-library/react';
import ApplicationsPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getJobApplications: jest.fn(),
        getJobPosts: jest.fn(),
        getApplicants: jest.fn(),
        deleteJobApplication: jest.fn(),
        changeJobApplicationStage: jest.fn(),
        hireJobApplicant: jest.fn(),
    },
}));

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/hr/recruitment/applications',
    useSearchParams: () => ({ get: jest.fn() }),
}));

const APPLICATION = {
    id: 'app-1',
    stage: 'INTERVIEW',
    applied_at: '2026-08-01T00:00:00.000Z',
    stage_changed_at: '2026-08-05T00:00:00.000Z',
    expected_salary: '25000',
    source: 'Referral',
    applicant: { id: 'cand-1', name: 'Rina Akter', phone: '01710000000' },
    jobPost: { id: 'post-1', code: 'JOB-00001', title: 'Sales Executive' },
};

describe('ApplicationsPage', () => {
    beforeEach(() => {
        const { api } = require('@/lib/api');
        jest.clearAllMocks();
        api.getJobApplications.mockResolvedValue([]);
        api.getJobPosts.mockResolvedValue([]);
        api.getApplicants.mockResolvedValue([]);
    });

    it('renders the page heading', async () => {
        render(<ApplicationsPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Applications' })).toBeInTheDocument();
        });
    });

    it('asks for the live pipeline only by default', async () => {
        const { api } = require('@/lib/api');
        render(<ApplicationsPage />);

        await waitFor(() => {
            expect(api.getJobApplications).toHaveBeenCalled();
        });
        expect(api.getJobApplications.mock.calls[0][0]).toMatchObject({
            stages: 'APPLIED,SCREENING,INTERVIEW,OFFER',
        });
    });

    it('displays a loaded application with its stage', async () => {
        const { api } = require('@/lib/api');
        api.getJobApplications.mockResolvedValue([APPLICATION]);

        render(<ApplicationsPage />);

        await waitFor(() => {
            expect(screen.getByText('Rina Akter')).toBeInTheDocument();
        });
        // Scoped to the table: the stage names are also filter options.
        const table = within(screen.getByRole('table'));
        expect(table.getByText('Interview')).toBeInTheDocument();
        expect(table.getByText('Sales Executive')).toBeInTheDocument();
    });

    it('offers a hire action while the candidate is still in the pipeline', async () => {
        const { api } = require('@/lib/api');
        api.getJobApplications.mockResolvedValue([APPLICATION]);

        render(<ApplicationsPage />);

        await waitFor(() => {
            expect(screen.getByLabelText('Hire')).toBeInTheDocument();
        });
        expect(screen.getByLabelText('Move Stage')).toBeInTheDocument();
    });

    it('drops the hire and remove actions once somebody is hired', async () => {
        const { api } = require('@/lib/api');
        api.getJobApplications.mockResolvedValue([{
            ...APPLICATION,
            stage: 'HIRED',
            hired_employee_id: 'emp-1',
            hiredEmployee: { id: 'emp-1', employee_code: 'EMP-00007', name: 'Rina Akter' },
        }]);

        render(<ApplicationsPage />);

        await waitFor(() => {
            expect(screen.getByText('EMP-00007')).toBeInTheDocument();
        });
        expect(screen.queryByLabelText('Hire')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Move Stage')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Remove')).not.toBeInTheDocument();
    });
});
