'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import { TabPanel, Tabs } from '@/components/ui/compact/Tabs';
import CrmActivityPanel from './CrmActivityPanel';
import LeadWorkspace from './LeadWorkspace';
import { formatMessage, useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';

/**
 * Previous / Next through the list the drawer was opened from. A handler is
 * `null` when there is nothing that way, which disables the button rather than
 * hiding it — the pair would otherwise jump about as you reach either end.
 */
export type CrmActivityDrawerNavigation = {
    /** 1-based place of the open row in the whole list, or null once it has left it. */
    position: number | null;
    total: number;
    onPrevious: (() => void) | null;
    onNext: (() => void) | null;
};

type Props = {
    /** Exactly one of the two, matching the CrmActivityPanel contract. */
    leadId?: string;
    customerId?: string;
    /** The lead or customer the timeline belongs to — the drawer's title. */
    name: string;
    phone?: string | null;
    /** That record's page, for when the timeline is not the whole answer. */
    href?: string | null;
    /** The list row the drawer is on: picked out in the timeline, named under the title. */
    activityId?: string | null;
    activityLabel?: string | null;
    navigation?: CrmActivityDrawerNavigation | null;
    /**
     * The tab the drawer opens on, and the one listed first. The activities
     * list opens on the timeline — its rows are activities; the leads list
     * opens on the lead's details, with the timeline one tab over.
     */
    primaryTab?: CrmActivityDrawerTab;
    /** Under the title. Defaults to the open activity's label, else "Activities". */
    subtitle?: string | null;
    /** What Previous / Next step through. Defaults to "Previous / Next activity". */
    navigationLabels?: { previous: string; next: string };
    onClose: () => void;
    /** Forwarded to the panel: a write in here moves a row in the list behind. */
    onChanged?: () => void;
};

export type CrmActivityDrawerTab = 'activities' | 'details';
type DrawerTab = CrmActivityDrawerTab;

const TAB_PREFIX = 'crm-activity-drawer';

const navButton =
    'inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent max-md:min-h-touch max-md:w-11';

/**
 * One lead's — or customer's — whole activity timeline, slid in beside the
 * tenant-wide activities list rather than replacing it.
 *
 * The list's rows are single activities, and the question a row raises is
 * almost always about the record it belongs to: what else is planned for this
 * lead, what was said last time, is this the third chase or the first. Opening
 * the lead page answered that and lost the list — the filters, the scroll
 * position, and the next fifteen rows to work through. This keeps them, and
 * because it is `CrmActivityPanel` rather than a read-only copy of it, the
 * complete / edit / cancel actions are the same ones the lead page offers.
 *
 * Working through the list is the other half: Previous / Next move the drawer
 * to the neighbouring row without closing it, and a lead's Details tab answers
 * "who is this" without the trip to the lead page either. The tab survives the
 * step, so reading details down a list stays on details.
 *
 * The leads list uses the same drawer the other way round (`primaryTab:
 * 'details'`): its rows are leads, so the lead's details come first and the
 * timeline sits in the second tab, with Previous / Next stepping lead to lead.
 */
export default function CrmActivityDrawer({
    leadId,
    customerId,
    name,
    phone,
    href,
    activityId,
    activityLabel,
    navigation,
    primaryTab = 'activities',
    subtitle,
    navigationLabels,
    onClose,
    onChanged,
}: Readonly<Props>) {
    const { t } = useI18n();
    const m = t.crm.activitiesPage;
    const leadsCopy = t.crm.leads;
    const router = useRouter();

    const [tab, setTab] = useState<DrawerTab>(primaryTab);
    const previousLabel = navigationLabels?.previous ?? m.previousActivity;
    const nextLabel = navigationLabels?.next ?? m.nextActivity;
    // A customer has no lead details to show; its record page is the link above.
    const activeTab: DrawerTab = leadId ? tab : 'activities';

    const viewCustomer = (customerId: string) => ({
        label: leadsCopy.viewCustomer,
        onClick: () => router.push(routes.sales.customerDetail(customerId)),
    });

    const timeline = (
        <CrmActivityPanel
            leadId={leadId}
            customerId={customerId}
            targetLabel={{ name, phone }}
            highlightId={activityId}
            onChanged={onChanged}
        />
    );

    return (
        <ModalShell variant="drawer" size="lg" onBackdropClick={onClose}>
            <ModalHeader
                title={name}
                subtitle={subtitle || activityLabel || t.crm.activities.title}
                onClose={onClose}
                closeLabel={t.common.close}
            >
                {href && (
                    <Link
                        href={href}
                        className="inline-flex min-h-touch items-center gap-1 rounded-md px-2 text-sm font-semibold text-blue-600 hover:bg-gray-100"
                    >
                        {m.openRecord}
                        <ArrowUpRight className="h-4 w-4" />
                    </Link>
                )}
            </ModalHeader>

            {(leadId || navigation) && (
                <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4">
                    <div className="min-w-0 flex-1">
                        {leadId && (
                            <Tabs<DrawerTab>
                                tabs={primaryTab === 'details'
                                    ? [
                                        { key: 'details', label: m.tabDetails },
                                        { key: 'activities', label: m.tabActivities },
                                    ]
                                    : [
                                        { key: 'activities', label: m.tabActivities },
                                        { key: 'details', label: m.tabDetails },
                                    ]}
                                value={activeTab}
                                // Re-clicking the open tab would close the strip; a
                                // drawer always shows one of the two.
                                onChange={(next) => { if (next) setTab(next); }}
                                idPrefix={TAB_PREFIX}
                                label={m.panelSections}
                                bordered={false}
                            />
                        )}
                    </div>
                    {navigation && (
                        <div className="flex shrink-0 items-center gap-1 py-1">
                            <button
                                type="button"
                                className={navButton}
                                onClick={navigation.onPrevious ?? undefined}
                                disabled={!navigation.onPrevious}
                                aria-label={previousLabel}
                                title={previousLabel}
                            >
                                <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
                            </button>
                            {navigation.position != null && (
                                <span className="whitespace-nowrap text-xs tabular-nums text-gray-500" aria-live="polite">
                                    {formatMessage(m.position, { current: navigation.position, total: navigation.total })}
                                </span>
                            )}
                            <button
                                type="button"
                                className={navButton}
                                onClick={navigation.onNext ?? undefined}
                                disabled={!navigation.onNext}
                                aria-label={nextLabel}
                                title={nextLabel}
                            >
                                <ChevronRight className="h-4 w-4 rtl:rotate-180" />
                            </button>
                        </div>
                    )}
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-4">
                {leadId ? (
                    <>
                        <TabPanel tabKey="activities" value={activeTab} idPrefix={TAB_PREFIX}>
                            {timeline}
                        </TabPanel>
                        <TabPanel tabKey="details" value={activeTab} idPrefix={TAB_PREFIX}>
                            {/* Keyed by lead, so stepping to another lead's row starts
                                its details fresh instead of flashing the last one's. */}
                            <LeadWorkspace
                                key={leadId}
                                leadId={leadId}
                                variant="details"
                                onChanged={onChanged}
                                onConvertResult={({ customerId: convertedTo, existing }) => {
                                    if (existing) {
                                        // Nothing changed; the drawer stays on the lead.
                                        toast.error(leadsCopy.customerExists, { action: viewCustomer(convertedTo) });
                                        return;
                                    }
                                    toast.success(leadsCopy.converted, { action: viewCustomer(convertedTo) });
                                    onChanged?.();
                                    onClose();
                                }}
                                onDeleted={() => {
                                    toast.success(m.leadDeleted);
                                    onChanged?.();
                                    onClose();
                                }}
                            />
                        </TabPanel>
                    </>
                ) : (
                    timeline
                )}
            </div>
        </ModalShell>
    );
}
