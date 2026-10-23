'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, RefreshCw, Eye, Trash2, Upload, ScanLine } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { DEFAULT_PAGE_SIZE } from '@/lib/ui/compact-density';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, createdAtColumn, type BulkAction, type ResolvedListFilter } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import { applyCreatedRangeQuery, type CreatedRange } from '@/lib/created-range';
import { fetchAllPages } from '@/components/data-table/fetch-all-pages';
import { ImportDialog, type ImportField } from '@/components/import-dialog';
import { PageShell, PageHeader, Button, ConfirmDialog, buttonClassName } from '@/components/ui';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { useCrmMineOnly } from '@/lib/crm-scope';
import { useServerColumnFilters } from '@/lib/column-filters';
import MineOnlyToggle from '@/components/crm/MineOnlyToggle';
import Avatar from '@/components/Avatar';
import BusinessCardScanner, { type ScannedCard, type ScannedCardImage } from './BusinessCardScanner';
import {
    CONTACT_CAPTURE_SOURCES,
    SCANNED_CARD_IMAGE_STORAGE_KEY,
    SCANNED_CARD_STORAGE_KEY,
} from './contact-form-fields';

interface Contact {
    id: string;
    name: string;
    company: string | null;
    designation: string | null;
    mobile: string | null;
    phone: string | null;
    email: string | null;
    capture_source: string;
    photo_url: string | null;
    assignee: { id: string; name: string } | null;
    created_at: string;
}

const columnHelper = createColumnHelper<Contact>();

const CONTACT_IMPORT_FIELDS: ImportField[] = [
    { key: 'name', label: 'Name', required: true },
    { key: 'company', label: 'Company', required: false },
    { key: 'designation', label: 'Designation', required: false },
    { key: 'mobile', label: 'Mobile', required: false },
    { key: 'phone', label: 'Office Phone', required: false },
    { key: 'email', label: 'Email', required: false },
    { key: 'address', label: 'Address', required: false },
    { key: 'website_url', label: 'Website', required: false },
    { key: 'linkedin_url', label: 'LinkedIn URL', required: false },
    { key: 'notes', label: 'Notes', required: false },
];

export default function ContactsPage() {
    const { t, locale } = useI18n();
    const m = t.crm.contacts;
    const scopeCopy = t.crm.scope;
    const c = t.common;
    const router = useRouter();

    const [contacts, setContacts] = useState<Contact[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [captureSourceFilter, setCaptureSourceFilter] = useState('');
    const [assignedFilter, setAssignedFilter] = useState('');
    /**
     * "Only my contacts" — the CRM-wide scope, shared with the Overview and the
     * other CRM lists and remembered across visits. `scopeReady` holds the first
     * request until the stored choice is in, so the page does not paint the whole
     * team's contacts and then replace them.
     */
    const { mineOnly, setMineOnly, ready: scopeReady } = useCrmMineOnly();
    const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
    const [importOpen, setImportOpen] = useState(false);
    const [scannerOpen, setScannerOpen] = useState(false);
    const [teamMembers, setTeamMembers] = useState<any[]>([]);
    const [selected, setSelected] = useState<Contact[]>([]);
    const [selectionEpoch, setSelectionEpoch] = useState(0);
    const [bulkBusy, setBulkBusy] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<Contact | null>(null);
    const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
    const [sort, setSort] = useState<{ id: string; desc: boolean } | null>(null);
    // The table's advanced filters, sent to the server — see useServerColumnFilters.
    const { columnFilters, setColumnFilters, filters: columnFilterParam } = useServerColumnFilters();
    // Only the latest in-flight request may commit — a filter change while on a
    // later page fires a stale fetch alongside the reset-to-page-1 one.
    const loadSeq = useRef(0);

    useEffect(() => {
        api.getCrmAssignees().then((d: any) => setTeamMembers(Array.isArray(d) ? d : [])).catch(() => setTeamMembers([]));
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(timer);
    }, [search]);

    const fetchAllRows = useCallback(
        (onProgress?: (loaded: number, total: number) => void) =>
            fetchAllPages(
                ({ page: p, limit, sortBy, sortDir }) =>
                    api.getContacts({
                        search: debouncedSearch || undefined,
                        captureSource: captureSourceFilter || undefined,
                        assignedTo: assignedFilter || undefined,
                        mine: mineOnly || undefined,
                        page: p,
                        limit,
                        sortBy,
                        sortDir,
                        ...applyCreatedRangeQuery(createdRange),
                        filters: columnFilterParam,
                    }),
                { sort, onProgress },
            ),
        [debouncedSearch, captureSourceFilter, assignedFilter, mineOnly, createdRange, columnFilterParam, sort],
    );

    const loadContacts = useCallback(async () => {
        if (!scopeReady) return;
        const seq = ++loadSeq.current;
        setLoading(true);
        try {
            const data = await api.getContacts({
                search: debouncedSearch || undefined,
                captureSource: captureSourceFilter || undefined,
                assignedTo: assignedFilter || undefined,
                mine: mineOnly || undefined,
                page,
                limit: pageSize,
                sortBy: sort?.id,
                sortDir: sort ? (sort.desc ? 'desc' : 'asc') : undefined,
                ...applyCreatedRangeQuery(createdRange),
                filters: columnFilterParam,
            });
            if (seq !== loadSeq.current) return;
            setContacts(data?.items ?? []);
            setTotal(data?.total ?? 0);
        } catch {
            if (seq !== loadSeq.current) return;
            setContacts([]);
            setTotal(0);
        } finally {
            if (seq === loadSeq.current) setLoading(false);
        }
    }, [debouncedSearch, captureSourceFilter, assignedFilter, mineOnly, scopeReady, createdRange, columnFilterParam, page, pageSize, sort]);

    useEffect(() => { void loadContacts(); }, [loadContacts]);

    useEffect(() => {
        setPage(1);
    }, [debouncedSearch, captureSourceFilter, assignedFilter, createdRange, columnFilterParam, sort]);

    const clearSelection = useCallback(() => {
        setSelected([]);
        setSelectionEpoch((e) => e + 1);
    }, []);

    const confirmDelete = useCallback(async () => {
        if (!pendingDelete) return;
        try {
            await api.deleteContact(pendingDelete.id);
            setPendingDelete(null);
            await loadContacts();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : m.deleteFailed);
        }
    }, [pendingDelete, loadContacts, m.deleteFailed]);

    const runBulkAction = useCallback(async (action: 'delete' | 'assign', value?: string) => {
        const ids = selected.map((s) => s.id);
        if (!ids.length) return;
        setBulkBusy(true);
        try {
            await api.bulkContactAction(ids, action, value);
            await loadContacts();
            clearSelection();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : m.actionFailed);
        } finally {
            setBulkBusy(false);
            setBulkDeleteOpen(false);
        }
    }, [selected, loadContacts, clearSelection, m.actionFailed]);

    /**
     * A scan started from the list has nowhere to put its result, so it is
     * handed to the create form through sessionStorage and the user lands on a
     * pre-filled form rather than an already-saved contact they never reviewed.
     */
    const applyScan = useCallback((fields: ScannedCard, image: ScannedCardImage | null) => {
        try {
            sessionStorage.setItem(SCANNED_CARD_STORAGE_KEY, JSON.stringify(fields));
        } catch {
            // Private-mode storage failures are not worth blocking on; the form
            // simply opens empty.
        }
        // Written separately so a photo that blows the quota still leaves the
        // fields above intact — losing the card is a smaller loss than losing
        // everything the scan read off it.
        try {
            if (image) sessionStorage.setItem(SCANNED_CARD_IMAGE_STORAGE_KEY, JSON.stringify(image));
            else sessionStorage.removeItem(SCANNED_CARD_IMAGE_STORAGE_KEY);
        } catch {
            // The contact is still created; it simply arrives without its card.
        }
        setScannerOpen(false);
        router.push(routes.crm.contactNew);
    }, [router]);

    const captureSourceLabel = useCallback(
        (value: string) => (m.captureSources as Record<string, string>)[value] ?? value,
        [m.captureSources],
    );

    const columns: ColumnDef<Contact, any>[] = useMemo(() => [
        columnHelper.accessor('name', {
            header: m.fields.name,
            // Accessor and id are unchanged, so the server-side sort key still
            // works — the avatar rides along inside the same column.
            cell: (info) => (
                <div className="flex items-center gap-2.5">
                    <Avatar src={info.row.original.photo_url} name={info.row.original.name} />
                    <Link
                        href={routes.crm.contactDetail(info.row.original.id)}
                        className="text-blue-600 hover:underline"
                    >
                        {info.getValue()}
                    </Link>
                </div>
            ),
        }),
        columnHelper.accessor('company', {
            header: m.fields.company,
            cell: (info) => info.getValue() || '—',
        }),
        columnHelper.accessor('designation', {
            header: m.fields.designation,
            cell: (info) => info.getValue() || '—',
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor('mobile', {
            header: m.fields.mobile,
            cell: (info) => info.getValue() || '—',
            enableSorting: false,
        }),
        columnHelper.accessor('email', {
            header: m.fields.email,
            cell: (info) => info.getValue() || '—',
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor('capture_source', {
            header: m.fields.captureSource,
            cell: (info) => captureSourceLabel(info.getValue()),
            enableSorting: false,
            enableColumnFilter: false,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor('assignee', {
            header: m.fields.assignedTo,
            cell: (info) => info.getValue()?.name ?? '—',
            enableSorting: false,
            enableColumnFilter: false,
            meta: { hideOnMobile: true },
        }),
        createdAtColumn(columnHelper, { header: c.createdAt, locale, enableColumnFilter: false }),
        columnHelper.display({
            id: 'actions',
            header: c.actions,
            cell: (info) => {
                const contact = info.row.original;
                return (
                    <RowActions>
                        <RowActionButton icon={<Eye />} label={c.view} href={routes.crm.contactDetail(contact.id)} />
                        <RowActionButton icon={<Trash2 />} label={c.delete} intent="danger" onClick={() => setPendingDelete(contact)} />
                    </RowActions>
                );
            },
            enableSorting: false,
            enableColumnFilter: false,
            enableResizing: false,
            size: 96,
        }),
    ], [m, c, locale, captureSourceLabel]);

    const ownerOptions = useMemo(
        () => teamMembers.flatMap((mem) => {
            const id = mem.userId ?? mem.user_id ?? mem.user?.id;
            const label = mem.name ?? mem.user?.name ?? mem.email ?? mem.user?.email ?? id;
            return id ? [{ value: id as string, label: label as string }] : [];
        }),
        [teamMembers],
    );

    const listFilters = useMemo<ResolvedListFilter[]>(() => [
        {
            id: 'capture',
            type: 'select',
            label: m.fields.captureSource,
            value: captureSourceFilter || null,
            onChange: (next) => setCaptureSourceFilter(next ?? ''),
            options: CONTACT_CAPTURE_SOURCES.map((source) => ({ value: source, label: captureSourceLabel(source) })),
        },
        {
            id: 'owner',
            type: 'select',
            label: m.fields.assignedTo,
            value: mineOnly ? null : (assignedFilter || null),
            onChange: (next) => setAssignedFilter(next ?? ''),
            disabled: mineOnly,
            title: mineOnly ? scopeCopy.ownerLockedHint : undefined,
            options: ownerOptions,
        },
        {
            id: 'created',
            type: 'date-range',
            value: createdRange,
            onChange: setCreatedRange,
        },
    ], [m.fields.captureSource, m.fields.assignedTo, captureSourceFilter, captureSourceLabel, mineOnly, assignedFilter, scopeCopy.ownerLockedHint, ownerOptions, createdRange]);

    const bulkActions: BulkAction<Contact>[] = useMemo(
        () => [
            {
                label: c.delete,
                tone: 'danger',
                icon: <Trash2 className="w-4 h-4" />,
                onClick: () => setBulkDeleteOpen(true),
            },
        ],
        [c.delete],
    );

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
                    <>
                        {/* The scope, not a filter: it outlives the tab and is shared
                            with the Overview and the other CRM lists, and it stays
                            in the header so it is not buried among the toolbar chips. */}
                        <MineOnlyToggle
                            value={mineOnly}
                            onChange={setMineOnly}
                            label={scopeCopy.mineOnly}
                            title={scopeCopy.mineOnlyHint}
                        />
                        <Button variant="secondary" onClick={loadContacts} leftIcon={<RefreshCw className="w-4 h-4" />} />
                        <Button variant="secondary" onClick={() => setImportOpen(true)} leftIcon={<Upload className="w-4 h-4" />}>
                            Import
                        </Button>
                        <Button variant="secondary" onClick={() => setScannerOpen(true)} leftIcon={<ScanLine className="w-4 h-4" />}>
                            {m.scan.cta}
                        </Button>
                        <Link href={routes.crm.contactNew} className={buttonClassName()}>
                            <Plus className="w-4 h-4" /> {m.newContact}
                        </Link>
                    </>
                }
            />

            <DataTable<Contact>
                tableId="crm-contacts"
                title={m.title}
                data={contacts}
                columns={columns}
                isLoading={loading}
                searchPlaceholder={m.searchPlaceholder}
                searchValue={search}
                onSearchChange={setSearch}
                filters={listFilters}
                viewOptions
                serverPagination={{
                    total,
                    page,
                    pageSize,
                    onPageChange: setPage,
                    onPageSizeChange: (size) => { setPageSize(size); setPage(1); },
                    sort,
                    onSortChange: setSort,
                    fetchAllRows,
                    columnFilters,
                    onColumnFiltersChange: setColumnFilters,
                }}
                enableRowSelection
                onRowSelectionChange={setSelected}
                getRowId={(row) => row.id}
                emptyMessage={m.emptyMessage}
                clearSelectionSignal={selectionEpoch}
                bulkActions={bulkActions}
                bulkActionsDisabled={bulkBusy}
                renderBulkExtra={() => (
                    <select
                        value=""
                        disabled={bulkBusy}
                        onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v) void runBulkAction('assign', v === '__unassign__' ? '' : v); }}
                        className="border border-primary-border bg-white rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
                    >
                        <option value="">{m.bulkAssign}</option>
                        <option value="__unassign__">{m.bulkUnassign}</option>
                        {teamMembers.map((mem) => {
                            const id = mem.userId ?? mem.user_id ?? mem.user?.id;
                            const label = mem.name ?? mem.user?.name ?? mem.email ?? mem.user?.email ?? id;
                            return id ? <option key={id} value={id}>{label}</option> : null;
                        })}
                    </select>
                )}
            />

            <BusinessCardScanner
                open={scannerOpen}
                onClose={() => setScannerOpen(false)}
                onApply={applyScan}
            />

            <ImportDialog
                open={importOpen}
                onClose={() => setImportOpen(false)}
                entityLabel="Contacts"
                fields={CONTACT_IMPORT_FIELDS}
                importFn={(rows, mode) => api.importContacts(rows, mode)}
                onSuccess={() => void loadContacts()}
            />

            <ConfirmDialog
                open={Boolean(pendingDelete)}
                title={c.delete}
                prompt={m.deleteConfirm}
                confirmLabel={c.delete}
                cancelLabel={c.cancel}
                danger
                onConfirm={() => void confirmDelete()}
                onCancel={() => setPendingDelete(null)}
            />

            <ConfirmDialog
                open={bulkDeleteOpen}
                title={c.delete}
                prompt={m.bulkDeleteConfirm.replace('{count}', String(selected.length))}
                confirmLabel={c.delete}
                cancelLabel={c.cancel}
                loading={bulkBusy}
                danger
                onConfirm={() => void runBulkAction('delete')}
                onCancel={() => setBulkDeleteOpen(false)}
            />
        </PageShell>
    );
}
