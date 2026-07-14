import { render, screen } from '@testing-library/react';
import { StatusBadge, statusToneFor } from './StatusBadge';

describe('StatusBadge', () => {
    it('renders children text', () => {
        render(<StatusBadge tone="success">Active</StatusBadge>);
        expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('applies success tone classes', () => {
        render(<StatusBadge tone="success">Active</StatusBadge>);
        const badge = screen.getByText('Active');
        expect(badge).toHaveClass('bg-success-light');
        expect(badge).toHaveClass('text-success-text');
    });

    it('applies warning tone classes', () => {
        render(<StatusBadge tone="warning">Pending</StatusBadge>);
        const badge = screen.getByText('Pending');
        expect(badge).toHaveClass('bg-warning-light');
        expect(badge).toHaveClass('text-warning-text');
    });

    it('applies danger tone classes', () => {
        render(<StatusBadge tone="danger">Failed</StatusBadge>);
        const badge = screen.getByText('Failed');
        expect(badge).toHaveClass('bg-danger-light');
        expect(badge).toHaveClass('text-danger-text');
    });

    it('applies info tone classes', () => {
        render(<StatusBadge tone="info">New</StatusBadge>);
        const badge = screen.getByText('New');
        expect(badge).toHaveClass('bg-primary-light');
        expect(badge).toHaveClass('text-blue-700');
    });

    it('applies neutral tone classes', () => {
        render(<StatusBadge tone="neutral">Other</StatusBadge>);
        const badge = screen.getByText('Other');
        expect(badge).toHaveClass('bg-gray-100');
        expect(badge).toHaveClass('text-gray-600');
    });

    it('applies base pill classes', () => {
        render(<StatusBadge tone="success">Active</StatusBadge>);
        const badge = screen.getByText('Active');
        expect(badge).toHaveClass('inline-flex');
        expect(badge).toHaveClass('rounded-full');
        expect(badge).toHaveClass('text-xs');
        expect(badge).toHaveClass('font-medium');
    });

    it('merges additional className', () => {
        render(<StatusBadge tone="success" className="extra-class">Active</StatusBadge>);
        expect(screen.getByText('Active')).toHaveClass('extra-class');
    });
});

describe('statusToneFor', () => {
    it.each([
        ['active', 'success'],
        ['paid', 'success'],
        ['completed', 'success'],
        ['approved', 'success'],
        ['posted', 'success'],
        ['ACTIVE', 'success'],
    ])('maps %s to success', (status, expected) => {
        expect(statusToneFor(status)).toBe(expected);
    });

    it.each([
        ['pending', 'warning'],
        ['draft', 'warning'],
        ['processing', 'warning'],
        ['PENDING', 'warning'],
    ])('maps %s to warning', (status, expected) => {
        expect(statusToneFor(status)).toBe(expected);
    });

    it.each([
        ['overdue', 'danger'],
        ['failed', 'danger'],
        ['cancelled', 'danger'],
        ['rejected', 'danger'],
        ['lost', 'danger'],
        ['FAILED', 'danger'],
    ])('maps %s to danger', (status, expected) => {
        expect(statusToneFor(status)).toBe(expected);
    });

    it.each([
        ['new', 'info'],
        ['info', 'info'],
        ['NEW', 'info'],
    ])('maps %s to info', (status, expected) => {
        expect(statusToneFor(status)).toBe(expected);
    });

    it('maps unknown status to neutral', () => {
        expect(statusToneFor('something-else')).toBe('neutral');
    });
});
