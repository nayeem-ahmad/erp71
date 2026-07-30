'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, RefreshCw, Search, Eye, Trash2, Upload, ScanLine } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { DEFAULT_PAGE_SIZE, compactDensity } from '@/lib/ui/compact-density';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, type BulkAction } from '@/components/data-table';
import { ImportDialog, type ImportField } from '@/components/import-dialog';
import { PageShell, PageHeader, Button, Select, Input, ConfirmDialog } from '@/components/ui';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import BusinessCardScanner, { type ScannedCard } from './BusinessCardScanner';
import { CONTACT_CAPTURE_SOURCES, SCANNED_CARD_STORAGE_KEY } from './contact-form-fields';

interface Contact {
    id: string;
    name: string;
    company: string | null;
    designation: string | null;
    mobile: string | null;
    phone: string | null;
    email: string | null;
    capture_source: string;
    assignee: { id: string; name: string } | null;
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
    const { t } = useI18n();
    const m = t.crm.contacts;
    const c = t.common;
    const router = useRouter();

    const [contacts, setContacts] = useState<Contact[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [captureSourceFilter, setCaptureSourceFilter] = useState('');
    const [assignedFilter, setAssignedFilter] = useState('');
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
    // Only the latest in-flight request may commit — a filter change while on a
    // later page fires a stale fetch alongside the reset-to-page-1 one.
    const loadSeq = useRef(0);

    useEffect(() => {
        api.getTeamMembers().then((d: any) => setTeamMembers(Array.isArray(d) ? d : [])).catch(() => setTeamMembers([]));
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 300);
        return () => clearTimeout(timer);
    }, [search]);

    const loadContacts = useCallback(async () => {
        const seq = ++loadSeq.current;
        setLoading(true);
        try {
            const data = await api.getContacts({
                search: debouncedSearch || undefined,
                captureSource: captureSourceFilter || undefined,
                assignedTo: assignedFilter || undefined,
                page,
                limit: pageSize,
                sortBy: sort?.id,
                sortDir: sort ? (sort.desc ? 'desc' : 'asc') : undefined,
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
    }, [debouncedSearch, captureSourceFilter, assignedFilter, page, pageSize, sort]);

    useEffect(() => { void loadContacts(); }, [loadContacts]);

    useEffect(() => {
        setPage(1);
    }, [debouncedSearch, captureSourceFilter, assignedFilter, sort]);

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
    const applyScan = useCallback((fields: ScannedCard) => {
        try {
            sessionStorage.setItem(SCANNED_CARD_STORAGE_KEY, JSON.stringify(fields));
        } catch {
            // Private-mode storage failures are not worth blocking on; the form
            // simply opens empty.
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
            cell: (info) => (
                <Link
                    href={routes.crm.contactDetail(info.row.original.id)}
                    className="font-semibold text-gray-900 hover:text-primary"
                >
                    {info.getValue()}
                </Link>
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
            cell: (info) => (
                <span className="text-xs text-gray-500">{captureSourceLabel(info.getValue())}</span>
            ),
            enableSorting: false,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor('assignee', {
            header: m.fields.assignedTo,
            cell: (info) => info.getValue()?.name ?? '—',
            enableSorting: false,
            meta: { hideOnMobile: true },
        }),
        columnHelper.display({
            id: 'actions',
            header: c.actions,
            cell: (info) => {
                const contact = info.row.original;
                return (
                    <div className="flex items-center justify-end gap-1">
                        <Link
                            href={routes.crm.contactDetail(contact.id)}
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                            title={c.view}
                        >
                            <Eye className="w-4 h-4" />
                        </Link>
                        <button
                            type="button"
                            onClick={() => setPendingDelete(contact)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-danger-light transition-colors"
                            title={c.delete}
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                );
            },
            enableSorting: false,
            enableColumnFilter: false,
            enableResizing: false,
            size: 90,
        }),
    ], [m, c, captureSourceLabel]);

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
                        <Button variant="secondary" onClick={loadContacts} leftIcon={<RefreshCw className="w-4 h-4" />} />
                        <Button variant="secondary" onClick={() => setImportOpen(true)} leftIcon={<Upload className="w-4 h-4" />}>
                            Import
                        </Button>
                        <Button variant="secondary" onClick={() => setScannerOpen(true)} leftIcon={<ScanLine className="w-4 h-4" />}>
                            {m.scan.cta}
                        </Button>
                        <Link
                            href={routes.crm.contactNew}
                            className={`${compactDensity.btnPrimary} bg-blue-600 text-white hover:bg-blue-700`}
                        >
                            <Plus className="w-4 h-4" /> {m.newContact}
                        </Link>
                    </>
                }
            />

            <div className="flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={m.searchPlaceholder}
                        className="pl-9"
                    />
                </div>
                <Select
                    value={captureSourceFilter}
                    onChange={(e) => setCaptureSourceFilter(e.target.value)}
                    className="w-auto max-w-[200px]"
                >
                    <option value="">{m.allCaptureSources}</option>
                    {CONTACT_CAPTURE_SOURCES.map((s) => (
                        <option key={s} value={s}>{captureSourceLabel(s)}</option>
                    ))}
                </Select>
                <Select
                    value={assignedFilter}
                    onChange={(e) => setAssignedFilter(e.target.value)}
                    className="w-auto max-w-[200px]"
                >
                    <option value="">{m.fields.assignedTo}</option>
                    {teamMembers.map((mem) => {
                        const id = mem.userId ?? mem.user_id ?? mem.user?.id;
                        const label = mem.name ?? mem.user?.name ?? mem.email ?? mem.user?.email ?? id;
                        return id ? <option key={id} value={id}>{label}</option> : null;
                    })}
                </Select>
            </div>

            <DataTable<Contact>
                tableId="crm-contacts"
                title={m.title}
                data={contacts}
                columns={columns}
                isLoading={loading}
                showSearch={false}
                serverPagination={{
                    total,
                    page,
                    pageSize,
                    onPageChange: setPage,
                    onPageSizeChange: (size) => { setPageSize(size); setPage(1); },
                    sort,
                    onSortChange: setSort,
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
