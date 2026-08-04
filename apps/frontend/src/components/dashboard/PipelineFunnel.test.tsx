import React from 'react';
import { render, screen } from '@testing-library/react';
import { PipelineFunnel, type FunnelStage } from './PipelineFunnel';

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

const stages: FunnelStage[] = [
    { id: 'NEW', label: 'New', count: 10, href: '/crm/leads?status=NEW' },
    { id: 'CONTACTED', label: 'Contacted', count: 6, href: '/crm/leads?status=CONTACTED' },
    { id: 'QUALIFIED', label: 'Qualified', count: 4, href: '/crm/leads?status=QUALIFIED' },
    { id: 'CONVERTED', label: 'Won', count: 3, href: '/crm/leads?status=CONVERTED', outcome: 'won' },
    { id: 'LOST', label: 'Lost', count: 1, href: '/crm/leads?status=LOST', outcome: 'lost' },
];

const formatCount = (count: number, share: number | null) =>
    share == null ? String(count) : `${count} · ${share}%`;

function renderFunnel(override: Partial<React.ComponentProps<typeof PipelineFunnel>> = {}) {
    return render(
        <PipelineFunnel
            title="Lead pipeline"
            stages={stages}
            emptyLabel="No leads yet"
            formatCount={formatCount}
            {...override}
        />,
    );
}

describe('PipelineFunnel', () => {
    it('shares of the open pipeline are quoted only for open stages', () => {
        renderFunnel();

        // 10 of the 20 open leads.
        expect(screen.getByText('10 · 50%')).toBeInTheDocument();
        expect(screen.getByText('6 · 30%')).toBeInTheDocument();
        // Outcomes are counts, not a share of a pipeline they have left.
        expect(screen.getByText('3')).toBeInTheDocument();
        expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('links each stage to its filtered lead list', () => {
        renderFunnel();

        expect(screen.getByRole('link', { name: /New/ })).toHaveAttribute('href', '/crm/leads?status=NEW');
        expect(screen.getByRole('link', { name: /Lost/ })).toHaveAttribute('href', '/crm/leads?status=LOST');
    });

    it('scales bar widths against the largest stage, not the total', () => {
        const { container } = renderFunnel();
        const fills = container.querySelectorAll('span[style]');

        // NEW is the biggest stage, so it is the full-width reference.
        expect((fills[0] as HTMLElement).style.width).toBe('100%');
        expect((fills[1] as HTMLElement).style.width).toBe('60%');
    });

    it('keeps a non-zero stage visible instead of collapsing it to a hairline', () => {
        const { container } = renderFunnel({
            stages: [
                { id: 'NEW', label: 'New', count: 500, href: '/a' },
                { id: 'LOST', label: 'Lost', count: 1, href: '/b', outcome: 'lost' },
            ],
        });
        const fills = container.querySelectorAll('span[style]');

        expect((fills[1] as HTMLElement).style.width).toBe('4%');
    });

    it('draws no bars at all when every stage is empty', () => {
        renderFunnel({ stages: stages.map((stage) => ({ ...stage, count: 0 })) });

        expect(screen.getByText('No leads yet')).toBeInTheDocument();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('colors stages as one ordinal ramp, with the outcomes set apart', () => {
        const { container } = renderFunnel();
        const fills = [...container.querySelectorAll('span[style]')] as HTMLElement[];

        expect(fills[0].className).toContain('bg-blue-600');
        expect(fills[1].className).toContain('bg-blue-500');
        expect(fills[2].className).toContain('bg-blue-400');
        expect(fills[3].className).toContain('bg-emerald-500');
        // Lost is gray: an outcome, not an error.
        expect(fills[4].className).toContain('bg-gray-300');
    });
});
