import { render, screen } from '@testing-library/react';
import { Alert } from './Alert';

describe('Alert', () => {
    it('renders children content', () => {
        render(<Alert tone="info">Something happened</Alert>);
        expect(screen.getByText('Something happened')).toBeInTheDocument();
    });

    it('renders optional title', () => {
        render(<Alert tone="info" title="Heads up">Details here</Alert>);
        expect(screen.getByText('Heads up')).toBeInTheDocument();
        expect(screen.getByText('Details here')).toBeInTheDocument();
    });

    it('does not render a title element when title is omitted', () => {
        const { container } = render(<Alert tone="info">No title</Alert>);
        expect(container.querySelector('.font-semibold')).not.toBeInTheDocument();
    });

    it('applies base classes', () => {
        render(<Alert tone="info">Body</Alert>);
        const alert = screen.getByRole('status');
        expect(alert).toHaveClass('rounded-md');
        expect(alert).toHaveClass('border');
        expect(alert).toHaveClass('p-3');
        expect(alert).toHaveClass('text-sm');
    });

    it('uses role="status" for info tone', () => {
        render(<Alert tone="info">Body</Alert>);
        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('uses role="status" for success tone', () => {
        render(<Alert tone="success">Body</Alert>);
        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('uses role="alert" for warning tone', () => {
        render(<Alert tone="warning">Body</Alert>);
        expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('uses role="alert" for danger tone', () => {
        render(<Alert tone="danger">Body</Alert>);
        expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('applies info tone tint classes', () => {
        render(<Alert tone="info">Body</Alert>);
        const alert = screen.getByRole('status');
        expect(alert).toHaveClass('bg-primary-light');
    });

    it('applies success tone tint classes', () => {
        render(<Alert tone="success">Body</Alert>);
        const alert = screen.getByRole('status');
        expect(alert).toHaveClass('bg-success-light');
        expect(alert).toHaveClass('text-success-text');
    });

    it('applies warning tone tint classes', () => {
        render(<Alert tone="warning">Body</Alert>);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveClass('bg-warning-light');
        expect(alert).toHaveClass('text-warning-text');
    });

    it('applies danger tone tint classes', () => {
        render(<Alert tone="danger">Body</Alert>);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveClass('bg-danger-light');
        expect(alert).toHaveClass('text-danger-text');
    });

    it('renders an icon', () => {
        const { container } = render(<Alert tone="danger">Body</Alert>);
        expect(container.querySelector('[data-testid$="-icon"]')).toBeInTheDocument();
    });

    it('merges additional className', () => {
        render(<Alert tone="info" className="extra-class">Body</Alert>);
        expect(screen.getByRole('status')).toHaveClass('extra-class');
    });
});
