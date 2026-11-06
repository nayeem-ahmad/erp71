import { render, screen } from '@testing-library/react';
import SupportMessageBody from './SupportMessageBody';

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ href, children, ...props }: { href: string; children: unknown; [key: string]: unknown }) => (
        <a href={href} {...props}>
            {children as never}
        </a>
    ),
}));

describe('SupportMessageBody', () => {
    it('renders markdown instead of literal syntax', async () => {
        render(<SupportMessageBody body={'**Stuck on print**\n\n- jammed\n- offline'} />);
        expect(await screen.findByText('Stuck on print')).toBeInTheDocument();
        expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
            'jammed',
            'offline',
        ]);
        expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
    });

    it('tints marks for a primary (blue) bubble', async () => {
        const { container } = render(
            <SupportMessageBody body="See the [docs](https://example.com)." onPrimary />,
        );
        await screen.findByRole('link', { name: 'docs' });
        expect(container.firstChild).toHaveClass('[&_a]:text-blue-100');
    });
});
