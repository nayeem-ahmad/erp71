'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Ship, Plus, PackageCheck, Pencil, Trash2, Ban, Landmark, FileText, Paperclip, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT, formatCurrency, formatDate } from '@/lib/format';
import { routes } from '@/lib/routes';
import { useI18n, formatMessage } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Alert, Select, ConfirmDialog } from '@/components/ui';
import { compactDensity } from '@/lib/ui/compact-density';
import AddImportCostModal from './AddImportCostModal';
import SettleLcModal from './SettleLcModal';
import PayCostModal from './PayCostModal';
import AddDocumentModal from './AddDocumentModal';
import CancelShipmentModal from './CancelShipmentModal';

/** Mirrors SHIPMENT_FLOW in the backend, minus the states set only by actions. */
const FLOW = ['DRAFT', 'LC_APPLIED', 'LC_ISSUED', 'SHIPPED', 'DOCS_RECEIVED', 'CUSTOMS'];

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
    if (value === null || value === undefined || value === '') return null;
    return (
        <div>
            <dt className="text-xs text-gray-500">{label}</dt>
            <dd className="text-sm text-gray-900">{value}</dd>
        </div>
    );
}

type Pending = 'receive' | 'delete' | 'accept' | { cost: string } | null;

export default function ImportShipmentDetailPage() {
    const { t, locale } = useI18n();
    const copy = t.imports;
    const { id } = useParams();
    const router = useRouter();

    const [shipment, setShipment] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [showCostModal, setShowCostModal] = useState(false);
    const [showSettleModal, setShowSettleModal] = useState(false);
    const [showDocumentModal, setShowDocumentModal] = useState(false);
    const [payingCost, setPayingCost] = useState<any>(null);
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [confirm, setConfirm] = useState<Pending>(null);

    const load = useCallback(() => {
        api.getImportShipment(id as string)
            .then(setShipment)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [id]);

    useEffect(load, [load]);

    /**
     * Only states the backend will actually accept.
     *
     * The menu used to offer every intermediate state regardless of where the
     * shipment was, so picking LC_APPLIED from CUSTOMS produced a 400. The rule
     * is `canTransition`: forward only, skipping ahead allowed.
     */
    const advanceable = useMemo(() => {
        if (!shipment) return [];
        const at = FLOW.indexOf(shipment.status);
        // A status off the flow (RECEIVED, CLOSED, CANCELLED) advances nowhere.
        return at === -1 ? [] : FLOW.slice(at + 1);
    }, [shipment]);

    const run = async (action: () => Promise<unknown>, failure: string) => {
        setBusy(true);
        try {
            await action();
            return true;
        } catch (error: any) {
            toast.error(error.message || failure);
            return false;
        } finally {
            setBusy(false);
            setConfirm(null);
        }
    };

    const advance = (status: string) =>
        run(async () => {
            await api.updateImportShipmentStatus(id as string, status);
            load();
        }, copy.detail.statusFailed);

    const receive = () =>
        run(async () => {
            const result = await api.receiveImportShipment(id as string);
            toast.success(formatMessage(copy.detail.received, { purchase: result.purchase_number }));
            load();
        }, copy.detail.receiveFailed);

    const accept = () =>
        run(async () => {
            await api.acceptImportShipment(id as string);
            toast.success(copy.accept.done);
            load();
        }, copy.accept.failed);

    const remove = async () => {
        const ok = await run(async () => {
            await api.deleteImportShipment(id as string);
            toast.success(copy.detail.deleted);
        }, copy.detail.statusFailed);
        if (ok) router.push(routes.purchases.imports.root);
    };

    const removeCost = (costId: string) =>
        run(async () => {
            await api.deleteImportCost(id as string, costId);
            toast.success(copy.cost.deleted);
            load();
        }, copy.cost.failed);

    const removeDocument = (documentId: string) =>
        run(async () => {
            await api.deleteImportDocument(id as string, documentId);
            toast.success(copy.documents.removed);
            load();
        }, copy.documents.uploadFailed);

    if (loading) return <PageShell><p className="text-sm text-gray-500">{t.common.loading}</p></PageShell>;
    if (!shipment) return <PageShell><p className="text-sm text-gray-500">{t.common.noData}</p></PageShell>;

    const sheet = shipment.cost_sheet;
    const isReceived = Boolean(shipment.purchase_id);
    const isClosed = shipment.status === 'CLOSED' || shipment.status === 'CANCELLED';
    const isSettled = Boolean(shipment.fx_rate_at_settle);
    const money = (value: number) => formatBDT(value, { locale });
    const costLabel = (type: string) => copy.costTypes[type as keyof typeof copy.costTypes] ?? type;

    return (
        <PageShell>
            <PageHeader
                title={
                    <span className="inline-flex items-center gap-3">
                        <Ship className="h-7 w-7 text-blue-600" />
                        <span>{shipment.reference_number}</span>
                    </span>
                }
                subtitle={
                    <span className="inline-flex items-center gap-3">
                        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-semibold text-gray-800">
                            {copy.status[shipment.status as keyof typeof copy.status] ?? shipment.status}
                        </span>
                        {shipment.supplier && <span className="text-sm text-gray-500">{shipment.supplier.name}</span>}
                    </span>
                }
                breadcrumbs={nestedPageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.imports,
                    'purchases',
                    [{ label: copy.title, href: routes.purchases.imports.root }],
                    shipment.reference_number,
                )}
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        {!isReceived && !isClosed && (
                            <>
                                {advanceable.length > 0 && (
                                    <Select
                                        value=""
                                        disabled={busy}
                                        onChange={(e) => e.target.value && advance(e.target.value)}
                                        aria-label={copy.detail.advanceStatus}
                                    >
                                        <option value="">{copy.detail.advanceStatus}</option>
                                        {advanceable.map((status) => (
                                            <option key={status} value={status}>
                                                {copy.status[status as keyof typeof copy.status]}
                                            </option>
                                        ))}
                                    </Select>
                                )}
                                <Link
                                    href={routes.purchases.imports.shipmentEdit(shipment.id)}
                                    className={compactDensity.btnSecondary}
                                >
                                    <Pencil className="h-4 w-4" />
                                    {copy.detail.edit}
                                </Link>
                                <button onClick={() => setShowCostModal(true)} className={compactDensity.btnSecondary}>
                                    <Plus className="h-4 w-4" />
                                    {copy.detail.addCost}
                                </button>
                                <button
                                    onClick={() => setShowCancelModal(true)}
                                    disabled={busy}
                                    className={compactDensity.btnSecondary}
                                >
                                    <Ban className="h-4 w-4" />
                                    {copy.detail.cancelShipment}
                                </button>
                                {shipment.costs.length === 0 && (
                                    <button
                                        onClick={() => setConfirm('delete')}
                                        disabled={busy}
                                        className={`${compactDensity.btnSecondary} text-red-600`}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                        {copy.detail.deleteShipment}
                                    </button>
                                )}
                                <button
                                    onClick={() => setConfirm('receive')}
                                    disabled={busy}
                                    className={`${compactDensity.btnPrimary} bg-primary hover:bg-primary-hover text-white disabled:opacity-50`}
                                >
                                    <PackageCheck className="h-4 w-4" />
                                    {copy.detail.receive}
                                </button>
                            </>
                        )}

                        {/* Acceptance and settlement only exist after receipt,
                            which is where the payable they move comes from. */}
                        {isReceived && !shipment.accepted_at && !isSettled && (
                            <button
                                onClick={() => setConfirm('accept')}
                                disabled={busy}
                                className={compactDensity.btnSecondary}
                            >
                                <Landmark className="h-4 w-4" />
                                {copy.detail.accept}
                            </button>
                        )}
                        {isReceived && !isSettled && (
                            <button
                                onClick={() => setShowSettleModal(true)}
                                disabled={busy}
                                className={`${compactDensity.btnPrimary} bg-primary hover:bg-primary-hover text-white disabled:opacity-50`}
                            >
                                <Landmark className="h-4 w-4" />
                                {copy.detail.settle}
                            </button>
                        )}
                    </div>
                }
            />

            {isReceived && (
                <Alert tone="success">
                    {formatMessage(copy.detail.received, { purchase: shipment.purchase_number ?? '' })}
                </Alert>
            )}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <section className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <p className="mb-3 text-xs font-semibold uppercase text-gray-500">{copy.detail.lcDetails}</p>
                    <dl className="grid grid-cols-2 gap-3">
                        <Detail label={copy.columns.lcNumber} value={shipment.lc_number} />
                        <Detail label={copy.detail.lcType} value={shipment.lc_type} />
                        <Detail label={copy.detail.bank} value={shipment.bank_name} />
                        <Detail
                            label={copy.detail.expiry}
                            value={shipment.lc_expiry_date ? formatDate(shipment.lc_expiry_date, locale) : null}
                        />
                        <Detail label={copy.columns.currency} value={shipment.currency} />
                        <Detail
                            label={copy.detail.fxRate}
                            value={shipment.fx_rate_at_open ? Number(shipment.fx_rate_at_open) : null}
                        />
                        <Detail label={copy.detail.tenor} value={shipment.tenor_days} />
                        <Detail
                            label={copy.detail.acceptedOn}
                            value={shipment.accepted_at ? formatDate(shipment.accepted_at, locale) : null}
                        />
                        <Detail
                            label={copy.detail.maturity}
                            value={
                                shipment.acceptance_due_date ? formatDate(shipment.acceptance_due_date, locale) : null
                            }
                        />
                    </dl>
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <p className="mb-3 text-xs font-semibold uppercase text-gray-500">{copy.detail.shipmentDetails}</p>
                    <dl className="grid grid-cols-2 gap-3">
                        <Detail label={copy.detail.incoterm} value={shipment.incoterm} />
                        <Detail label={copy.detail.blNumber} value={shipment.bl_number} />
                        <Detail label={copy.detail.vessel} value={shipment.vessel_name} />
                        <Detail label={copy.detail.portFrom} value={shipment.port_of_loading} />
                        <Detail label={copy.detail.portTo} value={shipment.port_of_discharge} />
                        <Detail label={copy.columns.eta} value={shipment.eta ? formatDate(shipment.eta, locale) : null} />
                    </dl>
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <p className="mb-3 text-xs font-semibold uppercase text-gray-500">{copy.detail.customsDetails}</p>
                    <dl className="grid grid-cols-2 gap-3">
                        <Detail label={copy.detail.beNumber} value={shipment.be_number} />
                        <Detail
                            label={copy.detail.beDate}
                            value={shipment.be_date ? formatDate(shipment.be_date, locale) : null}
                        />
                        <Detail label={copy.detail.cfAgent} value={shipment.cf_agent_name} />
                    </dl>
                </section>
            </div>

            {sheet && (
                <section className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <p className="mb-3 text-xs font-semibold uppercase text-gray-500">{copy.detail.costSheet}</p>

                    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <div>
                            <p className="text-xs text-gray-500">{copy.detail.goodsValue}</p>
                            <p className="text-sm font-semibold text-gray-900">{money(sheet.goods_value_bdt)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500">{copy.detail.capitalizedCharges}</p>
                            <p className="text-sm font-semibold text-gray-900">{money(sheet.capitalized_charges_bdt)}</p>
                        </div>
                        <div>
                            {/* Rebatable VAT and creditable AIT: money that comes
                                back, so it never reaches the cost of the goods. */}
                            <p className="text-xs text-gray-500">{copy.detail.recoverable}</p>
                            <p className="text-sm font-semibold text-emerald-700">{money(sheet.non_capitalized_bdt)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500">{copy.detail.totalLanded}</p>
                            <p className="text-sm font-semibold text-blue-600">{money(sheet.total_landed_bdt)}</p>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100 text-start text-xs uppercase text-gray-500">
                                    <th className="py-2">{copy.detail.items}</th>
                                    <th className="py-2 text-end">{t.common.quantity}</th>
                                    <th className="py-2 text-end">{copy.detail.goodsValue}</th>
                                    <th className="hidden py-2 text-end md:table-cell">
                                        {copy.detail.capitalizedCharges}
                                    </th>
                                    <th className="py-2 text-end">{copy.detail.projectedUnitCost}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sheet.items.map((item: any) => (
                                    <tr key={item.item_id} className="border-b border-gray-50">
                                        <td className="py-2 text-gray-900">{item.product_name}</td>
                                        <td className="py-2 text-end text-gray-700">{item.quantity}</td>
                                        <td className="py-2 text-end text-gray-700">{money(item.goods_value_bdt)}</td>
                                        <td className="hidden py-2 text-end text-gray-700 md:table-cell">
                                            {money(item.allocated_charges_bdt)}
                                        </td>
                                        <td className="py-2 text-end font-semibold text-gray-900">
                                            {money(item.landed_unit_cost ?? item.projected_unit_cost)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            <section className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                <p className="mb-3 text-xs font-semibold uppercase text-gray-500">{copy.detail.costs}</p>
                {shipment.costs.length === 0 ? (
                    <p className="text-sm text-gray-400">{copy.detail.noCosts}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100 text-start text-xs uppercase text-gray-500">
                                    <th className="py-2">{copy.cost.costType}</th>
                                    <th className="hidden py-2 md:table-cell">{t.common.description}</th>
                                    <th className="py-2 text-end">{t.common.amount}</th>
                                    <th className="hidden py-2 md:table-cell">{copy.detail.basis}</th>
                                    <th className="py-2 text-end">{copy.columns.actions}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {shipment.costs.map((cost: any) => (
                                    <tr key={cost.id} className="border-b border-gray-50">
                                        <td className="py-2 text-gray-900">
                                            {costLabel(cost.cost_type)}
                                            {!cost.is_capitalized && (
                                                <span className="ms-2 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                                    {copy.detail.recoverable}
                                                </span>
                                            )}
                                            {!cost.paid_from_account_id && (
                                                <span
                                                    className="ms-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
                                                    title={copy.detail.accruedHint}
                                                >
                                                    {copy.detail.accrued}
                                                </span>
                                            )}
                                        </td>
                                        <td className="hidden py-2 text-gray-600 md:table-cell">
                                            {cost.description ?? '—'}
                                        </td>
                                        <td className="py-2 text-end text-gray-900">
                                            {cost.currency === 'BDT'
                                                ? money(Number(cost.amount_bdt))
                                                : `${formatCurrency(Number(cost.amount), { currency: cost.currency, locale })} → ${money(Number(cost.amount_bdt))}`}
                                        </td>
                                        <td className="hidden py-2 text-gray-600 md:table-cell">
                                            {copy.bases[cost.allocation_basis as keyof typeof copy.bases] ??
                                                cost.allocation_basis}
                                        </td>
                                        <td className="py-2">
                                            <div className="flex items-center justify-end gap-1">
                                                {/* Paying works after receipt, where
                                                    deleting does not: the landed cost
                                                    is fixed, only the cash leg is not. */}
                                                {!cost.paid_from_account_id && (
                                                    <button
                                                        onClick={() => setPayingCost(cost)}
                                                        disabled={busy}
                                                        className="min-h-touch rounded-lg p-1.5 text-blue-600 hover:bg-blue-50"
                                                        title={copy.detail.payCost}
                                                    >
                                                        <Wallet className="h-4 w-4" />
                                                    </button>
                                                )}
                                                {!isReceived && !cost.voucher_id && (
                                                    <button
                                                        onClick={() => setConfirm({ cost: cost.id })}
                                                        disabled={busy}
                                                        className="min-h-touch rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                                                        title={t.common.delete}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase text-gray-500">{copy.detail.documents}</p>
                    <button onClick={() => setShowDocumentModal(true)} className={compactDensity.btnSecondary}>
                        <Paperclip className="h-4 w-4" />
                        {copy.detail.addDocument}
                    </button>
                </div>
                {(shipment.documents ?? []).length === 0 ? (
                    <p className="text-sm text-gray-400">{copy.detail.noDocuments}</p>
                ) : (
                    <ul className="divide-y divide-gray-50">
                        {shipment.documents.map((document: any) => (
                            <li key={document.id} className="flex items-center gap-3 py-2">
                                <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                                <div className="min-w-0 flex-1">
                                    {document.file_url ? (
                                        <a
                                            href={document.file_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="block truncate text-sm text-blue-600 hover:underline"
                                        >
                                            {document.file_name}
                                        </a>
                                    ) : (
                                        <span className="block truncate text-sm text-gray-900">
                                            {document.file_name}
                                        </span>
                                    )}
                                    <span className="text-xs text-gray-500">
                                        {copy.docTypes[document.doc_type as keyof typeof copy.docTypes] ??
                                            document.doc_type}
                                    </span>
                                </div>
                                <button
                                    onClick={() => removeDocument(document.id)}
                                    disabled={busy}
                                    className="min-h-touch rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                                    title={t.common.delete}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {showCostModal && (
                <AddImportCostModal
                    shipmentId={id as string}
                    onClose={() => setShowCostModal(false)}
                    onSaved={() => {
                        setShowCostModal(false);
                        load();
                    }}
                />
            )}

            {showSettleModal && (
                <SettleLcModal
                    shipment={shipment}
                    onClose={() => setShowSettleModal(false)}
                    onSettled={() => {
                        setShowSettleModal(false);
                        load();
                    }}
                />
            )}

            {payingCost && (
                <PayCostModal
                    shipmentId={id as string}
                    cost={payingCost}
                    onClose={() => setPayingCost(null)}
                    onPaid={() => {
                        setPayingCost(null);
                        load();
                    }}
                />
            )}

            {showCancelModal && (
                <CancelShipmentModal
                    shipment={shipment}
                    onClose={() => setShowCancelModal(false)}
                    onCancelled={() => {
                        setShowCancelModal(false);
                        load();
                    }}
                />
            )}

            {showDocumentModal && (
                <AddDocumentModal
                    shipmentId={id as string}
                    onClose={() => setShowDocumentModal(false)}
                    onUploaded={() => {
                        setShowDocumentModal(false);
                        load();
                    }}
                />
            )}

            {/* Receiving writes a purchase, moves stock and posts a voucher —
                the most irreversible thing in the module, and it was behind a
                browser `confirm()` in untranslated English. */}
            <ConfirmDialog
                open={confirm === 'receive'}
                title={copy.detail.receiveTitle}
                prompt={copy.detail.receivePrompt}
                confirmLabel={copy.detail.receive}
                cancelLabel={t.common.cancel}
                loading={busy}
                onConfirm={receive}
                onCancel={() => setConfirm(null)}
            />

            <ConfirmDialog
                open={confirm === 'accept'}
                title={copy.accept.title}
                prompt={copy.accept.explainer}
                confirmLabel={copy.detail.accept}
                cancelLabel={t.common.cancel}
                loading={busy}
                onConfirm={accept}
                onCancel={() => setConfirm(null)}
            />

            <ConfirmDialog
                open={confirm === 'delete'}
                title={copy.detail.deleteTitle}
                prompt={copy.detail.deletePrompt}
                confirmLabel={copy.detail.deleteShipment}
                cancelLabel={t.common.cancel}
                loading={busy}
                danger
                onConfirm={remove}
                onCancel={() => setConfirm(null)}
            />

            <ConfirmDialog
                open={typeof confirm === 'object' && confirm !== null}
                title={t.common.delete}
                prompt={copy.cost.costType}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                loading={busy}
                danger
                onConfirm={() => typeof confirm === 'object' && confirm && removeCost(confirm.cost)}
                onCancel={() => setConfirm(null)}
            />
        </PageShell>
    );
}
