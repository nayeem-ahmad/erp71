'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { useToastStore } from '@/lib/toast';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import {
    Alert, Button, Field, FormFooter, FormGrid, Input, PageHeader, PageShell, StatusBadge, Textarea,
} from '@/components/ui';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import { stageTone, type Applicant } from '../types';

const blankForm = () => ({
    name: '',
    phone: '',
    email: '',
    source: '',
    current_company: '',
    current_designation: '',
    experience_years: '',
    expected_salary: '',
    resume_url: '',
    skills: '',
    address: '',
    notes: '',
});

/**
 * HR > Recruitment > Applicants — the candidate list, one row per person.
 *
 * The phone number is the identity here, which is why it is required and why a
 * second application from the same person reuses this row instead of adding one.
 */
export default function ApplicantsPage() {
    const { t } = useI18n();
    const copy = t.recruitment.applicants;
    const toast = useToastStore((state) => state.show);

    const [applicants, setApplicants] = useState<Applicant[]>([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [modal, setModal] = useState<{ open: boolean; editing: Applicant | null }>({ open: false, editing: null });
    const [form, setForm] = useState(blankForm());
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setApplicants(await api.getApplicants(search || undefined) ?? []);
        } catch (err: any) {
            setError(err?.message || copy.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [search, copy.loadFailed]);

    useEffect(() => { load(); }, [load]);

    const openModal = (editing: Applicant | null) => {
        setFormError('');
        setForm(editing
            ? {
                name: editing.name,
                phone: editing.phone,
                email: editing.email ?? '',
                source: editing.source ?? '',
                current_company: editing.current_company ?? '',
                current_designation: editing.current_designation ?? '',
                experience_years: editing.experience_years == null ? '' : String(editing.experience_years),
                expected_salary: editing.expected_salary == null ? '' : String(editing.expected_salary),
                resume_url: editing.resume_url ?? '',
                skills: editing.skills ?? '',
                address: editing.address ?? '',
                notes: editing.notes ?? '',
            }
            : blankForm());
        setModal({ open: true, editing });
    };

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        setFormError('');
        setSaving(true);
        try {
            const payload = {
                name: form.name,
                phone: form.phone,
                email: form.email || null,
                source: form.source || null,
                current_company: form.current_company || null,
                current_designation: form.current_designation || null,
                experience_years: form.experience_years ? Number(form.experience_years) : null,
                expected_salary: form.expected_salary ? Number(form.expected_salary) : null,
                resume_url: form.resume_url || null,
                skills: form.skills || null,
                address: form.address || null,
                notes: form.notes || null,
            };
            if (modal.editing) {
                await api.updateApplicant(modal.editing.id, payload);
                toast('success', copy.updated);
            } else {
                await api.createApplicant(payload);
                toast('success', copy.created);
            }
            setModal({ open: false, editing: null });
            await load();
        } catch (err: any) {
            setFormError(err?.message || copy.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const remove = async (applicant: Applicant) => {
        if (!window.confirm(copy.deleteConfirm)) return;
        try {
            await api.deleteApplicant(applicant.id);
            toast('success', copy.deleted);
            await load();
        } catch (err: any) {
            toast('error', err?.message || copy.deleteFailed);
        }
    };

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.hr,
                    copy.breadcrumb,
                    'hr',
                )}
                actions={(
                    <Button onClick={() => openModal(null)}>
                        <Plus className="h-4 w-4" />
                        {copy.add}
                    </Button>
                )}
            />

            {error && <Alert tone="danger">{error}</Alert>}

            <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={copy.searchPlaceholder}
                className="w-full sm:w-80"
                aria-label={copy.searchPlaceholder}
            />

            {loading ? (
                <p className="py-8 text-center text-sm text-gray-500">…</p>
            ) : applicants.length === 0 ? (
                <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
                    {search ? copy.emptyFiltered : copy.empty}
                </p>
            ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                    <table className="w-full text-sm">
                        <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
                            <tr>
                                <th className="p-2 text-start font-medium">{copy.columns.name}</th>
                                <th className="p-2 text-start font-medium">{copy.columns.contact}</th>
                                <th className="hidden p-2 text-start font-medium md:table-cell">{copy.columns.current}</th>
                                <th className="hidden p-2 text-end font-medium lg:table-cell">{copy.columns.experience}</th>
                                <th className="hidden p-2 text-end font-medium lg:table-cell">{copy.columns.expectedSalary}</th>
                                <th className="p-2 text-start font-medium">{copy.columns.applications}</th>
                                <th className="p-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {applicants.map((applicant) => (
                                <tr key={applicant.id} className="border-b border-gray-100 last:border-0">
                                    <td className="p-2">
                                        <p className="font-medium text-gray-900">{applicant.name}</p>
                                        {applicant.source && (
                                            <p className="text-xs text-gray-500">{applicant.source}</p>
                                        )}
                                        {applicant.resume_url && (
                                            <a
                                                href={applicant.resume_url}
                                                target="_blank"
                                                rel="noreferrer noopener"
                                                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                                            >
                                                <FileText className="h-3.5 w-3.5" />
                                                {copy.openResume}
                                            </a>
                                        )}
                                    </td>
                                    <td className="p-2 text-gray-600">
                                        <p>{applicant.phone}</p>
                                        {applicant.email && <p className="text-xs text-gray-500">{applicant.email}</p>}
                                    </td>
                                    <td className="hidden p-2 text-gray-600 md:table-cell">
                                        {applicant.current_designation || applicant.current_company
                                            ? [applicant.current_designation, applicant.current_company].filter(Boolean).join(' · ')
                                            : '—'}
                                    </td>
                                    <td className="hidden p-2 text-end text-gray-600 lg:table-cell">
                                        {applicant.experience_years == null ? '—' : String(applicant.experience_years)}
                                    </td>
                                    <td className="hidden p-2 text-end text-gray-600 lg:table-cell">
                                        {applicant.expected_salary == null ? '—' : formatBDT(Number(applicant.expected_salary))}
                                    </td>
                                    <td className="p-2">
                                        {applicant.applications?.length ? (
                                            <div className="flex flex-wrap gap-1">
                                                {applicant.applications.map((application) => (
                                                    <StatusBadge key={application.id} tone={stageTone(application.stage)}>
                                                        {application.jobPost?.title}: {t.recruitment.stages[application.stage]}
                                                    </StatusBadge>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="text-xs text-gray-400">{copy.noApplications}</span>
                                        )}
                                        {(applicant.application_count ?? 0) > (applicant.applications?.length ?? 0) && (
                                            <p className="mt-1 text-xs text-gray-400">
                                                {formatMessage(copy.applicationCount, { count: applicant.application_count ?? 0 })}
                                            </p>
                                        )}
                                    </td>
                                    <td className="p-2 text-end">
                                        <div className="flex justify-end gap-1">
                                            <Button variant="ghost" onClick={() => openModal(applicant)} aria-label={copy.editTitle}>
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" onClick={() => remove(applicant)} aria-label={copy.deleteConfirm}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {modal.open && (
                <ModalShell size="lg" onBackdropClick={() => setModal({ open: false, editing: null })}>
                    <ModalHeader
                        title={modal.editing ? copy.editTitle : copy.addTitle}
                        onClose={() => setModal({ open: false, editing: null })}
                    />
                    <form onSubmit={save} className="space-y-3 overflow-y-auto p-4">
                        {formError && <Alert tone="danger">{formError}</Alert>}

                        <FormGrid>
                            <Field label={copy.form.name} htmlFor="applicant-name" required>
                                <Input
                                    id="applicant-name"
                                    value={form.name}
                                    onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                                    placeholder={copy.form.namePlaceholder}
                                    required
                                />
                            </Field>

                            <Field label={copy.form.phone} htmlFor="applicant-phone" required>
                                <Input
                                    id="applicant-phone"
                                    value={form.phone}
                                    onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                                    placeholder={copy.form.phonePlaceholder}
                                    required
                                />
                            </Field>

                            <Field label={copy.form.email} htmlFor="applicant-email">
                                <Input
                                    id="applicant-email"
                                    type="email"
                                    value={form.email}
                                    onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                                />
                            </Field>

                            <Field label={copy.form.source} htmlFor="applicant-source">
                                <Input
                                    id="applicant-source"
                                    value={form.source}
                                    onChange={(event) => setForm((prev) => ({ ...prev, source: event.target.value }))}
                                    placeholder={copy.form.sourcePlaceholder}
                                />
                            </Field>

                            <Field label={copy.form.currentCompany} htmlFor="applicant-company">
                                <Input
                                    id="applicant-company"
                                    value={form.current_company}
                                    onChange={(event) => setForm((prev) => ({ ...prev, current_company: event.target.value }))}
                                />
                            </Field>

                            <Field label={copy.form.currentDesignation} htmlFor="applicant-designation">
                                <Input
                                    id="applicant-designation"
                                    value={form.current_designation}
                                    onChange={(event) => setForm((prev) => ({ ...prev, current_designation: event.target.value }))}
                                />
                            </Field>

                            <Field label={copy.form.experienceYears} htmlFor="applicant-experience">
                                <Input
                                    id="applicant-experience"
                                    type="number"
                                    min={0}
                                    step="0.5"
                                    value={form.experience_years}
                                    onChange={(event) => setForm((prev) => ({ ...prev, experience_years: event.target.value }))}
                                />
                            </Field>

                            <Field label={copy.form.expectedSalary} htmlFor="applicant-expected">
                                <Input
                                    id="applicant-expected"
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={form.expected_salary}
                                    onChange={(event) => setForm((prev) => ({ ...prev, expected_salary: event.target.value }))}
                                />
                            </Field>

                            <FormGrid.Full>
                                <Field label={copy.form.resumeUrl} htmlFor="applicant-resume">
                                    <Input
                                        id="applicant-resume"
                                        value={form.resume_url}
                                        onChange={(event) => setForm((prev) => ({ ...prev, resume_url: event.target.value }))}
                                        placeholder={copy.form.resumeUrlPlaceholder}
                                    />
                                </Field>
                            </FormGrid.Full>

                            <FormGrid.Full>
                                <Field label={copy.form.skills} htmlFor="applicant-skills">
                                    <Input
                                        id="applicant-skills"
                                        value={form.skills}
                                        onChange={(event) => setForm((prev) => ({ ...prev, skills: event.target.value }))}
                                        placeholder={copy.form.skillsPlaceholder}
                                    />
                                </Field>
                            </FormGrid.Full>

                            <FormGrid.Full>
                                <Field label={copy.form.address} htmlFor="applicant-address">
                                    <Input
                                        id="applicant-address"
                                        value={form.address}
                                        onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))}
                                    />
                                </Field>
                            </FormGrid.Full>

                            <FormGrid.Full>
                                <Field label={copy.form.notes} htmlFor="applicant-notes">
                                    <Textarea
                                        id="applicant-notes"
                                        rows={3}
                                        value={form.notes}
                                        onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                                    />
                                </Field>
                            </FormGrid.Full>
                        </FormGrid>

                        <FormFooter>
                            <Button variant="secondary" onClick={() => setModal({ open: false, editing: null })}>
                                {t.common.cancel}
                            </Button>
                            <Button type="submit" loading={saving} disabled={saving}>{t.common.save}</Button>
                        </FormFooter>
                    </form>
                </ModalShell>
            )}
        </PageShell>
    );
}
