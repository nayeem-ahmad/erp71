import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AiDraftModal from './AiDraftModal';

const LABELS = {
    modalTitle: 'Draft with AI',
    promptLabel: 'What should this post be about?',
    promptPlaceholder: 'Five ways to cut dead stock',
    generate: 'Generate',
    cancel: 'Cancel',
};

function setup(overrides: Partial<React.ComponentProps<typeof AiDraftModal>> = {}) {
    const props = {
        open: true,
        prompt: '',
        loading: false,
        labels: LABELS,
        onPromptChange: jest.fn(),
        onClose: jest.fn(),
        onGenerate: jest.fn(),
        ...overrides,
    };
    render(<AiDraftModal {...props} />);
    return props;
}

describe('AiDraftModal', () => {
    it('renders nothing when closed', () => {
        setup({ open: false });

        expect(screen.queryByText('Draft with AI')).not.toBeInTheDocument();
    });

    // Generating on an empty prompt spends credits to produce a post about
    // nothing, so the button is the guard rather than a server-side check.
    it('disables Generate until there is a prompt', () => {
        setup({ prompt: '   ' });

        expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
    });

    it('enables Generate once the prompt has content', () => {
        setup({ prompt: 'dead stock' });

        expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled();
    });

    it('reports what the author types without holding it itself', () => {
        const props = setup({ prompt: 'dead' });

        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'dead stock' } });

        expect(props.onPromptChange).toHaveBeenCalledWith('dead stock');
    });

    it('calls onGenerate when Generate is clicked', () => {
        const props = setup({ prompt: 'dead stock' });

        fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

        expect(props.onGenerate).toHaveBeenCalled();
    });

    it('calls onClose when Cancel is clicked', () => {
        const props = setup({ prompt: 'dead stock' });

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(props.onClose).toHaveBeenCalled();
    });

    it('blocks a second submit while a generation is in flight', () => {
        const props = setup({ prompt: 'dead stock', loading: true });

        const generate = screen.getByRole('button', { name: 'Generate' });
        expect(generate).toBeDisabled();

        fireEvent.click(generate);

        expect(props.onGenerate).not.toHaveBeenCalled();
        expect(screen.getByRole('textbox')).toBeDisabled();
    });
});
