'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageShell, PageHeader, Button, Input, Select, Textarea, Field, FormGrid, FormFooter } from '@/components/ui';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';

export default function NewProjectPage() {
    const router = useRouter();
    const { t } = useI18n();
    const m = t.projects;

    const [types, setTypes] = useState<{ id: string; name: string }[]>([]);
    const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
    const [saving, setSaving] = useState(false);
    const [nameError, setNameError] = useState<string | null>(null);

    const [form, setForm] = useState({
        name: '',
        description: '',
        customerId: '',
        projectTypeId: '',
        status: 'DRAFT',
        priority: 'MEDIUM',
        startDate: '',
        targetEndDate: '',
        budgetAmount: '',
    });

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

    const set = (key: keyof typeof form) => (
        e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
    ) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim()) {
            setNameError(m.fields.name);
            return;
        }
        setNameError(null);
        setSaving(true);
        try {
            const created = await api.createProject({
                name: form.name.trim(),
                description: form.description.trim() || undefined,
                customerId: form.customerId || undefined,
                projectTypeId: form.projectTypeId || undefined,
                status: form.status,
                priority: form.priority,
                startDate: form.startDate || undefined,
                targetEndDate: form.targetEndDate || undefined,
                budgetAmount: form.budgetAmount ? Number(form.budgetAmount) : undefined,
            });
            toast.success(m.newProject);
            router.push(routes.projects.detail((created as { id: string }).id));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not create the project');
        } finally {
            setSaving(false);
        }
    };

    return (
        <PageShell>
            <PageHeader title={m.newProject} subtitle={m.subtitle} />

            <form onSubmit={submit} className="space-y-4">
                <FormGrid>
                    <Field label={m.fields.name} required error={nameError ?? undefined}>
                        <Input value={form.name} onChange={set('name')} autoFocus />
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
        </PageShell>
    );
}
