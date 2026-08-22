'use client';

import { useEffect, useState } from 'react';
import { Languages, Sparkles } from 'lucide-react';
import ModalShell from '@/components/ModalShell';
import { Button, Checkbox, Field, Select, Textarea } from '@/components/ui';

export type AiDraftLanguage = {
    code: string;
    label: string;
    /** Already carries a title and a body in the editor. */
    filled: boolean;
};

export type AiDraftLabels = {
    modalTitle: string;
    promptLabel: string;
    promptPlaceholder: string;
    generate: string;
    cancel: string;
    /** Multilingual editors only — omitted where there is one language. */
    modeWrite?: string;
    modeTranslate?: string;
    languages?: string;
    languagesHint?: string;
    translateFrom?: string;
    translateInto?: string;
    translateAction?: string;
    translateHint?: string;
    nothingToTranslate?: string;
    alreadyWritten?: string;
};

export type AiDraftModalProps = {
    open: boolean;
    prompt: string;
    loading: boolean;
    labels: AiDraftLabels;
    /**
     * Supplied by an editor that keeps a post in several languages. Without it
     * the modal is exactly what it always was — a brief and a Generate button.
     */
    languages?: {
        options: AiDraftLanguage[];
        /** The tab the author has open; what a generation defaults to filling. */
        current: string;
    };
    onPromptChange: (value: string) => void;
    onClose: () => void;
    onGenerate: (locales?: string[]) => void;
    onTranslate?: (options: { source: string; targets: string[] }) => void;
};

/**
 * The editors' AI Assistant: write a post from a brief, or carry a post the
 * author has already written into the other languages.
 *
 * Translating is a separate mode rather than "generate again on the other tab"
 * because those are different things. Generating twice produces two articles
 * that happen to share a slug — different arguments, different examples — and
 * spends a full generation to do it. Once a language tab has words in it, the
 * author almost always wants those words in another language, not a second
 * opinion, so the mode flips itself on as soon as anything is written.
 *
 * Deliberately knows nothing about posts: the prompt lives in the parent's
 * state and the parent makes its own call, which is what lets the platform
 * editor and the tenant editor — different endpoints, different field sets —
 * share one modal. It also means the prompt survives a locale-tab switch.
 */
export default function AiDraftModal({
    open,
    prompt,
    loading,
    labels,
    languages,
    onPromptChange,
    onClose,
    onGenerate,
    onTranslate,
}: AiDraftModalProps) {
    const options = languages?.options ?? [];
    const current = languages?.current ?? '';
    const written = options.filter((option) => option.filled).map((option) => option.code);
    const canTranslate = written.length > 0 && !!onTranslate;

    const otherThan = (code: string) =>
        options.map((option) => option.code).filter((option) => option !== code);

    const [mode, setMode] = useState<'generate' | 'translate'>('generate');
    const [targets, setTargets] = useState<string[]>(current ? [current] : []);
    const [source, setSource] = useState('');

    // Re-seeded every time the modal opens: which languages to fill is a choice
    // about this run, not a setting the author expects to persist. Opening on a
    // post that already has copy starts in translate mode — that is the reason
    // the author reopened the assistant.
    useEffect(() => {
        if (!open) return;
        const from = written.includes(current) ? current : written[0] ?? '';
        setSource(from);
        setMode(canTranslate ? 'translate' : 'generate');
        setTargets(canTranslate ? otherThan(from) : current ? [current] : []);
        // `written`/`options` are rebuilt on every parent render (the prompt is
        // parent state), so they cannot be dependencies without resetting the
        // selection on each keystroke.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, current]);

    if (!open) return null;

    function chooseMode(next: 'generate' | 'translate') {
        setMode(next);
        setTargets(next === 'translate' ? otherThan(source) : current ? [current] : []);
    }

    function chooseSource(next: string) {
        setSource(next);
        setTargets(otherThan(next));
    }

    function toggleTarget(code: string) {
        setTargets((rows) => (rows.includes(code) ? rows.filter((row) => row !== code) : [...rows, code]));
    }

    const translating = mode === 'translate';
    const choices = translating ? options.filter((option) => option.code !== source) : options;
    const canSubmit = translating
        ? !loading && !!source && targets.length > 0
        : !loading && prompt.trim().length > 0 && (!languages || targets.length > 0);

    /**
     * Ticking boxes has no inherent order, but the first language sent is the
     * one written from the brief — so it is settled here rather than left to
     * the order the author happened to click in: the tab they are looking at
     * leads, and the rest follow the order they are listed in.
     */
    function chosen(): string[] {
        const listed = options.map((option) => option.code).filter((code) => targets.includes(code));
        return targets.includes(current) ? [current, ...listed.filter((code) => code !== current)] : listed;
    }

    function submit() {
        if (!canSubmit) return;
        if (translating) onTranslate?.({ source, targets: chosen() });
        else onGenerate(languages ? chosen() : undefined);
    }

    return (
        <ModalShell size="md" onBackdropClick={loading ? undefined : onClose}>
            <div className="flex items-center gap-2 border-b border-gray-100 p-3 md:p-4">
                {translating ? (
                    <Languages className="h-4 w-4 text-blue-600" />
                ) : (
                    <Sparkles className="h-4 w-4 text-blue-600" />
                )}
                <h2 className="text-sm font-semibold text-gray-900">{labels.modalTitle}</h2>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-3 md:p-4">
                {languages && onTranslate && (
                    <div className="flex flex-wrap items-center gap-1">
                        <Button
                            variant={translating ? 'ghost' : 'secondary'}
                            onClick={() => chooseMode('generate')}
                            disabled={loading}
                        >
                            {labels.modeWrite}
                        </Button>
                        <Button
                            variant={translating ? 'secondary' : 'ghost'}
                            onClick={() => chooseMode('translate')}
                            disabled={loading || !canTranslate}
                        >
                            {labels.modeTranslate}
                        </Button>
                        {!canTranslate && (
                            <span className="text-xs text-gray-400">{labels.nothingToTranslate}</span>
                        )}
                    </div>
                )}

                {translating ? (
                    <Field label={labels.translateFrom} htmlFor="ai-draft-source" hint={labels.translateHint}>
                        <Select
                            id="ai-draft-source"
                            value={source}
                            disabled={loading}
                            onChange={(event) => chooseSource(event.target.value)}
                        >
                            {options
                                .filter((option) => option.filled)
                                .map((option) => (
                                    <option key={option.code} value={option.code}>
                                        {option.label}
                                    </option>
                                ))}
                        </Select>
                    </Field>
                ) : (
                    <Field label={labels.promptLabel} htmlFor="ai-draft-prompt">
                        <Textarea
                            id="ai-draft-prompt"
                            rows={4}
                            autoFocus
                            disabled={loading}
                            value={prompt}
                            placeholder={labels.promptPlaceholder}
                            onChange={(event) => onPromptChange(event.target.value)}
                        />
                    </Field>
                )}

                {languages && (
                    <Field
                        label={translating ? labels.translateInto : labels.languages}
                        hint={translating ? undefined : labels.languagesHint}
                    >
                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                            {choices.map((option) => (
                                <label
                                    key={option.code}
                                    className="inline-flex items-center gap-2 text-xs text-gray-700 max-md:min-h-touch"
                                >
                                    <Checkbox
                                        checked={targets.includes(option.code)}
                                        disabled={loading}
                                        onChange={() => toggleTarget(option.code)}
                                    />
                                    {option.label}
                                    {option.filled && (
                                        <span className="text-gray-400">{labels.alreadyWritten}</span>
                                    )}
                                </label>
                            ))}
                        </div>
                    </Field>
                )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 p-3 md:p-4">
                <Button variant="ghost" onClick={onClose} disabled={loading}>
                    {labels.cancel}
                </Button>
                <Button onClick={submit} disabled={!canSubmit} loading={loading}>
                    {translating ? labels.translateAction : labels.generate}
                </Button>
            </div>
        </ModalShell>
    );
}
