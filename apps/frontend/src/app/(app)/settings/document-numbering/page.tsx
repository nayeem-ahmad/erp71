'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    NUMBERING_DOC_GROUPS,
    NUMBERING_DOC_GROUP_LABELS,
    NUMBERING_DOC_TYPES,
    NUMBERING_DOC_TYPE_INFO,
    NUMBERING_RESET_LABELS,
    NUMBERING_RESET_POLICIES,
    NUMBERING_SCOPE_LABELS,
    NUMBERING_SCOPES,
    NUMBERING_NEXT_NUMBER_MAX,
    NUMBERING_SEQ_WIDTH_MAX,
    NUMBERING_SEQ_WIDTH_MIN,
    NUMBERING_TEMPLATE_MAX_LENGTH,
    NUMBERING_TOKEN_LABELS,
    NUMBERING_TOKENS,
    documentNumberingPresets,
    isNumberingDocType,
    normalizeStoreCode,
    templateUsesToken,
    validateNumberingConfig,
    type DocumentNumberingConfig,
    type NumberingDocType,
    type NumberingResetPolicy,
} from '@erp71/shared-types';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { Alert, Button, CompactSection, ConfirmDialog, Field, Input, PageShell, Select, SkeletonBar } from '@/components/ui';
import PageHeader from '@/components/ui/compact/PageHeader';
import {
    counterRowsFor,
    periodLabel,
    previewNumber,
    storeCodeErrors,
    type DocumentNumberingData,
} from './numbering-rows';

const CUSTOM = 'custom';

const DOC_TYPE_GROUPS = NUMBERING_DOC_GROUPS.map((group) => ({
    group,
    types: NUMBERING_DOC_TYPES.filter((docType) => NUMBERING_DOC_TYPE_INFO[docType].group === group),
}));

/** `?type=PURCHASE` opens that document; anything else opens sales invoices. */
function docTypeFromUrl(): NumberingDocType {
    const type = new URLSearchParams(window.location.search).get('type')?.toUpperCase();
    return isNumberingDocType(type) ? type : 'SALE';
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const sameConfig = (a: DocumentNumberingConfig, b: DocumentNumberingConfig) =>
    a.template.trim() === b.template.trim()
    && a.resetPolicy === b.resetPolicy
    && a.scope === b.scope
    && a.seqWidth === b.seqWidth;

export default function DocumentNumberingPage() {
    const { t } = useI18n();
    const pageTitle = t.settings.hub.links.documentNumbering;

    /** Read from the URL after mount, so the server and first client render agree. */
    const [docType, setDocType] = useState<NumberingDocType | null>(null);
    /** A document picked while edits were unsaved, waiting on the discard prompt. */
    const [pendingDocType, setPendingDocType] = useState<NumberingDocType | null>(null);
    const [data, setData] = useState<DocumentNumberingData | null>(null);
    const [loadError, setLoadError] = useState('');
    const [saving, setSaving] = useState(false);

    const [config, setConfig] = useState<DocumentNumberingConfig | null>(null);
    /** Branch codes as typed, keyed by store id. */
    const [codes, setCodes] = useState<Record<string, string>>({});
    /** "Next number" as typed, keyed by scope key; absent means unchanged. */
    const [nextNumbers, setNextNumbers] = useState<Record<string, string>>({});
    const [submitted, setSubmitted] = useState(false);
    const templateRef = useRef<HTMLInputElement>(null);

    const adopt = useCallback((next: DocumentNumberingData) => {
        setData(next);
        setConfig(next.config);
        setCodes(Object.fromEntries(next.stores.map((s) => [s.id, s.code ?? ''])));
        setNextNumbers({});
        setSubmitted(false);
    }, []);

    useEffect(() => setDocType(docTypeFromUrl()), []);

    useEffect(() => {
        if (!docType) return;
        // A slow answer for the document the owner just left must not land on this one.
        let current = true;
        setData(null);
        setConfig(null);
        setLoadError('');
        api.getDocumentNumbering(docType)
            .then((next: DocumentNumberingData) => {
                if (current) adopt(next);
            })
            .catch((err: unknown) => {
                if (current) setLoadError(err instanceof Error ? err.message : 'Could not load document numbering.');
            });
        return () => {
            current = false;
        };
    }, [docType, adopt]);

    const dirty = Boolean(data && config) && (
        !sameConfig(config!, data!.config)
        || Object.keys(nextNumbers).length > 0
        || data!.stores.some((s) => (codes[s.id] ?? '') !== (s.code ?? ''))
    );

    const switchTo = (next: NumberingDocType) => {
        setPendingDocType(null);
        if (next === docType) return;
        setDocType(next);
        window.history.replaceState(null, '', `${window.location.pathname}?type=${next}`);
    };

    const requestDocType = (next: NumberingDocType) => {
        if (next !== docType && dirty) setPendingDocType(next);
        else switchTo(next);
    };

    const formatErrors = useMemo(
        () => (config && docType ? validateNumberingConfig(config, docType) : []),
        [config, docType],
    );
    const usesStore = config ? templateUsesToken(config.template, 'STORE') : false;
    const codeErrors = useMemo(
        () => (data && usesStore ? storeCodeErrors(data.stores, codes) : {}),
        [data, usesStore, codes],
    );
    const rows = useMemo(() => (config && data ? counterRowsFor(config, data) : []), [config, data]);

    const nextNumberError = (scopeKey: string, currentNext: number): string => {
        const raw = nextNumbers[scopeKey];
        if (raw === undefined) return '';
        const value = Number(raw);
        if (!raw.trim() || !Number.isInteger(value) || value < 1) return 'Enter a whole number.';
        if (value > NUMBERING_NEXT_NUMBER_MAX) return 'That number is too large.';
        if (value < currentNext) return `Cannot go below ${currentNext} — lower numbers may already be printed.`;
        return '';
    };

    /** The number a counter would issue next: what was typed, once it is a valid one. */
    const seqFor = (scopeKey: string, currentNext: number): number => {
        const typed = nextNumbers[scopeKey];
        return typed !== undefined && !nextNumberError(scopeKey, currentNext) ? Number(typed) : currentNext;
    };

    const subtitle = 'Choose how each kind of document is numbered';
    const docTypePicker = (
        <Field label="Document" htmlFor="numbering-doc-type" className="max-w-sm">
            <Select
                id="numbering-doc-type"
                value={docType ?? 'SALE'}
                onChange={(e) => requestDocType(e.target.value as NumberingDocType)}
                className="w-full"
            >
                {DOC_TYPE_GROUPS.map(({ group, types }) => (
                    <optgroup key={group} label={NUMBERING_DOC_GROUP_LABELS[group]}>
                        {types.map((type) => (
                            <option key={type} value={type}>{NUMBERING_DOC_TYPE_INFO[type].label}</option>
                        ))}
                    </optgroup>
                ))}
            </Select>
        </Field>
    );

    if (loadError || !docType || !data || !config) {
        return (
            <PageShell maxWidth="narrow">
                <PageHeader title={pageTitle} subtitle={subtitle} breadcrumbs={breadcrumbs(t, pageTitle)} />
                <div className="mt-4 space-y-4">
                    {docTypePicker}
                    {loadError ? (
                        <Alert tone="danger">{loadError}</Alert>
                    ) : (
                        <div className="space-y-3" aria-busy="true">
                            <SkeletonBar className="h-4 w-1/3" />
                            <SkeletonBar className="h-9 w-full" />
                            <SkeletonBar className="h-9 w-2/3" />
                        </div>
                    )}
                </div>
            </PageShell>
        );
    }

    const info = NUMBERING_DOC_TYPE_INFO[docType];
    const presets = documentNumberingPresets(docType);
    const preset = presets.find((p) => sameConfig(p.config, config))?.key ?? CUSTOM;
    // A branch with no code yet gets the next S<n> on save; the preview says so.
    const codeFor = (storeId: string) =>
        normalizeStoreCode(codes[storeId]) ?? data.stores.find((s) => s.id === storeId)?.code ?? 'S?';
    const savedConfigChanged = !sameConfig(config, data.config);
    const seriesChanged = config.resetPolicy !== data.config.resetPolicy || config.scope !== data.config.scope;

    const update = (patch: Partial<DocumentNumberingConfig>) => setConfig({ ...config, ...patch });

    const insertToken = (token: string) => {
        const input = templateRef.current;
        const text = `{${token}}`;
        const start = input?.selectionStart ?? config.template.length;
        const end = input?.selectionEnd ?? config.template.length;
        update({ template: config.template.slice(0, start) + text + config.template.slice(end) });
        requestAnimationFrame(() => {
            input?.focus();
            input?.setSelectionRange(start + text.length, start + text.length);
        });
    };

    const handleSave = async () => {
        setSubmitted(true);
        const rowErrors = rows.some((row) => nextNumberError(row.scopeKey, row.currentNext));
        if (formatErrors.length > 0 || Object.keys(codeErrors).length > 0 || rowErrors) return;

        const storeCodes = usesStore
            ? data.stores
                .map((s) => ({ storeId: s.id, code: normalizeStoreCode(codes[s.id]) ?? '' }))
                .filter((c) => c.code !== (data.stores.find((s) => s.id === c.storeId)?.code ?? ''))
            : [];
        const changedNumbers = rows
            .filter((row) => nextNumbers[row.scopeKey] !== undefined && Number(nextNumbers[row.scopeKey]) !== row.currentNext)
            .map((row) => ({ scopeKey: row.scopeKey, nextNumber: Number(nextNumbers[row.scopeKey]) }));

        setSaving(true);
        try {
            const saved = await api.updateDocumentNumbering(docType, {
                ...config,
                template: config.template.trim(),
                ...(storeCodes.length > 0 ? { storeCodes } : {}),
                ...(changedNumbers.length > 0 ? { nextNumbers: changedNumbers } : {}),
            });
            adopt(saved);
            toast.success('Document numbering saved');
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Could not save document numbering');
        } finally {
            setSaving(false);
        }
    };

    return (
        <PageShell maxWidth="narrow">
            <PageHeader
                title={pageTitle}
                subtitle={subtitle}
                breadcrumbs={breadcrumbs(t, pageTitle)}
                actions={(
                    <Button onClick={handleSave} disabled={saving} loading={saving}>
                        {saving ? 'Saving...' : 'Save'}
                    </Button>
                )}
            />

            <div className="mt-4 space-y-4">
                {docTypePicker}

                <CompactSection title={`${info.label} number`} titleStyle="heading">
                    <div className="space-y-4">
                        <Field label="Start from" htmlFor="numbering-preset" className="max-w-sm">
                            <Select
                                id="numbering-preset"
                                value={preset}
                                onChange={(e) => {
                                    const chosen = presets.find((p) => p.key === e.target.value);
                                    if (chosen) setConfig({ ...chosen.config });
                                }}
                                className="w-full"
                            >
                                {presets.map((p) => (
                                    <option key={p.key} value={p.key}>{p.label}</option>
                                ))}
                                <option value={CUSTOM} disabled>Custom</option>
                            </Select>
                        </Field>

                        <Field
                            label="Format"
                            htmlFor="numbering-template"
                            required
                            error={submitted || config.template.trim() ? formatErrors[0] : undefined}
                        >
                            <Input
                                id="numbering-template"
                                ref={templateRef}
                                value={config.template}
                                maxLength={NUMBERING_TEMPLATE_MAX_LENGTH}
                                onChange={(e) => update({ template: e.target.value })}
                                className="w-full font-mono"
                                spellCheck={false}
                                autoComplete="off"
                            />
                        </Field>
                        {formatErrors.length > 1 && (
                            <ul className="-mt-2 space-y-1 text-xs text-danger">
                                {formatErrors.slice(1).map((error) => <li key={error}>{error}</li>)}
                            </ul>
                        )}

                        <div>
                            <p className="text-xs font-medium text-gray-600">Insert</p>
                            <div className="mt-1 flex flex-wrap gap-2">
                                {NUMBERING_TOKENS.map((token) => (
                                    <Button
                                        key={token}
                                        variant="secondary"
                                        onClick={() => insertToken(token)}
                                        title={NUMBERING_TOKEN_LABELS[token]}
                                        className="max-md:min-h-touch"
                                    >
                                        <span className="font-mono">{`{${token}}`}</span>
                                        <span className="text-gray-400">{NUMBERING_TOKEN_LABELS[token]}</span>
                                    </Button>
                                ))}
                            </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-3">
                            <Field label="Starts again at 1" htmlFor="numbering-reset">
                                <Select
                                    id="numbering-reset"
                                    value={config.resetPolicy}
                                    onChange={(e) => update({ resetPolicy: e.target.value as NumberingResetPolicy })}
                                    className="w-full"
                                >
                                    {NUMBERING_RESET_POLICIES.map((policy) => (
                                        <option key={policy} value={policy}>{NUMBERING_RESET_LABELS[policy]}</option>
                                    ))}
                                </Select>
                            </Field>
                            <Field label="Series" htmlFor="numbering-scope">
                                <Select
                                    id="numbering-scope"
                                    value={config.scope}
                                    onChange={(e) => update({ scope: e.target.value as DocumentNumberingConfig['scope'] })}
                                    className="w-full"
                                >
                                    {NUMBERING_SCOPES.filter((scope) => info.scopes.includes(scope)).map((scope) => (
                                        <option key={scope} value={scope}>{NUMBERING_SCOPE_LABELS[scope]}</option>
                                    ))}
                                </Select>
                            </Field>
                            <Field label="Minimum digits" htmlFor="numbering-width" hint="Padded with zeros: 5 gives 00042.">
                                <Input
                                    id="numbering-width"
                                    type="number"
                                    min={NUMBERING_SEQ_WIDTH_MIN}
                                    max={NUMBERING_SEQ_WIDTH_MAX}
                                    value={config.seqWidth}
                                    onChange={(e) => update({ seqWidth: Number(e.target.value) })}
                                    className="w-full"
                                />
                            </Field>
                        </div>

                        {formatErrors.length === 0 && rows[0] && (
                            <p className="text-sm text-gray-700">
                                Next number:{' '}
                                <span className="font-mono font-semibold text-gray-900">
                                    {previewNumber(
                                        config,
                                        rows[0],
                                        seqFor(rows[0].scopeKey, rows[0].currentNext),
                                        data.today,
                                        codeFor,
                                    )}
                                </span>
                            </p>
                        )}
                    </div>
                </CompactSection>

                {usesStore && (
                    <CompactSection title="Branch codes" titleStyle="heading">
                        <p className="mb-3 text-xs text-gray-500">
                            Printed where the format says {'{STORE}'}. Up to 6 letters or digits, different for each branch.
                        </p>
                        <div className="space-y-3">
                            {data.stores.map((store) => (
                                <Field
                                    key={store.id}
                                    label={store.name}
                                    htmlFor={`code-${store.id}`}
                                    error={codeErrors[store.id]}
                                    hint={!store.code && !codes[store.id] ? 'Left blank, one is assigned when you save.' : undefined}
                                >
                                    <Input
                                        id={`code-${store.id}`}
                                        value={codes[store.id] ?? ''}
                                        maxLength={6}
                                        onChange={(e) => setCodes({ ...codes, [store.id]: e.target.value.toUpperCase() })}
                                        className="w-32 font-mono uppercase"
                                        autoComplete="off"
                                    />
                                </Field>
                            ))}
                        </div>
                    </CompactSection>
                )}

                {formatErrors.length === 0 && (
                    <CompactSection title={`Next number — ${periodLabel(config, data.today)}`} titleStyle="heading">
                        <p className="mb-3 text-xs text-gray-500">
                            Moving over from another system? Set where each series continues from. A number can only
                            go up: lower ones may already be printed.
                        </p>
                        <div className="space-y-3">
                            {rows.map((row) => {
                                const typed = nextNumbers[row.scopeKey];
                                const error = nextNumberError(row.scopeKey, row.currentNext);
                                const seq = seqFor(row.scopeKey, row.currentNext);
                                return (
                                    <div key={row.scopeKey || 'tenant'} className="flex flex-wrap items-start gap-3">
                                        <Field
                                            label={row.label}
                                            htmlFor={`next-${row.scopeKey || 'tenant'}`}
                                            error={error || undefined}
                                            className="min-w-0 flex-1"
                                        >
                                            <Input
                                                id={`next-${row.scopeKey || 'tenant'}`}
                                                type="number"
                                                min={row.currentNext}
                                                value={typed ?? String(row.currentNext)}
                                                onChange={(e) => setNextNumbers({ ...nextNumbers, [row.scopeKey]: e.target.value })}
                                                className="w-40"
                                            />
                                        </Field>
                                        <p className="pt-6 font-mono text-sm text-gray-700">
                                            {previewNumber(config, row, seq, data.today, codeFor)}
                                        </p>
                                    </div>
                                );
                            })}
                        </div>
                    </CompactSection>
                )}

                <Alert tone="info">
                    Only new {info.plural} change. {capitalize(info.plural)} already issued keep their numbers
                    {docType === 'SALE' ? ', and a parked draft gets its number when it is completed.' : '.'}
                    {savedConfigChanged && seriesChanged
                        ? ' A different reset or series starts its counters at 1 unless you set a next number above.'
                        : ''}
                </Alert>
            </div>

            <ConfirmDialog
                open={pendingDocType !== null}
                title="Discard unsaved changes?"
                prompt="Your changes on this page have not been saved. Switching to another document discards them."
                confirmLabel="Discard changes"
                cancelLabel="Keep editing"
                danger
                onConfirm={() => pendingDocType && switchTo(pendingDocType)}
                onCancel={() => setPendingDocType(null)}
            />
        </PageShell>
    );
}

function breadcrumbs(t: ReturnType<typeof useI18n>['t'], pageTitle: string) {
    return modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.accountSettings, pageTitle, 'settings');
}
