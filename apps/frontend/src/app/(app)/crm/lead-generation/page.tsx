'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import {
    PageShell,
    PageHeader,
    Button,
    Input,
    Textarea,
    Field,
    FormGrid,
    Checkbox,
    StatusBadge,
    type StatusBadgeTone,
} from '@/components/ui';

type Candidate = {
    company_name: string;
    website_url: string | null;
    linkedin_url: string | null;
    email: string | null;
    location: string | null;
    description: string | null;
    fit_score: number;
    fit_reason: string | null;
    source_url: string | null;
    unverified: boolean;
    existing_lead_id: string | null;
    existing_lead_name: string | null;
};

const DEFAULT_NICHE = 'small and medium businesses';
const DEFAULT_LOCATION = 'Bangladesh';

function fitTone(score: number): StatusBadgeTone {
    if (score >= 70) return 'success';
    if (score >= 40) return 'warning';
    return 'neutral';
}

function candidateKey(row: Candidate, index: number): string {
    return `${row.website_url ?? row.company_name}:${index}`;
}

export default function LeadGenerationPage() {
    const { t, fmt } = useI18n();
    const m = t.crm.leadGeneration;

    const [niche, setNiche] = useState(DEFAULT_NICHE);
    const [location, setLocation] = useState(DEFAULT_LOCATION);
    const [companySize, setCompanySize] = useState('');
    const [keywords, setKeywords] = useState('');
    const [limit, setLimit] = useState(8);
    const [searching, setSearching] = useState(false);
    const [importing, setImporting] = useState(false);
    const [candidates, setCandidates] = useState<Candidate[] | null>(null);
    const [selected, setSelected] = useState<Record<string, boolean>>({});
    const [created, setCreated] = useState<Array<{ id: string; name: string }>>([]);

    const selectable = (candidates ?? []).filter((row) => !row.existing_lead_id);
    const selectedRows = (candidates ?? []).filter(
        (row, index) => !row.existing_lead_id && selected[candidateKey(row, index)],
    );

    async function findCompanies() {
        setSearching(true);
        setCreated([]);
        try {
            const result = await api.searchLeadGeneration({
                niche: niche.trim() || undefined,
                location: location.trim() || undefined,
                companySize: companySize.trim() || undefined,
                keywords: keywords.trim() || undefined,
                limit,
            });
            const rows = Array.isArray(result?.candidates) ? (result.candidates as Candidate[]) : [];
            setCandidates(rows);
            setSelected({});
        } catch (err) {
            toast.error(err instanceof Error ? err.message : m.empty);
        } finally {
            setSearching(false);
        }
    }

    async function addSelected() {
        if (selectedRows.length === 0) {
            toast.error(m.noneSelected);
            return;
        }
        setImporting(true);
        try {
            const result = await api.importLeadGeneration(selectedRows);
            const added = Array.isArray(result?.created) ? result.created : [];
            setCreated(added);
            if (added.length > 0) {
                toast.success(fmt(m.added, { count: added.length }));
            }
            const failed = Array.isArray(result?.failed) ? result.failed : [];
            if (failed[0]?.reason) toast.error(failed[0].reason);
            setSelected({});
        } catch (err) {
            toast.error(err instanceof Error ? err.message : m.noneSelected);
        } finally {
            setImporting(false);
        }
    }

    function toggle(key: string, checked: boolean) {
        setSelected((prev) => ({ ...prev, [key]: checked }));
    }

    return (
        <PageShell>
            <PageHeader
                title={m.title}
                subtitle={m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.crm,
                    m.title,
                    'crm',
                )}
                actions={
                    <Button
                        onClick={findCompanies}
                        loading={searching}
                        icon={<Sparkles className="w-4 h-4" />}
                    >
                        {searching ? m.finding : m.find}
                    </Button>
                }
            />

            <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4 space-y-4">
                <FormGrid>
                    <FormGrid.Full>
                        <Field label={m.fields.niche} htmlFor="lead-gen-niche" hint={m.fields.nicheHint}>
                            <Textarea
                                id="lead-gen-niche"
                                rows={2}
                                value={niche}
                                onChange={(e) => setNiche(e.target.value)}
                                placeholder={m.fields.nichePlaceholder}
                            />
                        </Field>
                    </FormGrid.Full>
                    <Field label={m.fields.location} htmlFor="lead-gen-location">
                        <Input
                            id="lead-gen-location"
                            value={location}
                            onChange={(e) => setLocation(e.target.value)}
                            placeholder={m.fields.locationPlaceholder}
                        />
                    </Field>
                    <Field label={m.fields.companySize} htmlFor="lead-gen-size">
                        <Input
                            id="lead-gen-size"
                            value={companySize}
                            onChange={(e) => setCompanySize(e.target.value)}
                            placeholder={m.fields.companySizePlaceholder}
                        />
                    </Field>
                    <Field label={m.fields.keywords} htmlFor="lead-gen-keywords">
                        <Input
                            id="lead-gen-keywords"
                            value={keywords}
                            onChange={(e) => setKeywords(e.target.value)}
                            placeholder={m.fields.keywordsPlaceholder}
                        />
                    </Field>
                    <Field label={m.fields.limit} htmlFor="lead-gen-limit">
                        <Input
                            id="lead-gen-limit"
                            type="number"
                            min={1}
                            max={15}
                            value={limit}
                            onChange={(e) => setLimit(Number(e.target.value) || 8)}
                        />
                    </Field>
                </FormGrid>
                <p className="text-xs text-gray-500">{m.creditsNote}</p>
            </div>

            {candidates && (
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        {candidates.length === 0 && (
                            <p className="text-sm text-gray-600">{m.empty}</p>
                        )}
                        {selectable.length > 0 && (
                            <Button onClick={addSelected} loading={importing} disabled={importing}>
                                {importing ? m.adding : m.addSelected}
                            </Button>
                        )}
                    </div>

                    <ul className="space-y-2">
                        {candidates.map((row, index) => {
                            const key = candidateKey(row, index);
                            const already = Boolean(row.existing_lead_id);
                            return (
                                <li
                                    key={key}
                                    className="rounded-lg border border-gray-200 bg-white p-3 md:p-4"
                                >
                                    <div className="flex items-start gap-3">
                                        {!already && (
                                            <Checkbox
                                                className="mt-1"
                                                checked={Boolean(selected[key])}
                                                onChange={(e) => toggle(key, e.target.checked)}
                                                aria-label={row.company_name}
                                            />
                                        )}
                                        <div className="min-w-0 flex-1 space-y-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="text-sm font-medium text-gray-900">
                                                    {row.company_name}
                                                </p>
                                                <StatusBadge tone={fitTone(row.fit_score)}>
                                                    {m.fit} {row.fit_score}
                                                </StatusBadge>
                                                {already && (
                                                    <StatusBadge tone="warning">{m.alreadyInCrm}</StatusBadge>
                                                )}
                                                {row.unverified && (
                                                    <StatusBadge tone="warning">{m.unverified}</StatusBadge>
                                                )}
                                            </div>
                                            {row.description && (
                                                <p className="text-sm text-gray-600">{row.description}</p>
                                            )}
                                            {row.fit_reason && (
                                                <p className="text-xs text-gray-500">{row.fit_reason}</p>
                                            )}
                                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                                                {row.location && (
                                                    <span className="text-gray-500">{row.location}</span>
                                                )}
                                                {row.website_url && (
                                                    <a
                                                        href={row.website_url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-blue-600 hover:underline"
                                                    >
                                                        {m.website}
                                                    </a>
                                                )}
                                                {row.linkedin_url && (
                                                    <a
                                                        href={row.linkedin_url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-blue-600 hover:underline"
                                                    >
                                                        {m.linkedin}
                                                    </a>
                                                )}
                                                {row.source_url && (
                                                    <a
                                                        href={row.source_url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-blue-600 hover:underline"
                                                    >
                                                        {m.source}
                                                    </a>
                                                )}
                                                {already && row.existing_lead_id && (
                                                    <Link
                                                        href={routes.crm.leadDetail(row.existing_lead_id)}
                                                        className="text-blue-600 hover:underline"
                                                    >
                                                        {row.existing_lead_name ?? m.viewLead}
                                                    </Link>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            {created.length > 0 && (
                <ul className="space-y-1">
                    {created.map((lead) => (
                        <li key={lead.id}>
                            <Link
                                href={routes.crm.leadDetail(lead.id)}
                                className="text-sm text-blue-600 hover:underline"
                            >
                                {m.viewLead}
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </PageShell>
    );
}
