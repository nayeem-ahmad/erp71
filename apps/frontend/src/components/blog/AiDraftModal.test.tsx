import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AiDraftModal from './AiDraftModal';

const LABELS = {
    modalTitle: 'Draft with AI',
    promptLabel: 'What should this post be about?',
    promptPlaceholder: 'Five ways to cut dead stock',
    generate: 'Generate',
    cancel: 'Cancel',
    modeWrite: 'Write new',
    modeTranslate: 'Translate existing',
    languages: 'Languages',
    languagesHint: 'The first language is written from your brief.',
    translateFrom: 'Translate from',
    translateInto: 'Translate into',
    translateAction: 'Translate',
    translateHint: 'Only the language tabs change.',
    nothingToTranslate: 'Write a post in one language first.',
    alreadyWritten: '(already written)',
};

function languages(filled: string[] = [], current = 'en') {
    return {
        options: [
            { code: 'en', label: 'English', filled: filled.includes('en') },
            { code: 'bn', label: 'বাংলা', filled: filled.includes('bn') },
            { code: 'ms', label: 'Bahasa Melayu', filled: filled.includes('ms') },
        ],
        current,
    };
}

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
    const view = render(<AiDraftModal {...props} />);
    return { ...props, rerender: (next: Partial<React.ComponentProps<typeof AiDraftModal>>) =>
        view.rerender(<AiDraftModal {...props} {...next} />) };
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

    /** A single-language editor gets exactly the modal it always had. */
    it('offers no language choice when the editor keeps one language', () => {
        setup({ prompt: 'dead stock' });

        expect(screen.queryByText('Languages')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Translate' })).not.toBeInTheDocument();
    });
});

describe('AiDraftModal — several languages', () => {
    it('defaults to the tab the author has open', () => {
        setup({ prompt: 'dead stock', languages: languages([], 'bn'), onTranslate: jest.fn() });

        expect(screen.getByRole('checkbox', { name: /বাংলা/ })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: /English/ })).not.toBeChecked();
    });

    it('sends every language the author ticked', () => {
        const props = setup({ prompt: 'dead stock', languages: languages(), onTranslate: jest.fn() });

        fireEvent.click(screen.getByRole('checkbox', { name: /বাংলা/ }));
        fireEvent.click(screen.getByRole('checkbox', { name: /Bahasa Melayu/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

        expect(props.onGenerate).toHaveBeenCalledWith(['en', 'bn', 'ms']);
    });

    /**
     * The first language is the one written from the brief and the rest are
     * translated from it, so which one leads is not a detail: it must be the
     * tab the author is looking at, not whichever box they clicked first.
     */
    it('leads with the open tab whatever order the boxes were ticked in', () => {
        const props = setup({ prompt: 'dead stock', languages: languages([], 'bn'), onTranslate: jest.fn() });

        fireEvent.click(screen.getByRole('checkbox', { name: /Bahasa Melayu/ }));
        fireEvent.click(screen.getByRole('checkbox', { name: /English/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

        expect(props.onGenerate).toHaveBeenCalledWith(['bn', 'en', 'ms']);
    });

    it('will not generate into no language at all', () => {
        setup({ prompt: 'dead stock', languages: languages(), onTranslate: jest.fn() });

        fireEvent.click(screen.getByRole('checkbox', { name: /English/ }));

        expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
    });

    /**
     * The point of the feature: once a language has words in it, the author
     * almost always wants those words in the other languages rather than a
     * second, differently-argued article about the same subject.
     */
    it('opens in translate mode when a language is already written', () => {
        setup({ prompt: '', languages: languages(['en']), onTranslate: jest.fn() });

        expect(screen.getByRole('button', { name: 'Translate' })).toBeEnabled();
        expect(screen.getByLabelText('Translate from')).toHaveValue('en');
        expect(screen.queryByLabelText('What should this post be about?')).not.toBeInTheDocument();
    });

    it('translates into the other languages without asking for a brief', () => {
        const props = setup({ prompt: '', languages: languages(['en']), onTranslate: jest.fn() });

        fireEvent.click(screen.getByRole('button', { name: 'Translate' }));

        expect(props.onTranslate).toHaveBeenCalledWith({ source: 'en', targets: ['bn', 'ms'] });
    });

    it('never offers to translate a language into itself', () => {
        setup({ prompt: '', languages: languages(['en', 'bn'], 'bn'), onTranslate: jest.fn() });

        expect(screen.getByLabelText('Translate from')).toHaveValue('bn');
        expect(screen.queryByRole('checkbox', { name: /বাংলা/ })).not.toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: /English/ })).toBeInTheDocument();
    });

    it('only offers a written language as the source', () => {
        setup({ prompt: '', languages: languages(['bn']), onTranslate: jest.fn() });

        const source = screen.getByLabelText('Translate from');
        expect(Array.from(source.querySelectorAll('option')).map((option) => option.value)).toEqual(['bn']);
    });

    it('marks a target that already has content, so the author knows what they would replace', () => {
        setup({ prompt: '', languages: languages(['en', 'ms']), onTranslate: jest.fn() });

        expect(screen.getByRole('checkbox', { name: /Bahasa Melayu.*already written/ })).toBeInTheDocument();
    });

    // Nothing written yet is the one case where generating is the only option.
    it('offers writing only until something has been written', () => {
        setup({ prompt: 'dead stock', languages: languages(), onTranslate: jest.fn() });

        expect(screen.getByRole('button', { name: 'Translate existing' })).toBeDisabled();
        expect(screen.getByText('Write a post in one language first.')).toBeInTheDocument();
        expect(screen.getByLabelText('What should this post be about?')).toBeInTheDocument();
    });

    it('goes back to writing a new post on request', () => {
        const props = setup({ prompt: 'a different angle', languages: languages(['en']), onTranslate: jest.fn() });

        fireEvent.click(screen.getByRole('button', { name: 'Write new' }));
        expect(screen.getByLabelText('What should this post be about?')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

        expect(props.onGenerate).toHaveBeenCalledWith(['en']);
        expect(props.onTranslate).not.toHaveBeenCalled();
    });

    /**
     * The selection is a choice about this run. Carrying it over would silently
     * translate into a language the author picked ten minutes ago for something
     * else.
     */
    it('re-seeds the selection each time it is opened', () => {
        const { rerender } = setup({ prompt: '', languages: languages([], 'en'), onTranslate: jest.fn() });

        fireEvent.click(screen.getByRole('checkbox', { name: /বাংলা/ }));
        expect(screen.getByRole('checkbox', { name: /বাংলা/ })).toBeChecked();

        rerender({ open: false });
        rerender({ open: true });

        expect(screen.getByRole('checkbox', { name: /বাংলা/ })).not.toBeChecked();
        expect(screen.getByRole('checkbox', { name: /English/ })).toBeChecked();
    });
});
