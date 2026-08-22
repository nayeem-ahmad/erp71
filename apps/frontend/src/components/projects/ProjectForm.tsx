'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select, Textarea, Field, FormGrid, FormFooter } from '@/components/ui';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';

export interface ProjectFormValues {
    name: string;
    shortName: string;
    description: string;
    customerId: string;
    projectTypeId: string;
    status: string;
    priority: string;
    visibility: string;
    startDate: string;
    targetEndDate: string;
    budgetAmount: string;
}

const EMPTY: ProjectFormValues = {
    name: '',
    shortName: '',
    description: '',
    customerId: '',
    projectTypeId: '',
    status: 'DRAFT',
    priority: 'MEDIUM',
    visibility: 'PUBLIC',
    startDate: '',
    targetEndDate: '',
    budgetAmount: '',
};

/** `2026-08-02T00:00:00.000Z` → `2026-08-02`, which is what `<input type="date">` wants. */
const toDateInput = (value?: string | null): string => (value ? String(value).slice(0, 10) : '');

export function toFormValues(project: Record<string, unknown> | null): ProjectFormValues {
    if (!project) return { ...EMPTY };
    return {
        name: (project.name as string) ?? '',
        shortName: (project.short_name as string) ?? '',
        description: (project.description as string) ?? '',
        customerId: (project.customer_id as string) ?? '',
        projectTypeId: (project.project_type_id as string) ?? '',
        status: (project.status as string) ?? 'DRAFT',
        priority: (project.priority as string) ?? 'MEDIUM',
        visibility: (project.visibility as string) ?? 'PUBLIC',
        startDate: toDateInput(project.start_date as string),
        targetEndDate: toDateInput(project.target_end_date as string),
        budgetAmount: project.budget_amount == null ? '' : String(project.budget_amount),
    };
}

/**
 * One form for create and edit. Extracted from the new-project page in Phase 2
 * rather than copied, so the two cannot drift a field apart.
 *
 * `code` is deliberately absent in both modes: it is allocated server-side and
 * is printed on documents, so it must not change under an existing project.
 */
export default function ProjectForm({
    mode,
    projectId,
    initial,
}: {
    mode: 'create' | 'edit';
    projectId?: string;
    initial?: ProjectFormValues;
}) {
    const router = useRouter();
    const { t } = useI18n();
    const m = t.projects;

    const [types, setTypes] = useState<{ id: string; name: string }[]>([]);
    const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
    const [saving, setSaving] = useState(false);
    const [nameError, setNameError] = useState<string | null>(null);
    const [form, setForm] = useState<ProjectFormValues>(initial ?? EMPTY);

    // `initial` arrives after the edit page's fetch resolves, so the form has to
    // adopt it rather than only seeding from it once.
    useEffect(() => {
        if (initial) setForm(initial);
    }, [initial]);

    useEffect(() => {
        api.getProjectTypes()
            .then((list: unknown) => setTypes(Array.isArray(list) ? list : []))
            .catch(() => setTypes([]));
        api.getCustomers()
            .then((res: unknown) => {
                const rows = Array.isArray(res) ? res : ((res as { items?: unknown[] })?.items ?? []);
                setCustomers(rows as { id: string; name: string }[]);
            })
            .catch(() => setCustomers([]));
    }, []);

    const set = (key: keyof ProjectFormValues) => (
        e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
    ) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim()) {
            setNameError(m.validation.nameRequired);
            return;
        }
        setNameError(null);
        setSaving(true);

        // Edit sends '' rather than undefined for the optional links, because
        // undefined means "leave alone" to the PATCH handler — clearing a
        // customer has to be expressible.
        const clearable = (value: string) => (mode === 'edit' ? value : value || undefined);
        const payload = {
            name: form.name.trim(),
            shortName: clearable(form.shortName.trim()),
            description: clearable(form.description.trim()),
            customerId: clearable(form.customerId),
            projectTypeId: clearable(form.projectTypeId),
            status: form.status,
            priority: form.priority,
            visibility: form.visibility,
            startDate: clearable(form.startDate),
            targetEndDate: clearable(form.targetEndDate),
            // `null`, not `undefined`, on edit: undefined is "leave alone", so
            // clearing the field would otherwise leave the old budget in place.
            // `@IsOptional()` skips null, and the service writes it as null.
            budgetAmount: form.budgetAmount
                ? Number(form.budgetAmount)
                : mode === 'edit'
                  ? null
                  : undefined,
        };

        try {
            if (mode === 'edit' && projectId) {
                await api.updateProject(projectId, payload);
                toast.success(m.saved);
                router.push(routes.projects.detail(projectId));
            } else {
                const created = await api.createProject(payload);
                toast.success(m.saved);
                router.push(routes.projects.detail((created as { id: string }).id));
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : m.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={submit} className="space-y-4">
            <FormGrid>
                <Field label={m.fields.name} required error={nameError ?? undefined}>
                    <Input value={form.name} onChange={set('name')} autoFocus />
                </Field>
                <Field label={m.fields.shortName} hint={m.fields.shortNameHint}>
                    <Input value={form.shortName} onChange={set('shortName')} maxLength={20} />
                </Field>
                <Field label={m.fields.type}>
                    <Select value={form.projectTypeId} onChange={set('projectTypeId')}>
                        <option value="">—</option>
                        {types.map((type) => (
                            <option key={type.id} value={type.id}>
                                {type.name}
                            </option>
                        ))}
                    </Select>
                </Field>
                <Field label={m.fields.customer}>
                    <Select value={form.customerId} onChange={set('customerId')}>
                        <option value="">—</option>
                        {customers.map((customer) => (
                            <option key={customer.id} value={customer.id}>
                                {customer.name}
                            </option>
                        ))}
                    </Select>
                </Field>
                <Field label={m.fields.status}>
                    <Select value={form.status} onChange={set('status')}>
                        {Object.entries(m.status).map(([key, label]) => (
                            <option key={key} value={key}>
                                {label}
                            </option>
                        ))}
                    </Select>
                </Field>
                <Field label={m.fields.priority}>
                    <Select value={form.priority} onChange={set('priority')}>
                        {Object.entries(m.priority).map(([key, label]) => (
                            <option key={key} value={key}>
                                {label}
                            </option>
                        ))}
                    </Select>
                </Field>
                <Field
                    label={m.fields.visibility}
                    hint={m.visibilityHelp[form.visibility as keyof typeof m.visibilityHelp]}
                >
                    <Select value={form.visibility} onChange={set('visibility')}>
                        {Object.entries(m.visibility).map(([key, label]) => (
                            <option key={key} value={key}>
                                {label}
                            </option>
                        ))}
                    </Select>
                </Field>
                <Field label={m.fields.budget}>
                    <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.budgetAmount}
                        onChange={set('budgetAmount')}
                    />
                </Field>
                <Field label={m.fields.startDate}>
                    <Input type="date" value={form.startDate} onChange={set('startDate')} />
                </Field>
                <Field label={m.fields.targetEndDate}>
                    <Input type="date" value={form.targetEndDate} onChange={set('targetEndDate')} />
                </Field>
            </FormGrid>

            <Field label={m.fields.description}>
                <Textarea rows={4} value={form.description} onChange={set('description')} />
            </Field>

            <FormFooter>
                <Button type="button" variant="secondary" onClick={() => router.back()}>
                    {t.common.cancel}
                </Button>
                <Button type="submit" disabled={saving}>
                    {t.common.save}
                </Button>
            </FormFooter>
        </form>
    );
}
