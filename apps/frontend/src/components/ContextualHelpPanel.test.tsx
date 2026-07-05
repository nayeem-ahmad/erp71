import { fireEvent, render, screen } from '@testing-library/react';
import { PlatformFeaturesProvider } from '@/contexts/PlatformFeaturesContext';
import { ContextualHelpPanel } from './ContextualHelpPanel';

function renderHelp(features?: { help?: boolean }) {
    return render(
        <PlatformFeaturesProvider features={{ feedback: false, support: false, help: true, voice: false, manufacturing: true, ...features }}>
            <ContextualHelpPanel {...HELP} />
        </PlatformFeaturesProvider>,
    );
}

jest.mock('next/link', () => ({
    __esModule: true,
    default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const HELP = {
    panelKey: 'help-dismissed-test-panel',
    title: 'Test quick guide',
    summary: 'Summary for testers.',
    steps: ['Step one', 'Step two'],
    learnMoreHref: '/help',
};

describe('ContextualHelpPanel', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('renders nothing when help feature is disabled', () => {
        const { container } = renderHelp({ help: false });
        expect(container).toBeEmptyDOMElement();
    });

    it('renders summary and steps', () => {
        renderHelp();
        expect(screen.getByText('Test quick guide')).toBeInTheDocument();
        expect(screen.getByText('Summary for testers.')).toBeInTheDocument();
        expect(screen.getByText('Step one')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /more in help center/i })).toHaveAttribute('href', '/help');
    });

    it('dismisses and can be restored', () => {
        renderHelp();
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss help' }));
        expect(screen.queryByText('Summary for testers.')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /show test quick guide/i }));
        expect(screen.getByText('Summary for testers.')).toBeInTheDocument();
    });

    it('collapses step list', () => {
        renderHelp();
        fireEvent.click(screen.getByRole('button', { name: 'Collapse help' }));
        expect(screen.queryByText('Step one')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Expand help' }));
        expect(screen.getByText('Step one')).toBeInTheDocument();
    });
});