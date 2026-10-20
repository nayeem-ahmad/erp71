import { fireEvent, render, screen } from '@testing-library/react';
import { RowActionButton, RowActions } from './RowActions';

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}));

describe('RowActions', () => {
    it('names each icon for a screen reader and its tooltip', () => {
        render(<RowActionButton icon={<svg />} label="Print" onClick={() => {}} />);
        const button = screen.getByRole('button', { name: 'Print' });
        expect(button).toHaveAttribute('title', 'Print');
    });

    it('rests every intent in the same gray and colours it by intent on hover', () => {
        render(
            <RowActions>
                <RowActionButton icon={<svg />} label="View" href="/x" />
                <RowActionButton icon={<svg />} label="Delete" intent="danger" onClick={() => {}} />
                <RowActionButton icon={<svg />} label="Convert" intent="success" onClick={() => {}} />
            </RowActions>,
        );
        const view = screen.getByRole('link', { name: 'View' });
        const del = screen.getByRole('button', { name: 'Delete' });
        const convert = screen.getByRole('button', { name: 'Convert' });
        for (const el of [view, del, convert]) expect(el).toHaveClass('text-gray-500');
        expect(view).toHaveClass('hover:text-blue-600');
        expect(del).toHaveClass('hover:text-red-600');
        expect(convert).toHaveClass('hover:text-emerald-600');
    });

    it('navigates with href and acts with onClick', () => {
        const onClick = jest.fn();
        render(
            <>
                <RowActionButton icon={<svg />} label="Open" href="/orders/1" />
                <RowActionButton icon={<svg />} label="Act" onClick={onClick} />
            </>,
        );
        expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/orders/1');
        fireEvent.click(screen.getByRole('button', { name: 'Act' }));
        expect(onClick).toHaveBeenCalled();
    });

    it('shows a disabled action dimmed and inert', () => {
        render(<RowActionButton icon={<svg />} label="Edit" disabled onClick={() => {}} />);
        const edit = screen.getByRole('button', { name: 'Edit' });
        expect(edit).toHaveAttribute('aria-disabled', 'true');
        expect(edit).toHaveClass('text-gray-300');
    });

    it('centres the gutter', () => {
        const { container } = render(<RowActions><span /></RowActions>);
        expect(container.firstChild).toHaveClass('justify-center');
    });
});
