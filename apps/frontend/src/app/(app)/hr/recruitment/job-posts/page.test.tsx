'use client';

import { render, screen, waitFor, within } from '@testing-library/react';
import JobPostsPage from './page';

jest.mock('@/lib/api', () => ({
    api: {
        getJobPosts: jest.fn(),
        getRecruitmentSummary: jest.fn(),
        getDepartments: jest.fn(),
        getDesignations: jest.fn(),
        getEmployees: jest.fn(),
        createJobPost: jest.fn(),
        updateJobPost: jest.fn(),
        deleteJobPost: jest.fn(),
    },
}));

jest.mock('next/link', () => {
    return ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>;
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    usePathname: () => '/hr/recruitment/job-posts',
    useSearchParams: () => ({ get: jest.fn() }),
}));

const SUMMARY = {
    open_posts: 2,
    open_openings: 5,
    in_pipeline: 8,
    hired_this_month: 1,
    stage_counts: {
        APPLIED: 6, SCREENING: 0, INTERVIEW: 2, OFFER: 0, HIRED: 3, REJECTED: 9, WITHDRAWN: 0,
    },
};

describe('JobPostsPage', () => {
    beforeEach(() => {
        const { api } = require('@/lib/api');
        jest.clearAllMocks();
        api.getJobPosts.mockResolvedValue([]);
        api.getRecruitmentSummary.mockResolvedValue(SUMMARY);
        api.getDepartments.mockResolvedValue([]);
        api.getDesignations.mockResolvedValue([]);
        api.getEmployees.mockResolvedValue([]);
    });

    it('renders the page heading', async () => {
        render(<JobPostsPage />);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: 'Job Posts' })).toBeInTheDocument();
        });
    });

    it('shows the empty state when nothing is posted yet', async () => {
        render(<JobPostsPage />);
        await waitFor(() => {
            expect(screen.getByText(/No job posts yet/i)).toBeInTheDocument();
        });
    });

    it('lists posts with how many candidates are still live', async () => {
        const { api } = require('@/lib/api');
        api.getJobPosts.mockResolvedValue([
            {
                id: 'post-1',
                code: 'JOB-00001',
                title: 'Sales Executive',
                status: 'OPEN',
                employment_type: 'FULL_TIME',
                location: 'Dhaka',
                openings: 2,
                salary_min: '20000',
                salary_max: '30000',
                department: { id: 'd1', name: 'Sales' },
                application_count: 7,
                open_application_count: 4,
                hired_count: 1,
            },
        ]);

        render(<JobPostsPage />);

        await waitFor(() => {
            expect(screen.getByText('Sales Executive')).toBeInTheDocument();
        });
        expect(screen.getByText(/JOB-00001/)).toBeInTheDocument();
        expect(screen.getByText('4 in pipeline')).toBeInTheDocument();
        // Scoped to the table: "Open" is also a status filter option.
        expect(within(screen.getByRole('table')).getByText('Open')).toBeInTheDocument();
    });

    it('surfaces the recruitment summary above the list', async () => {
        render(<JobPostsPage />);
        await waitFor(() => {
            expect(screen.getByText('Open Posts')).toBeInTheDocument();
        });
        expect(screen.getByText('Hired This Month')).toBeInTheDocument();
    });

    it('shows an error when the list cannot be loaded', async () => {
        const { api } = require('@/lib/api');
        api.getJobPosts.mockRejectedValue(new Error('Network down'));

        render(<JobPostsPage />);

        await waitFor(() => {
            expect(screen.getByText('Network down')).toBeInTheDocument();
        });
    });
});
