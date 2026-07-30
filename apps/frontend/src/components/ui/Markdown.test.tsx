import { fireEvent, render, screen } from '@testing-library/react';
import Markdown from './Markdown';

// next/link needs the App Router runtime to navigate; a plain anchor keeps the
// test focused on Markdown's internal-vs-external routing decision.
jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ href, children, ...props }: { href: string; children: unknown; [key: string]: unknown }) => (
        <a href={href} {...props}>
            {children as never}
        </a>
    ),
}));

describe('Markdown', () => {
    it('renders headings, emphasis and lists as elements rather than literal syntax', () => {
        const { container } = render(
            <Markdown
                content={[
                    '## Top Customer',
                    '',
                    '**LifeTech Medical** leads at ৳5.27L.',
                    '',
                    '- 32 orders',
                    '- 4.9% share',
                ].join('\n')}
            />,
        );

        expect(screen.getByRole('heading', { name: 'Top Customer' })).toBeInTheDocument();
        expect(container.querySelector('strong')).toHaveTextContent('LifeTech Medical');
        expect(screen.getAllByRole('listitem')).toHaveLength(2);
        expect(container.textContent).not.toContain('**');
        expect(container.textContent).not.toContain('##');
    });

    /** GFM tables are the main reason the assistant needs markdown at all. */
    it('renders a GFM table with header cells and a scroll container', () => {
        const { container } = render(
            <Markdown
                content={[
                    '| Customer | Revenue |',
                    '|----------|---------|',
                    '| LifeTech | ৳5.27L  |',
                    '| Careforce | ৳3.06L |',
                ].join('\n')}
            />,
        );

        expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Customer', 'Revenue']);
        expect(screen.getAllByRole('row')).toHaveLength(3);
        // Wide tables must scroll inside the bubble, not widen the panel.
        expect(container.querySelector('table')?.parentElement).toHaveClass('overflow-x-auto');
    });

    it('keeps the column alignment GFM asks for', () => {
        render(
            <Markdown
                content={['| Item | Amount |', '|:-----|-------:|', '| Sales | ৳100 |'].join('\n')}
            />,
        );

        expect(screen.getAllByRole('columnheader')[1]).toHaveStyle({ textAlign: 'right' });
    });

    /** The content is model output built partly from tenant-controlled strings. */
    it('does not render raw HTML from the content', () => {
        const { container } = render(
            <Markdown content={'<img src="x" onerror="alert(1)"><b>bold</b> plain'} />,
        );

        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('b')).toBeNull();
        expect(container.innerHTML).not.toContain('onerror');
    });

    it('drops markdown images but keeps links safe for a new tab', () => {
        const { container } = render(
            <Markdown content={'![logo](https://evil.example/pixel.png) see [the report](https://erp71.com/r)'} />,
        );

        expect(container.querySelector('img')).toBeNull();
        const link = screen.getByRole('link', { name: 'the report' });
        expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
        expect(link).toHaveAttribute('target', '_blank');
    });

    /**
     * A path the assistant links to is an in-app route, so it must navigate in
     * the same tab (a client-side link), not open a new one like a web citation.
     */
    it('renders an in-app path as a same-tab link and fires onNavigate on click', () => {
        const onNavigate = jest.fn();
        render(<Markdown content={'See [the sales summary](/sales/reports/summary).'} onNavigate={onNavigate} />);

        const link = screen.getByRole('link', { name: 'the sales summary' });
        expect(link).toHaveAttribute('href', '/sales/reports/summary');
        expect(link).not.toHaveAttribute('target', '_blank');

        fireEvent.click(link);
        expect(onNavigate).toHaveBeenCalledTimes(1);
    });

    /** A protocol-relative "//host" leaves the app, so it is treated as external. */
    it('treats a protocol-relative link as external, not in-app', () => {
        render(<Markdown content={'[off site](//evil.example/x)'} />);

        expect(screen.getByRole('link', { name: 'off site' })).toHaveAttribute('target', '_blank');
    });

    it('neutralises a javascript: link', () => {
        const { container } = render(<Markdown content={'[click](javascript:alert(1))'} />);

        // react-markdown strips the unsafe protocol, leaving an inert anchor.
        expect(container.querySelector('a')?.getAttribute('href')).not.toContain('javascript:');
    });

    /** The mdast node must not be spread onto the DOM as an attribute. */
    it('does not leak the internal node prop into the markup', () => {
        const { container } = render(<Markdown content={'**hi** and `code`\n\n- one'} />);

        expect(container.innerHTML).not.toContain('node=');
    });
});
