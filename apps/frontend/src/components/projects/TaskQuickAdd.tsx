'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Input, Select } from '@/components/ui';
import AnchoredDropdown from '@/components/document-entry/AnchoredDropdown';
import { parseQuickAdd, type QuickAddVocabulary } from './task-quick-add';

/** The sigils the grammar understands, and what each one offers. */
const SIGILS = ['@', '#', '!', '~', '>'] as const;
type Sigil = (typeof SIGILS)[number];

const PRIORITY_VALUES = ['low', 'medium', 'high', 'urgent'];
const DUE_VALUES = ['today', 'tomorrow', '3d', 'friday'];

/**
 * The word the caret sits in, if it starts with a sigil.
 *
 * Suggestions follow the caret rather than the end of the line, so going back
 * to fix `@raf` in the middle of a title still offers the roster.
 */
export function tokenAtCaret(
    value: string,
    caret: number,
): { sigil: Sigil; query: string; from: number; to: number } | null {
    const before = value.slice(0, caret);
    const start = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n')) + 1;
    const word = before.slice(start);
    if (!word) return null;
    const sigil = word[0] as Sigil;
    if (!SIGILS.includes(sigil)) return null;
    // A space closes a token, so `@rafi more words` stops suggesting.
    const rest = value.slice(caret);
    const end = caret + (rest.search(/\s/) === -1 ? rest.length : rest.search(/\s/));
    return { sigil, query: word.slice(1), from: start, to: end };
}

export interface QuickAddProject {
    id: string;
    code: string;
    name: string;
}

export interface QuickAddLabels {
    placeholder: string;
    hint: string;
    project: string;
    selectProject: string;
    add: string;
    more: string;
    noProjects: string;
}

/**
 * "Add a task" as one line, the way `BoardCardComposer` already does it at the
 * foot of every board column.
 *
 * The point is that the common case — capture a title and move on — costs one
 * keystroke and no modal. Focus stays in the box after a save, so a run of ten
 * tasks is ten lines rather than ten dialogs. The full modal is still one click
 * away for the times somebody is carefully filing a single task.
 *
 * Detail rides in the same line as tokens (`@rafi #bug !high ~3h >friday`),
 * parsed by `task-quick-add.ts` — which never swallows a word it could not
 * resolve, so a title containing an address or a hex colour survives intact.
 */
export default function TaskQuickAdd({
    projects,
    projectId,
    onProjectChange,
    vocabulary,
    labels,
    onCreate,
    onOpenFull,
    busy,
}: {
    projects: QuickAddProject[];
    projectId: string;
    onProjectChange: (next: string) => void;
    vocabulary: Omit<QuickAddVocabulary, 'now'>;
    labels: QuickAddLabels;
    onCreate: (task: ReturnType<typeof parseQuickAdd>) => Promise<void>;
    onOpenFull: () => void;
    busy?: boolean;
}) {
    const [value, setValue] = useState('');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    /**
     * What the caret is in the middle of typing, and which suggestion is
     * highlighted. The grammar has always worked; it was only ever discoverable
     * from a hint line listing the five sigils, so nobody learned the
     * vocabulary — which names exist, which labels, what `>3d` means.
     *
     * `parseQuickAdd` is untouched. This only shows what it would resolve; an
     * unmatched token still stays in the title, which is the rule that makes
     * the grammar safe to type into.
     */
    const [token, setToken] = useState<ReturnType<typeof tokenAtCaret>>(null);
    const [active, setActive] = useState(0);

    const suggestions = useMemo(() => {
        if (!token) return [];
        const needle = token.query.toLowerCase();
        const match = (name: string) => name.toLowerCase().includes(needle);
        if (token.sigil === '@') {
            return vocabulary.assignees.filter((person) => match(person.name)).slice(0, 8)
                .map((person) => ({ insert: person.name.split(/\s+/)[0], label: person.name }));
        }
        if (token.sigil === '#') {
            return vocabulary.labels.filter((label) => match(label.name)).slice(0, 8)
                .map((label) => ({ insert: label.name.replace(/\s+/g, ''), label: label.name }));
        }
        if (token.sigil === '!') {
            return PRIORITY_VALUES.filter(match).map((p) => ({ insert: p, label: p }));
        }
        if (token.sigil === '>') {
            return DUE_VALUES.filter(match).map((d) => ({ insert: d, label: d }));
        }
        return [];
    }, [token, vocabulary]);

    useEffect(() => setActive(0), [token?.sigil, token?.query]);

    /** Replaces the token under the caret with the picked value. */
    const accept = (insert: string) => {
        if (!token) return;
        const next = `${value.slice(0, token.from)}${token.sigil}${insert} ${value.slice(token.to)}`;
        setValue(next);
        setToken(null);
        const caret = token.from + insert.length + 2;
        requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.setSelectionRange(caret, caret);
        });
    };

    const readToken = (element: HTMLInputElement) =>
        setToken(tokenAtCaret(element.value, element.selectionStart ?? element.value.length));

    /**
     * Refocusing after a save has to wait for the render that re-enables the
     * input — `focus()` on a disabled element is a no-op, so calling it inside
     * the save left the caret nowhere and the next task needed a click.
     */
    useEffect(() => {
        if (saved > 0) inputRef.current?.focus();
    }, [saved]);

    // Parsed on every keystroke so the hint row can say what will be applied
    // before the user commits — a token that silently did nothing is the one
    // failure mode this grammar has.
    const parsed = useMemo(() => parseQuickAdd(value, vocabulary), [value, vocabulary]);
    const canSave = parsed.title.trim().length > 0 && Boolean(projectId) && !saving && !busy;

    const submit = async () => {
        if (!canSave) return;
        setSaving(true);
        try {
            await onCreate(parsed);
            setValue('');
            // Kept focused: the next task is almost always the reason somebody
            // is on this row at all. Done in an effect, not here — see above.
            setSaved((count) => count + 1);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="rounded-md border border-gray-200 bg-white p-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
                {projects.length > 1 && (
                    <Select
                        aria-label={labels.project}
                        value={projectId}
                        disabled={saving}
                        onChange={(event) => onProjectChange(event.target.value)}
                        className="md:w-56"
                    >
                        <option value="">{labels.selectProject}</option>
                        {projects.map((project) => (
                            <option key={project.id} value={project.id}>
                                {project.code} · {project.name}
                            </option>
                        ))}
                    </Select>
                )}

                <Input
                    ref={inputRef}
                    aria-label={labels.placeholder}
                    placeholder={labels.placeholder}
                    value={value}
                    disabled={saving || projects.length === 0}
                    className="flex-1"
                    onChange={(event) => {
                        setValue(event.target.value);
                        readToken(event.currentTarget);
                    }}
                    onClick={(event) => readToken(event.currentTarget)}
                    onBlur={() => setToken(null)}
                    onKeyDown={(event) => {
                        const open = suggestions.length > 0;
                        if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                            event.preventDefault();
                            const step = event.key === 'ArrowDown' ? 1 : -1;
                            setActive((i) => (i + step + suggestions.length) % suggestions.length);
                            return;
                        }
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            // Enter completes the token being typed; only once
                            // there is nothing to complete does it save.
                            if (open) accept(suggestions[active].insert);
                            else void submit();
                            return;
                        }
                        if (event.key === 'Tab' && open) {
                            event.preventDefault();
                            accept(suggestions[active].insert);
                            return;
                        }
                        if (event.key === 'Escape') {
                            // Kept off the document: a page-level handler would
                            // read it as something else entirely.
                            event.stopPropagation();
                            // Dismisses the suggestions first; a second Escape
                            // clears the line, which is the old behaviour.
                            if (open) setToken(null);
                            else setValue('');
                        }
                    }}
                />

                <div className="flex items-center gap-2">
                    <Button
                        type="button"
                        className="min-h-touch"
                        disabled={!canSave}
                        onClick={() => void submit()}
                    >
                        <Plus className="h-4 w-4" aria-hidden />
                        {labels.add}
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        className="min-h-touch"
                        onClick={onOpenFull}
                    >
                        {labels.more}
                    </Button>
                </div>
            </div>

            {suggestions.length > 0 && (
                <AnchoredDropdown
                    anchorRef={inputRef}
                    panelRef={panelRef}
                    matchAnchorWidth={false}
                    maxHeight={240}
                    className="min-w-56 border-gray-200 p-1"
                    role="listbox"
                    aria-label={labels.placeholder}
                >
                    {suggestions.map((suggestion, index) => (
                        <button
                            key={suggestion.label}
                            type="button"
                            role="option"
                            aria-selected={index === active}
                            // Mouse down, not click: the input's blur would
                            // close the panel before a click ever landed.
                            onMouseDown={(event) => {
                                event.preventDefault();
                                accept(suggestion.insert);
                            }}
                            onMouseEnter={() => setActive(index)}
                            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm ${
                                index === active ? 'bg-blue-50' : ''
                            }`}
                        >
                            <span className="font-mono text-xs text-gray-400">
                                {token?.sigil}
                            </span>
                            {suggestion.label}
                        </button>
                    ))}
                </AnchoredDropdown>
            )}

            <p className="mt-1.5 text-xs text-gray-500">
                {projects.length === 0 ? labels.noProjects : labels.hint}
            </p>

            {parsed.applied.length > 0 && (
                <p className="mt-1 flex flex-wrap gap-1" data-testid="quick-add-applied">
                    {parsed.applied.map((token) => (
                        <span
                            key={token}
                            className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700"
                        >
                            {token}
                        </span>
                    ))}
                </p>
            )}
        </div>
    );
}
