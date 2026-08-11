'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n, formatMessage } from '@/lib/i18n';
import { useToastStore } from '@/lib/toast';
import { Alert, Button, Field, FormFooter, FormGrid, Input, Select } from '@/components/ui';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import type { JobApplication } from './types';

interface NamedRecord { id: string; name: string }

/**
 * Accepting an offer. This is the one action in recruitment that writes outside
 * the module: it creates the employee record, which is why it asks for a joining
 * date rather than just flipping a stage.
 */
export default function HireModal({
    application,
    onClose,
    onHired,
}: {
    application: JobApplication;
    onClose: () => void;
    onHired: () => void;
}) {
    const { t } = useI18n();
    const copy = t.recruitment.applications;
    const toast = useToastStore((state) => state.show);

    const [departments, setDepartments] = useState<NamedRecord[]>([]);
    const [designations, setDesignations] = useState<NamedRecord[]>([]);
    const [form, setForm] = useState({
        date_of_joining: new Date().toISOString().slice(0, 10),
        department_id: '',
        designation_id: '',
        basic_salary: '',
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        Promise.all([api.getDepartments(), api.getDesignations()])
            .then(([depts, desigs]) => {
                if (cancelled) return;
                setDepartments(depts ?? []);
                setDesignations(desigs ?? []);
            })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, []);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError('');
        setSaving(true);
        try {
            await api.hireJobApplicant(application.id, {
                date_of_joining: form.date_of_joining,
                department_id: form.department_id || undefined,
                designation_id: form.designation_id || undefined,
                basic_salary: form.basic_salary ? Number(form.basic_salary) : undefined,
            });
            toast('success', copy.hired);
            onHired();
            onClose();
        } catch (err: any) {
            setError(err?.message || copy.hireFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell size="md" onBackdropClick={onClose}>
            <ModalHeader title={copy.hireForm.title} onClose={onClose} />
            <form onSubmit={submit} className="space-y-3 p-4">
                {error && <Alert tone="danger">{error}</Alert>}

                <p className="text-sm text-gray-600">
                    {formatMessage(copy.hireForm.intro, { name: application.applicant?.name ?? '' })}
                </p>

                <FormGrid>
                    <Field label={copy.hireForm.dateOfJoining} htmlFor="hire-joining" required>
                        <Input
                            id="hire-joining"
                            type="date"
                            value={form.date_of_joining}
                            onChange={(event) => setForm((prev) => ({ ...prev, date_of_joining: event.target.value }))}
                            required
                        />
                    </Field>

                    <Field label={copy.hireForm.basicSalary} htmlFor="hire-salary">
                        <Input
                            id="hire-salary"
                            type="number"
                            min={0}
                            step="0.01"
                            value={form.basic_salary}
                            onChange={(event) => setForm((prev) => ({ ...prev, basic_salary: event.target.value }))}
                        />
                    </Field>

                    <Field label={copy.hireForm.department} htmlFor="hire-department" hint={copy.hireForm.fromPost}>
                        <Select
                            id="hire-department"
                            value={form.department_id}
                            onChange={(event) => setForm((prev) => ({ ...prev, department_id: event.target.value }))}
                        >
                            <option value="">{t.recruitment.jobPosts.form.none}</option>
                            {departments.map((dept) => (
                                <option key={dept.id} value={dept.id}>{dept.name}</option>
                            ))}
                        </Select>
                    </Field>

                    <Field label={copy.hireForm.designation} htmlFor="hire-designation" hint={copy.hireForm.fromPost}>
                        <Select
                            id="hire-designation"
                            value={form.designation_id}
                            onChange={(event) => setForm((prev) => ({ ...prev, designation_id: event.target.value }))}
                        >
                            <option value="">{t.recruitment.jobPosts.form.none}</option>
                            {designations.map((desig) => (
                                <option key={desig.id} value={desig.id}>{desig.name}</option>
                            ))}
                        </Select>
                    </Field>
                </FormGrid>

                <FormFooter>
                    <Button variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
                    <Button type="submit" loading={saving} disabled={saving}>{copy.hireForm.confirm}</Button>
                </FormFooter>
            </form>
        </ModalShell>
    );
}
