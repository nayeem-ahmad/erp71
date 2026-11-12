'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, FileText, Inbox, Pencil, Plus, Trash2, UserCheck, UserRound, Users } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import type { NumberCondition } from '@/lib/number-condition';
import { matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { useToastStore } from '@/lib/toast';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import {
    Alert, Button, ConfirmDialog, Field, FormFooter, FormGrid, Input, PageHeader, PageShell, StatusBadge, Textarea,
} from '@/components/ui';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import { APPLICATION_STAGES, OPEN_STAGES, stageTone, type Applicant } from '../types';
import { applicantPhoneOrNull, applicantPhoneValidationError } from '../applicant-phone';

const columnHelper = createColumnHelper<Applicant>();
/** The source chip's value for an applicant with none recorded. */
const NONE = '__none__';
const OPEN = new Set<string>(OPEN_STAGES);

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
 * Phone is optional. When one is entered it is still how a repeat candidate is
 * recognised, and it still has to be a phone number. An empty box is no phone.
 */
export default function ApplicantsPage() {
    const { t, locale } = useI18n();
    const copy = t.recruitment.applicants;
    const toast = useToastStore((state) => state.show);

    const [applicants, setApplicants] = useState<Applicant[]>([]);
    const [search, setSearch] = useState('');
    const [sources, setSources] = useState<string[]>([]);
    const [stages, setStages] = useState<string[]>([]);
    const [experienceFilter, setExperienceFilter] = useState<NumberCondition | null>(null);
    const [salaryFilter, setSalaryFilter] = useState<NumberCondition | null>(null);
    const [applicationsFilter, setApplicationsFilter] = useState<NumberCondition | null>(null);
    const [pendingDelete, setPendingDelete] = useState<Applicant | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [modal, setModal] = useState<{ open: boolean; editing: Applicant | null }>({ open: false, editing: null });
    const [form, setForm] = useState(blankForm());
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');
    const [phoneError, setPhoneError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            // Every applicant loads once; the toolbar narrows them here, so the
            // strip counts the same people.
            setApplicants(await api.getApplicants() ?? []);
        } catch (err: any) {
            setError(err?.message || copy.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [copy.loadFailed]);

    useEffect(() => { load(); }, [load]);

    const openModal = (editing: Applicant | null) => {
        setFormError('');
        setPhoneError('');
        setForm(editing
            ? {
                name: editing.name,
                phone: editing.phone ?? '',
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
        if (applicantPhoneValidationError(form.phone)) {
            setPhoneError(copy.form.phoneInvalid);
            return;
        }
        setPhoneError('');
        setSaving(true);
        try {
            const payload = {
                name: form.name,
                phone: applicantPhoneOrNull(form.phone),
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

    const remove = async () => {
        const applicant = pendingDelete;
        if (!applicant) return;
        try {
            await api.deleteApplicant(applicant.id);
            toast('success', copy.deleted);
            setPendingDelete(null);
            await load();
        } catch (err: any) {
            toast('error', err?.message || copy.deleteFailed);
        }
    };

    const sourceOptions = useMemo(
        () => [...new Set(applicants.map((a) => a.source?.trim()).filter((v): v is string => Boolean(v)))]
            .sort((a, b) => a.localeCompare(b))
            .map((value) => ({ value, label: value })),
        [applicants],
    );

    const filtered = useMemo(
        () => applicants.filter((a) => {
            if (!matchesAnyOf(sources, a.source?.trim() || NONE)) return false;
            if (stages.length && !(a.applications ?? []).some((app) => stages.includes(app.stage))) return false;
            if (experienceFilter && (a.experience_years == null || !matchesNumberCondition(Number(a.experience_years), experienceFilter))) return false;
            if (salaryFilter && (a.expected_salary == null || !matchesNumberCondition(Number(a.expected_salary), salaryFilter))) return false;
            if (!matchesNumberCondition(a.application_count ?? a.applications?.length ?? 0, applicationsFilter)) return false;
            return matchesSearch(
                search,
                a.name, a.phone, a.email, a.skills, a.source, a.current_company, a.current_designation,
            );
        }),
        [applicants, sources, stages, experienceFilter, salaryFilter, applicationsFilter, search],
    );

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'stage',
            type: 'multi-select',
            label: t.hr.listUi.stage,
            value: stages,
            onChange: setStages,
            options: APPLICATION_STAGES.map((value) => ({ value, label: t.recruitment.stages[value] })),
        },
        {
            id: 'source',
            type: 'multi-select',
            label: copy.columns.source,
            value: sources,
            onChange: setSources,
            options: [{ value: NONE, label: t.hr.reports.common.unassigned }, ...sourceOptions],
        },
        {
            id: 'experience',
            type: 'number',
            label: copy.columns.experience,
            value: experienceFilter,
            onChange: setExperienceFilter,
        },
        {
            id: 'expectedSalary',
            type: 'number',
            label: copy.columns.expectedSalary,
            value: salaryFilter,
            onChange: setSalaryFilter,
            money: true,
        },
        {
            id: 'applications',
            type: 'number',
            label: copy.columns.applications,
            value: applicationsFilter,
            onChange: setApplicationsFilter,
            more: true,
        },
    ], [t, copy, stages, sources, sourceOptions, experienceFilter, salaryFilter, applicationsFilter]);

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const salaries = filtered.map((a) => a.expected_salary).filter((v) => v != null).map(Number);
        const items: ListStat[] = [
            { id: 'count', icon: <Users aria-hidden />, label: copy.title, value: n(filtered.length) },
            {
                id: 'pipeline',
                icon: <UserRound aria-hidden />,
                label: t.recruitment.summary.inPipeline,
                value: n(filtered.filter((a) => (a.applications ?? []).some((app) => OPEN.has(app.stage))).length),
            },
            {
                id: 'hired',
                icon: <UserCheck aria-hidden />,
                label: t.recruitment.stages.HIRED,
                value: n(filtered.filter((a) => (a.applications ?? []).some((app) => app.stage === 'HIRED')).length),
            },
            {
                id: 'none',
                icon: <Inbox aria-hidden />,
                label: copy.noApplications,
                value: n(filtered.filter((a) => (a.application_count ?? a.applications?.length ?? 0) === 0).length),
            },
            {
                id: 'salary',
                icon: <Calculator aria-hidden />,
                label: t.hr.listUi.averageExpected,
                value: salaries.length
                    ? formatBDT(salaries.reduce((sum, v) => sum + v, 0) / salaries.length, { locale, minimumFractionDigits: 0, maximumFractionDigits: 0 })
                    : '—',
            },
        ];
        return { items, loading, label: t.hr.listUi.applicantsStats };
    }, [filtered, loading, locale, copy, t]);

    const columns: ColumnDef<Applicant, any>[] = useMemo(() => [
        columnHelper.accessor('name', {
            header: copy.columns.name,
            cell: (info) => {
                const applicant = info.row.original;
                return (
                    <div>
                        <span className="block">{applicant.name}</span>
                        {applicant.source && <span className="block text-gray-500">{applicant.source}</span>}
                        {applicant.resume_url && (
                            <a
                                href={applicant.resume_url}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                            >
                                <FileText className="h-3.5 w-3.5" />
                                {copy.openResume}
                            </a>
                        )}
                    </div>
                );
            },
            size: 200,
        }),
        columnHelper.accessor('phone', {
            header: copy.columns.contact,
            cell: (info) => {
                const phone = (info.getValue() as string | null | undefined)?.trim();
                return (
                    <div>
                        <span className="block">{phone || '—'}</span>
                        {info.row.original.email && <span className="block text-gray-500">{info.row.original.email}</span>}
                    </div>
                );
            },
            size: 180,
        }),
        columnHelper.accessor(
            (row) => [row.current_designation, row.current_company].filter(Boolean).join(' · '),
            {
                id: 'current',
                header: copy.columns.current,
                cell: (info) => info.getValue() || '—',
                size: 180,
                meta: { hideOnMobile: true },
            },
        ),
        columnHelper.accessor((row) => (row.experience_years == null ? -1 : Number(row.experience_years)), {
            id: 'experience',
            header: copy.columns.experience,
            cell: (info) => (info.row.original.experience_years == null ? '—' : String(info.row.original.experience_years)),
            size: 100,
            meta: { hideOnMobile: true, align: 'end' },
        }),
        columnHelper.accessor((row) => (row.expected_salary == null ? -1 : Number(row.expected_salary)), {
            id: 'expected_salary',
            header: copy.columns.expectedSalary,
            cell: (info) => {
                const value = info.row.original.expected_salary;
                return value == null ? '—' : formatBDT(Number(value), { locale });
            },
            size: 120,
            meta: { hideOnMobile: true, align: 'end' },
        }),
        columnHelper.accessor((row) => row.application_count ?? row.applications?.length ?? 0, {
            id: 'applications',
            header: copy.columns.applications,
            cell: (info) => {
                const applicant = info.row.original;
                return (
                    <div>
                        {applicant.applications?.length ? (
                            <div className="flex flex-wrap gap-1">
                                {applicant.applications.map((application) => (
                                    <StatusBadge key={application.id} tone={stageTone(application.stage)}>
                                        {application.jobPost?.title}: {t.recruitment.stages[application.stage]}
                                    </StatusBadge>
                                ))}
                            </div>
                        ) : (
                            <span className="text-gray-400">{copy.noApplications}</span>
                        )}
                        {(applicant.application_count ?? 0) > (applicant.applications?.length ?? 0) && (
                            <span className="mt-1 block text-gray-400">
                                {formatMessage(copy.applicationCount, { count: applicant.application_count ?? 0 })}
                            </span>
                        )}
                    </div>
                );
            },
            size: 240,
        }),
        columnHelper.display({
            id: 'actions',
            header: t.common.actions,
            cell: (info) => (
                <RowActions>
                    <RowActionButton icon={<Pencil />} label={copy.editTitle} onClick={() => openModal(info.row.original)} />
                    <RowActionButton
                        icon={<Trash2 />}
                        label={t.common.delete}
                        intent="danger"
                        onClick={() => setPendingDelete(info.row.original)}
                    />
                </RowActions>
            ),
            enableSorting: false,
            enableColumnFilter: false,
            enableResizing: false,
            size: 90,
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [t, copy, locale]);

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

            <DataTable<Applicant>
                tableId="applicants"
                columns={columns}
                data={filtered}
                title={copy.title}
                isLoading={loading}
                emptyMessage={applicants.length === 0 ? copy.empty : copy.emptyFiltered}
                emptyIcon={<Users className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={copy.searchPlaceholder}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
            />

            <ConfirmDialog
                open={pendingDelete !== null}
                title={t.common.delete}
                prompt={copy.deleteConfirm}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                danger
                onConfirm={() => void remove()}
                onCancel={() => setPendingDelete(null)}
            />

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

                            <Field label={copy.form.phone} htmlFor="applicant-phone" error={phoneError}>
                                <Input
                                    id="applicant-phone"
                                    value={form.phone}
                                    onChange={(event) => {
                                        setPhoneError('');
                                        setForm((prev) => ({ ...prev, phone: event.target.value }));
                                    }}
                                    placeholder={copy.form.phonePlaceholder}
                                    maxLength={30}
                                    inputMode="tel"
                                    aria-invalid={phoneError ? true : undefined}
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
