import { render, screen, fireEvent } from '@testing-library/react';
import Button from './Button';

describe('Button', () => {
    it('renders children and defaults to primary variant + sm size', () => {
        render(<Button>Save</Button>);
        const btn = screen.getByRole('button', { name: 'Save' });
        expect(btn).toHaveClass('bg-primary');
        expect(btn).toHaveClass('hover:bg-primary-hover');
        expect(btn).toHaveClass('text-white');
        expect(btn).toHaveClass('px-3', 'py-1.5', 'text-xs');
        expect(btn).toHaveAttribute('type', 'button');
    });

    it('renders the secondary variant (existing gray outline)', () => {
        render(<Button variant="secondary">Cancel</Button>);
        const btn = screen.getByRole('button', { name: 'Cancel' });
        expect(btn).toHaveClass('border', 'border-gray-200', 'bg-white', 'text-gray-700');
    });

    it('renders the ghost variant', () => {
        render(<Button variant="ghost">Dismiss</Button>);
        const btn = screen.getByRole('button', { name: 'Dismiss' });
        expect(btn).toHaveClass('text-gray-600');
    });

    it('renders the danger variant', () => {
        render(<Button variant="danger">Delete</Button>);
        const btn = screen.getByRole('button', { name: 'Delete' });
        expect(btn).toHaveClass('bg-danger', 'text-white');
    });

    it('renders md size with larger padding/text', () => {
        render(<Button size="md">Continue</Button>);
        const btn = screen.getByRole('button', { name: 'Continue' });
        expect(btn).toHaveClass('px-4', 'py-2', 'text-sm');
    });

    it('applies shared shape classes across variants', () => {
        render(<Button>Save</Button>);
        const btn = screen.getByRole('button', { name: 'Save' });
        expect(btn).toHaveClass('rounded-md', 'font-semibold', 'inline-flex', 'items-center', 'gap-1.5', 'disabled:opacity-60', 'max-md:min-h-touch');
    });

    it('shows a spinner and disables the button when loading', () => {
        render(<Button loading>Save</Button>);
        const btn = screen.getByRole('button', { name: 'Save' });
        expect(btn).toBeDisabled();
        expect(screen.getByTestId('loader-icon')).toHaveClass('animate-spin');
    });

    it('does not fire onClick while loading', () => {
        const onClick = jest.fn();
        render(
            <Button loading onClick={onClick}>
                Save
            </Button>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(onClick).not.toHaveBeenCalled();
    });

    it('respects disabled prop independent of loading', () => {
        render(<Button disabled>Save</Button>);
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('renders an optional icon before the label', () => {
        render(<Button icon={<span data-testid="my-icon" />}>Save</Button>);
        const btn = screen.getByRole('button', { name: 'Save' });
        expect(screen.getByTestId('my-icon')).toBeInTheDocument();
        expect(btn.firstChild).toContainElement(screen.getByTestId('my-icon'));
    });

    it('keeps backward-compatible leftIcon prop', () => {
        render(<Button leftIcon={<span data-testid="left-icon" />}>Save</Button>);
        expect(screen.getByTestId('left-icon')).toBeInTheDocument();
    });

    it('forwards ref to the underlying button element', () => {
        const ref = { current: null as HTMLButtonElement | null };
        render(<Button ref={ref}>Save</Button>);
        expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    });

    it('merges custom className with variant classes', () => {
        render(<Button className="w-full">Save</Button>);
        expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('w-full', 'bg-primary');
    });

    it('spreads other native button props', () => {
        render(<Button data-testid="submit-btn">Save</Button>);
        expect(screen.getByTestId('submit-btn')).toBeInTheDocument();
    });
});
