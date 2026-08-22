'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Ship, Plus, PackageCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT, formatCurrency, formatDate } from '@/lib/format';
import { routes } from '@/lib/routes';
import { useI18n, formatMessage } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Alert, Select } from '@/components/ui';
import { compactDensity } from '@/lib/ui/compact-density';
import AddImportCostModal from './AddImportCostModal';

/** Mirrors SHIPMENT_FLOW in the backend, minus the states set only by actions. */
const ADVANCEABLE = ['LC_APPLIED', 'LC_ISSUED', 'SHIPPED', 'DOCS_RECEIVED', 'CUSTOMS'];

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
    if (value === null || value === undefined || value === '') return null;
    return (
        <div>
            <dt className="text-xs text-gray-500">{label}</dt>
            <dd className="text-sm text-gray-900">{value}</dd>
        </div>
    );
}

export default function ImportShipmentDetailPage() {
    const { t, locale } = useI18n();
    const copy = t.imports;
    const { id } = useParams();

    const [shipment, setShipment] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [showCostModal, setShowCostModal] = useState(false);

    const load = useCallback(() => {
        api.getImportShipment(id as string)
            .then(setShipment)
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [id]);

    useEffect(load, [load]);

    const advance = async (status: string) => {
        setBusy(true);
        try {
            await api.updateImportShipmentStatus(id as string, status);
            load();
        } catch (error: any) {
            toast.error(error.message || 'Could not change the status');
        } finally {
            setBusy(false);
        }
    };

    const receive = async () => {
        if (!window.confirm('Receive this shipment into stock at its landed cost?')) return;
        setBusy(true);
        try {
            const result = await api.receiveImportShipment(id as string);
            toast.success(`Received as ${result.purchase_number}`);
            load();
        } catch (error: any) {
            toast.error(error.message || 'Could not receive the shipment');
        } finally {
            setBusy(false);
        }
    };

    if (loading) return <PageShell><p className="text-sm text-gray-500">{t.common.loading}</p></PageShell>;
    if (!shipment) return <PageShell><p className="text-sm text-gray-500">{t.common.noData}</p></PageShell>;

    const sheet = shipment.cost_sheet;
    const isReceived = Boolean(shipment.purchase_id);
    const money = (value: number) => formatBDT(value, { locale });

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
                    t.sidebar.modules.purchase,
                    'purchases',
                    [{ label: copy.title, href: routes.purchases.imports.root }],
                    shipment.reference_number,
                )}
                actions={
                    !isReceived && (
                        <div className="flex flex-wrap items-center gap-2">
                            <Select
                                value=""
                                disabled={busy}
                                onChange={(e) => e.target.value && advance(e.target.value)}
                                aria-label={copy.detail.advanceStatus}
                            >
                                <option value="">{copy.detail.advanceStatus}</option>
                                {ADVANCEABLE.map((status) => (
                                    <option key={status} value={status}>
                                        {copy.status[status as keyof typeof copy.status]}
                                    </option>
                                ))}
                            </Select>
                            <button onClick={() => setShowCostModal(true)} className={compactDensity.btnSecondary}>
                                <Plus className="h-4 w-4" />
                                {copy.detail.addCost}
                            </button>
                            <button
                                onClick={receive}
                                disabled={busy}
                                className={`${compactDensity.btnPrimary} bg-primary hover:bg-primary-hover text-white disabled:opacity-50`}
                            >
                                <PackageCheck className="h-4 w-4" />
                                {copy.detail.receive}
                            </button>
                        </div>
                    )
                }
            />

            {isReceived && (
                <Alert tone="success">
                    {formatMessage(copy.detail.receivedNotice, { purchase: shipment.purchase_id })}
                </Alert>
            )}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <section className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <p className="mb-3 text-xs font-semibold uppercase text-gray-500">{copy.detail.lcDetails}</p>
                    <dl className="grid grid-cols-2 gap-3">
                        <Detail label={copy.columns.lcNumber} value={shipment.lc_number} />
                        <Detail label="Type" value={shipment.lc_type} />
                        <Detail label="Bank" value={shipment.bank_name} />
                        <Detail
                            label="Expiry"
                            value={shipment.lc_expiry_date ? formatDate(shipment.lc_expiry_date, locale) : null}
                        />
                        <Detail label={copy.columns.currency} value={shipment.currency} />
                        <Detail
                            label={`BDT / ${shipment.currency}`}
                            value={shipment.fx_rate_at_open ? Number(shipment.fx_rate_at_open) : null}
                        />
                    </dl>
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <p className="mb-3 text-xs font-semibold uppercase text-gray-500">{copy.detail.shipmentDetails}</p>
                    <dl className="grid grid-cols-2 gap-3">
                        <Detail label="Incoterm" value={shipment.incoterm} />
                        <Detail label="BL #" value={shipment.bl_number} />
                        <Detail label="Vessel" value={shipment.vessel_name} />
                        <Detail label="From" value={shipment.port_of_loading} />
                        <Detail label="To" value={shipment.port_of_discharge} />
                        <Detail label={copy.columns.eta} value={shipment.eta ? formatDate(shipment.eta, locale) : null} />
                    </dl>
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                    <p className="mb-3 text-xs font-semibold uppercase text-gray-500">{copy.detail.customsDetails}</p>
                    <dl className="grid grid-cols-2 gap-3">
                        <Detail label="BE #" value={shipment.be_number} />
                        <Detail
                            label="BE date"
                            value={shipment.be_date ? formatDate(shipment.be_date, locale) : null}
                        />
                        <Detail label="C&F agent" value={shipment.cf_agent_name} />
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
                    <p className="text-sm text-gray-400">—</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100 text-start text-xs uppercase text-gray-500">
                                    <th className="py-2">Type</th>
                                    <th className="hidden py-2 md:table-cell">{t.common.description}</th>
                                    <th className="py-2 text-end">{t.common.amount}</th>
                                    <th className="py-2">Basis</th>
                                </tr>
                            </thead>
                            <tbody>
                                {shipment.costs.map((cost: any) => (
                                    <tr key={cost.id} className="border-b border-gray-50">
                                        <td className="py-2 text-gray-900">
                                            {cost.cost_type}
                                            {!cost.is_capitalized && (
                                                <span className="ms-2 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                                    {copy.detail.recoverable}
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
                                        <td className="py-2 text-gray-600">{cost.allocation_basis}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
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
        </PageShell>
    );
}
