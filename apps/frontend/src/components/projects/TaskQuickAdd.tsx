'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Input, Select } from '@/components/ui';
import { parseQuickAdd, type QuickAddVocabulary } from './task-quick-add';

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
                    onChange={(event) => setValue(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            void submit();
                        }
                        if (event.key === 'Escape') {
                            // Kept off the document: a page-level handler would
                            // read it as something else entirely.
                            event.stopPropagation();
                            setValue('');
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
