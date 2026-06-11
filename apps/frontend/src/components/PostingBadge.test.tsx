import { render, screen } from '@testing-library/react';
import { PostingBadge } from './PostingBadge';

describe('PostingBadge', () => {
    it('renders without crashing with a valid status', () => {
        render(<PostingBadge status="posted" />);
    });

    it('renders a dash when status is null', () => {
        render(<PostingBadge status={null} />);
        expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('renders a dash when status is undefined', () => {
        render(<PostingBadge status={undefined} />);
        expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('renders "Posted" label for posted status', () => {
        render(<PostingBadge status="posted" />);
        expect(screen.getByText('Posted')).toBeInTheDocument();
    });

    it('renders "Pending" label for pending status', () => {
        render(<PostingBadge status="pending" />);
        expect(screen.getByText('Pending')).toBeInTheDocument();
    });

    it('renders "Failed" label for failed status', () => {
        render(<PostingBadge status="failed" />);
        expect(screen.getByText('Failed')).toBeInTheDocument();
    });

    it('renders "Skipped" label for skipped status', () => {
        render(<PostingBadge status="skipped" />);
        expect(screen.getByText('Skipped')).toBeInTheDocument();
    });

    it('renders raw status text for unknown status', () => {
        render(<PostingBadge status="unknown_status" />);
        expect(screen.getByText('unknown_status')).toBeInTheDocument();
    });

    it('renders voucher number when voucherNumber is provided', () => {
        render(<PostingBadge status="posted" voucherNumber="JV-00123" />);
        expect(screen.getByText('JV-00123')).toBeInTheDocument();
    });

    it('does not render voucher number when voucherNumber is not provided', () => {
        render(<PostingBadge status="posted" />);
        expect(screen.queryByText('JV-')).not.toBeInTheDocument();
    });

    it('does not render voucher number when voucherNumber is null', () => {
        render(<PostingBadge status="posted" voucherNumber={null} />);
        // Should only show the status badge, not a voucher number span
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('applies emerald color classes for posted status', () => {
        const { container } = render(<PostingBadge status="posted" />);
        const badge = container.querySelector('span.bg-emerald-50');
        expect(badge).toBeInTheDocument();
    });

    it('applies amber color classes for pending status', () => {
        const { container } = render(<PostingBadge status="pending" />);
        const badge = container.querySelector('span.bg-amber-50');
        expect(badge).toBeInTheDocument();
    });

    it('applies red color classes for failed status', () => {
        const { container } = render(<PostingBadge status="failed" />);
        const badge = container.querySelector('span.bg-red-50');
        expect(badge).toBeInTheDocument();
    });

    it('applies gray color classes for skipped status', () => {
        const { container } = render(<PostingBadge status="skipped" />);
        const badge = container.querySelector('span.bg-gray-50');
        expect(badge).toBeInTheDocument();
    });

    it('renders the badge with uppercase text styling', () => {
        const { container } = render(<PostingBadge status="posted" />);
        const badge = container.querySelector('span.uppercase');
        expect(badge).toBeInTheDocument();
    });

    it('renders a flex container when status is provided and valid', () => {
        const { container } = render(<PostingBadge status="posted" voucherNumber="JV-001" />);
        const flexContainer = container.querySelector('div.flex');
        expect(flexContainer).toBeInTheDocument();
    });

    it('voucher number is shown in monospace font with correct text', () => {
        render(<PostingBadge status="pending" voucherNumber="RV-00056" />);
        expect(screen.getByText('RV-00056')).toBeInTheDocument();
        expect(screen.getByText('RV-00056')).toHaveClass('font-mono');
    });
});
