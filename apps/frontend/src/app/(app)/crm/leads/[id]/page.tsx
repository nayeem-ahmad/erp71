'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
    Phone, Mail, MessageSquare, UserCheck, Sparkles, Pencil, ExternalLink, Calendar, Trash2, User, MapPin, } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { PageShell, PageHeader, Button, Select, StatusBadge, type StatusBadgeTone } from '@/components/ui';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { compactDensity } from '@/lib/ui/compact-density';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import CrmActivityPanel from '@/components/crm/CrmActivityPanel';
import {
    LeadFormFields,
    leadFormToPayload,
    leadToFormState,
    validateLeadFormErrors,
    type LeadFormErrors,
    type LeadFormState,
} from '../lead-form-fields';
import { channelLabel, useLeadTaxonomy } from '@/lib/use-lead-taxonomy';

const leadStatusTone: Record<string, StatusBadgeTone> = {
    NEW: 'info',
    CONTACTED: 'neutral',
    QUALIFIED: 'neutral',
    LOST: 'danger',
    CONVERTED: 'success',
};

const priorityColors: Record<string, string> = {
    LOW: 'bg-gray-50 text-gray-600',
    MEDIUM: 'bg-blue-50 text-blue-700',
    HIGH: 'bg-amber-50 text-amber-700',
    URGENT: 'bg-danger-light text-danger-text',
};

function scoreBadgeColor(score: number): string {
    if (score >= 70) return 'bg-emerald-50 text-emerald-700';
    if (score >= 40) return 'bg-amber-50 text-amber-700';
    return 'bg-gray-100 text-gray-600';
}

/**
 * One line of the contact card. The column is a third of the page, so the label
 * sits above its value rather than beside it — a side-by-side pair wraps into an
 * unreadable ladder at this width.
 */
function DetailRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
    return (
        <div className="flex items-start gap-2">
            <span className="mt-0.5 text-gray-400 shrink-0">{icon}</span>
            <div className="min-w-0">
                <dt className="text-xs text-gray-500">{label}</dt>
                <dd className="text-sm text-gray-900 break-words">{children}</dd>
            </div>
        </div>
    );
}

export default function LeadDetailPage() {
    const { id } = useParams();
    const leadId = id as string;
    const router = useRouter();
    const { t } = useI18n();
    const m = t.crm.leads;

    const [lead, setLead] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [showDraftPanel, setShowDraftPanel] = useState(false);
    const [showEditForm, setShowEditForm] = useState(false);
    // Handed to CrmActivityPanel, which opens its "Log activity" dialog pre-filled.
    // Cleared as soon as it is taken, so re-rendering does not reopen the dialog.
    const [activityDraft, setActivityDraft] =
        useState<{ channelCode?: string; summary: string } | null>(null);
    const [converting, setConverting] = useState(false);
    const [draftingMessage, setDraftingMessage] = useState(false);
    const [draftPurpose, setDraftPurpose] = useState('follow_up');
    const [draftChannel, setDraftChannel] = useState('');
    const [editForm, setEditForm] = useState<LeadFormState | null>(null);
    const [editFormErrors, setEditFormErrors] = useState<LeadFormErrors>({});
    const [savingLead, setSavingLead] = useState(false);
    const [saveLeadError, setSaveLeadError] = useState<string | null>(null);
    const [teamMembers, setTeamMembers] = useState<any[]>([]);
    const [customFieldDefs, setCustomFieldDefs] = useState<{ key: string; label: string }[]>([]);
    const { options: sourceOptions } = useLeadTaxonomy('sources');
    const { options: categoryOptions } = useLeadTaxonomy('categories');
    const { options: channels } = useLeadTaxonomy('channels');
    // The tenant's first channel, in their own sort order. Both selects below start
    // here rather than on a hardcoded 'CALL' that a tenant may have retired.
    const defaultChannel = channels[0]?.code ?? '';

    // Runs once the channel list lands, and only while the picker is untouched —
    // the drafter mounts before the request resolves, so without this its select
    // sits on a blank option.
    useEffect(() => {
        if (!defaultChannel) return;
        setDraftChannel((prev) => prev || defaultChannel);
    }, [defaultChannel]);

    useEffect(() => {
        api.getTeamMembers().then((data) => setTeamMembers(Array.isArray(data) ? data : [])).catch(() => null);
    }, []);

    useEffect(() => {
        api.getCustomFields('LEAD')
            .then((d: any[]) => setCustomFieldDefs(Array.isArray(d) ? d : []))
            .catch(() => setCustomFieldDefs([]));
    }, []);

    const loadLead = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getLead(leadId);
            setLead(data);
        } catch {
            setLead(null);
        } finally {
            setLoading(false);
        }
    }, [leadId]);


    useEffect(() => { if (leadId) void loadLead(); }, [leadId, loadLead]);

    const convertLead = async () => {
        if (!confirm(m.convertConfirm)) return;
        setConverting(true);
        try {
            const result = await api.convertLead(leadId);
            router.push(routes.sales.customerDetail(result.customer.id));
        } catch (err: any) {
            const customerId = err?.customerId ?? err?.response?.customerId;
            if (customerId) {
                alert(m.customerExists);
                router.push(routes.sales.customerDetail(customerId));
            } else {
                alert(err instanceof Error ? err.message : m.convertFailed);
            }
        } finally {
            setConverting(false);
        }
    };

    const clearActivityDraft = useCallback(() => setActivityDraft(null), []);

    const draftMessage = async () => {
        if (!lead) return;
        setDraftingMessage(true);
        try {
            const draft = await api.aiDraftMessage({
                // The channel's label, not its code: this goes straight into the prompt
                // ("write a short, professional {channel} message"), where "WhatsApp"
                // reads as intended and "ONLINE_MEETING" does not.
                channel: channelLabel(channels, draftChannel),
                purpose: draftPurpose,
                customerContext: { name: lead.name, phone: lead.mobile ?? lead.phone, type: 'lead' },
            });
            setActivityDraft({
                channelCode: draftChannel || defaultChannel,
                summary: draft?.message ?? draft?.text ?? draft?.draft ?? '',
            });
            setShowDraftPanel(false);
        } finally {
            setDraftingMessage(false);
        }
    };

    const startEditing = () => {
        setEditForm(leadToFormState(lead));
        setEditFormErrors({});
        setSaveLeadError(null);
        setShowEditForm(true);
    };

    const closeEditing = () => {
        setShowEditForm(false);
        setEditForm(null);
    };

    const saveLead = async () => {
        if (!editForm) return;
        const validationErrors = validateLeadFormErrors(editForm, m.validation ?? {});
        setEditFormErrors(validationErrors);
        if (Object.keys(validationErrors).length > 0) return;
        setSaveLeadError(null);
        setSavingLead(true);
        try {
            const updated = await api.updateLead(leadId, leadFormToPayload(editForm, { mode: 'update' }));
            setLead(updated);
            setShowEditForm(false);
            setEditForm(null);
        } catch (err: unknown) {
            setSaveLeadError(err instanceof Error ? err.message : m.detail.saveFailed);
        } finally {
            setSavingLead(false);
        }
    };

    const removeLead = async () => {
        if (!confirm(m.deleteConfirm)) return;
        try {
            await api.deleteLead(leadId);
            router.push(routes.crm.leads);
        } catch (err: unknown) {
            alert(err instanceof Error ? err.message : m.deleteFailed);
        }
    };

    if (loading) {
        return <div className="p-8 text-sm font-semibold uppercase text-gray-400">{m.workspace.loading}</div>;
    }
    if (!lead) {
        return <div className="p-8 text-sm font-semibold uppercase text-danger">{m.workspace.notFound}</div>;
    }

    const isConverted = lead.status === 'CONVERTED';
    const statusLabel = (m.statuses as Record<string, string>)[lead.status] ?? lead.status;
    // Names come from the tenant's own taxonomy rows and are shown verbatim.
    // The legacy enum value is the fallback for a lead not yet backfilled.
    const sourceLabel = lead.sourceOption?.name ?? lead.source;
    const categoryLabel = lead.categoryOption?.name ?? lead.category ?? null;
    const priorityLabel = (m.priorities as Record<string, string>)[lead.priority] ?? lead.priority;

    const socialLinks = [
        { label: m.fields.linkedinUrl, url: lead.linkedin_url },
        { label: m.fields.fbUrl, url: lead.fb_url },
        { label: m.fields.xUrl, url: lead.x_url },
        { label: m.fields.websiteUrl, url: lead.website_url },
    ].filter((l) => l.url);

    const filledCustomFields = customFieldDefs.filter(
        (def) => (lead.custom_fields as Record<string, string> | null)?.[def.key],
    );

    return (
        <PageShell>
            <PageHeader
                title={lead.name}
                breadcrumbs={nestedPageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.crm,
                    'crm',
                    [{ label: m.title, href: routes.crm.leads }],
                    lead.name,
                )}
            />

            {/* Identity bar. Stays full width above the split: the name, how the lead
                is classified, and the record-level actions are about the whole page,
                not about either column under it. */}
            <div className="rounded-lg border border-gray-100 bg-white p-4">
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                    <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center text-white font-semibold text-sm uppercase shrink-0">
                        {lead.name.substring(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-base font-semibold text-gray-900">{lead.name}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                            <StatusBadge tone={leadStatusTone[lead.status] ?? 'neutral'}>{statusLabel}</StatusBadge>
                            <StatusBadge tone="neutral">{sourceLabel}</StatusBadge>
                            {categoryLabel && (
                                <StatusBadge tone="info">{categoryLabel}</StatusBadge>
                            )}
                            {lead.priority && (
                                <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${priorityColors[lead.priority] ?? 'bg-gray-100 text-gray-700'}`}>
                                    {priorityLabel}
                                </span>
                            )}
                            {typeof lead.score === 'number' && (
                                <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${scoreBadgeColor(lead.score)}`}>
                                    {m.fields.score}: {lead.score}
                                </span>
                            )}
                        </div>
                        {lead.status === 'LOST' && lead.lost_reason && (
                            <p className="text-xs text-danger mt-2 font-medium">{m.fields.lostReason}: {lead.lost_reason}</p>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                        {!isConverted && (
                            <Button variant="secondary" onClick={startEditing} icon={<Pencil className="w-4 h-4" />}>
                                {m.fields.editLead}
                            </Button>
                        )}
                        <Button variant="danger" onClick={removeLead} icon={<Trash2 className="w-4 h-4" />}>
                            {t.common.delete}
                        </Button>
                        {isConverted && lead.convertedCustomer ? (
                            <Link href={routes.sales.customerDetail(lead.convertedCustomer.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-md text-xs font-semibold">
                                <UserCheck className="w-4 h-4" /> {m.viewCustomer}
                            </Link>
                        ) : (
                            <Button onClick={convertLead} loading={converting} icon={<UserCheck className="w-4 h-4" />}>
                                {m.convert}
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {/* Who the lead is on the left, what has happened with them on the right.
                A third / two thirds, not half and half: the left column is short
                label-and-value pairs, while the right one carries activity prose and
                the log and plan forms. `items-start` is what lets the left column
                stick — a stretched grid item has no room to move. */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
                <div className="space-y-4 lg:sticky lg:top-4">
                    <div className="rounded-lg border border-gray-100 bg-white p-4">
                        <p className="text-xs font-semibold uppercase text-gray-500 mb-3">{m.detail.contactSection}</p>
                        <dl className="space-y-3">
                            <DetailRow icon={<Phone className="w-3.5 h-3.5" />} label={m.fields.mobile}>
                                {lead.mobile ?? lead.phone}
                            </DetailRow>
                            {lead.email && (
                                <DetailRow icon={<Mail className="w-3.5 h-3.5" />} label={m.fields.email}>
                                    {lead.email}
                                </DetailRow>
                            )}
                            {lead.address && (
                                <DetailRow icon={<MapPin className="w-3.5 h-3.5" />} label={m.fields.address}>
                                    {lead.address}
                                </DetailRow>
                            )}
                            {/* The owner belongs in the record itself, the way every CRM
                                surfaces it — not only inside the edit form, where you would
                                have to open the editor to learn who the lead belongs to. */}
                            <DetailRow icon={<User className="w-3.5 h-3.5" />} label={m.fields.owner}>
                                {lead.assignee?.name ?? m.fields.unassigned}
                            </DetailRow>
                            {(lead.remarks ?? lead.notes) && (
                                <DetailRow icon={<MessageSquare className="w-3.5 h-3.5" />} label={m.fields.remarks}>
                                    {lead.remarks ?? lead.notes}
                                </DetailRow>
                            )}
                        </dl>
                        {socialLinks.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-100">
                                <p className="text-xs text-gray-500 mb-2">{m.fields.socialLinks}</p>
                                <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                                    {socialLinks.map((link) => (
                                        <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-semibold">
                                            <ExternalLink className="w-3 h-3" /> {link.label}
                                        </a>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {(lead.next_step || lead.next_step_date || lead.nextStepAssignee) && (
                        <div className="rounded-lg border border-primary-border bg-primary-light p-4">
                            <p className="text-xs font-semibold text-blue-700 mb-2">{m.fields.nextStepSection}</p>
                            {lead.next_step && <p className="text-sm font-medium text-gray-800">{lead.next_step}</p>}
                            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-600 font-semibold">
                                {lead.next_step_date && (
                                    <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {formatDate(lead.next_step_date)}</span>
                                )}
                                {lead.nextStepAssignee && <span>{m.fields.nextStepAssignedTo}: {lead.nextStepAssignee.name}</span>}
                            </div>
                        </div>
                    )}

                    {filledCustomFields.length > 0 && (
                        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
                            <p className="text-xs font-semibold uppercase text-gray-500 mb-3">{m.fields.customFields}</p>
                            <dl className="space-y-2">
                                {filledCustomFields.map((def) => (
                                    <div key={def.key} className="flex justify-between gap-3 text-sm">
                                        <dt className="text-gray-500">{def.label}</dt>
                                        <dd className="text-gray-900 font-medium text-end">{(lead.custom_fields as Record<string, string>)[def.key]}</dd>
                                    </div>
                                ))}
                            </dl>
                        </div>
                    )}
                </div>

                {/* One panel where there used to be two: a conversations list and a
                    follow-ups list, over two tables that could not refer to each other.
                    Planning a call and recording it are one loop now. */}
                <div className="lg:col-span-2 bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-2">
                            <MessageSquare className="w-5 h-5 text-primary" />
                            <h2 className="text-sm font-semibold text-gray-900">{t.crm.activities.title}</h2>
                        </div>
                        {!isConverted && (
                            <Button
                                variant="secondary"
                                onClick={() => setShowDraftPanel((v) => !v)}
                                leftIcon={<Sparkles className="w-4 h-4" />}
                            >
                                {m.detail.aiDraft}
                            </Button>
                        )}
                    </div>

                    <div className="p-4 space-y-4">
                        {showDraftPanel && !isConverted && (
                            <div className="bg-primary-light rounded-lg p-4 space-y-3 border border-primary-border">
                                <p className="text-xs font-semibold text-blue-700">{m.detail.aiDrafter}</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <Select value={draftChannel} onChange={(e) => setDraftChannel(e.target.value)}>
                                        {channels.map((c) => <option key={c.id} value={c.code}>{c.name}</option>)}
                                    </Select>
                                    <Select value={draftPurpose} onChange={(e) => setDraftPurpose(e.target.value)}>
                                        <option value="follow_up">{m.detail.draftPurposeFollowUp}</option>
                                        <option value="collection">{m.detail.draftPurposeCollection}</option>
                                    </Select>
                                </div>
                                <div className="flex gap-2">
                                    <Button onClick={draftMessage} loading={draftingMessage} leftIcon={<Sparkles className="w-4 h-4" />}>
                                        {m.detail.generateDraft}
                                    </Button>
                                    <Button variant="secondary" onClick={() => setShowDraftPanel(false)}>
                                        {t.common.cancel}
                                    </Button>
                                </div>
                            </div>
                        )}

                        <CrmActivityPanel
                            leadId={leadId}
                            draft={activityDraft}
                            onDraftConsumed={clearActivityDraft}
                        />
                    </div>
                </div>
            </div>

            {/* A dialog rather than a card in the flow: the two-column form does not
                fit either column, and inline it used to shove the activity history
                down the page while you edited. */}
            {showEditForm && editForm && !isConverted && (
                <ModalShell size="lg" onBackdropClick={closeEditing}>
                    <ModalHeader title={m.fields.editLead} onClose={closeEditing} closeLabel={t.common.close} />
                    <div className={`${compactDensity.modalPadding} space-y-4 overflow-y-auto`}>
                        <LeadFormFields
                            form={editForm}
                            onChange={setEditForm}
                            teamMembers={teamMembers}
                            customFieldDefs={customFieldDefs}
                            errors={editFormErrors}
                            sourceOptions={sourceOptions}
                            categoryOptions={categoryOptions}
                            showNextStep={false}
                        />
                        {saveLeadError && <p role="alert" className="text-xs text-danger">{saveLeadError}</p>}
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={closeEditing}>
                            {t.common.cancel}
                        </Button>
                        <Button onClick={saveLead} loading={savingLead}>
                            {m.detail.saveLead}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}

        </PageShell>
    );
}
