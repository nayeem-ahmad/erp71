'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    DndContext,
    DragOverlay,
    KeyboardSensor,
    MouseSensor,
    TouchSensor,
    pointerWithin,
    rectIntersection,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors,
    type CollisionDetection,
    type DragEndEvent,
    type DragStartEvent,
} from '@dnd-kit/core';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import { leadStatusTone } from '@/lib/lead-status';
import { Alert, Button, ConfirmDialog, Textarea } from '@/components/ui';
import { LeadCard } from './LeadCard';
import {
    canDragLead,
    dropAction,
    type BoardColumn,
    type BoardLead,
    type LeadBoardGroup,
} from './board-columns';
import { useBoardData, type ColumnState, type LeadsQuery } from './use-board-data';

/** The pointer decides where a card lands; the keyboard has no pointer, so it falls back to overlap. */
const collision: CollisionDetection = (args) => {
    const hits = pointerWithin(args);
    return hits.length > 0 ? hits : rectIntersection(args);
};

const LIFECYCLE_DOT: Record<string, string> = {
    info: 'bg-blue-600',
    success: 'bg-emerald-500',
    danger: 'bg-red-500',
    neutral: 'bg-gray-400',
};

type CardLabels = { statuses: Record<string, string>; priorities: Record<string, string>; score: string };

type Pending =
    | { kind: 'lost'; lead: BoardLead; from: string; to: string; body: Record<string, string | null> }
    | { kind: 'convert'; lead: BoardLead; from: string; to: string };

function errorText(err: unknown): string {
    return err instanceof Error ? err.message : '';
}

function DraggableCard({
    lead,
    columnKey,
    group,
    labels,
}: Readonly<{ lead: BoardLead; columnKey: string; group: LeadBoardGroup; labels: CardLabels }>) {
    const disabled = !canDragLead(lead);
    const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
        id: lead.id,
        data: { lead, from: columnKey },
        disabled,
    });
    return (
        <LeadCard
            ref={setNodeRef}
            lead={lead}
            group={group}
            labels={labels}
            dragging={isDragging}
            className={disabled ? '' : 'md:cursor-grab'}
            {...attributes}
            {...listeners}
        />
    );
}

function Column({
    column,
    state,
    group,
    labels,
    draggingFrom,
    onRetry,
    onLoadMore,
}: Readonly<{
    column: BoardColumn;
    state: ColumnState | undefined;
    group: LeadBoardGroup;
    labels: CardLabels;
    draggingFrom: string | null;
    onRetry: (key: string) => void;
    onLoadMore: (key: string) => void;
}>) {
    const { t } = useI18n();
    const b = t.crm.leads.board;
    const accepts = Boolean(column.patch);
    const { setNodeRef, isOver } = useDroppable({ id: column.key, disabled: !accepts });
    const highlighted = isOver && accepts && draggingFrom !== null && draggingFrom !== column.key;
    const items = state?.items ?? [];
    const total = state?.total ?? 0;
    const firstLoad = !state || (state.loading && state.page === 0);

    return (
        <section
            ref={setNodeRef}
            aria-label={column.label}
            data-testid="board-column"
            className={`flex w-72 shrink-0 flex-col rounded-md border transition-colors ${
                highlighted ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-gray-50'
            }`}
        >
            <header className="flex items-center gap-2 px-3 py-2">
                {column.lifecycle && (
                    <span
                        aria-hidden
                        className={`h-2 w-2 shrink-0 rounded-full ${LIFECYCLE_DOT[leadStatusTone(column.lifecycle)]}`}
                    />
                )}
                <h3 className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-700" title={column.label}>
                    {column.label}
                </h3>
                {!firstLoad && (
                    <span className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs tabular-nums text-gray-600">
                        {total}
                    </span>
                )}
            </header>
            <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
                {firstLoad ? (
                    <>
                        <div className="h-16 animate-pulse rounded-md bg-gray-200" />
                        <div className="h-16 animate-pulse rounded-md bg-gray-200" />
                    </>
                ) : (
                    items.map((lead) => (
                        <DraggableCard key={lead.id} lead={lead} columnKey={column.key} group={group} labels={labels} />
                    ))
                )}
                {!firstLoad && !state?.error && items.length === 0 && (
                    <p className="rounded-md border border-dashed border-gray-200 px-2 py-6 text-center text-xs text-gray-500">
                        {b.emptyColumn}
                    </p>
                )}
                {state?.error && (
                    <div className="space-y-1 text-center text-xs text-danger-text">
                        <p>{b.loadFailed}</p>
                        <Button variant="ghost" size="sm" onClick={() => onRetry(column.key)}>
                            {b.retry}
                        </Button>
                    </div>
                )}
                {!firstLoad && !state?.error && items.length < total && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="justify-center"
                        loading={state?.loading}
                        onClick={() => onLoadMore(column.key)}
                    >
                        {b.loadMore}
                    </Button>
                )}
            </div>
        </section>
    );
}

/**
 * The leads list laid out as a pipeline: one column per value of the field
 * the board is grouped by, and dragging a card to another column changes that
 * field on the lead.
 */
export default function LeadsBoard({
    group,
    columns,
    baseQuery,
    enabled,
    reloadSignal,
}: Readonly<{
    group: LeadBoardGroup;
    /** Already narrowed to the list's filter on the same field. */
    columns: BoardColumn[];
    baseQuery: LeadsQuery;
    enabled: boolean;
    /** Bumped to fetch every column again — the refresh button, an import. */
    reloadSignal: number;
}>) {
    const { t, fmt } = useI18n();
    const m = t.crm.leads;
    const b = m.board;
    const c = t.common;
    const router = useRouter();
    const board = useBoardData(group, columns, baseQuery, enabled, reloadSignal);

    const labels: CardLabels = useMemo(
        () => ({ statuses: m.statuses, priorities: m.priorities, score: m.fields.score }),
        [m],
    );

    const [dragging, setDragging] = useState<{ lead: BoardLead; from: string } | null>(null);
    const [pending, setPending] = useState<Pending | null>(null);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);

    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
        // A press-and-hold on a phone, so a swipe still scrolls the board.
        useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
        useSensor(KeyboardSensor),
    );

    // Retired options and "no source" only earn a column while leads sit in them.
    const visible = columns.filter((col) => !col.hideWhenEmpty || (board.columns[col.key]?.total ?? 0) > 0);

    const shownTotal = visible.reduce((sum, col) => sum + (board.columns[col.key]?.total ?? 0), 0);
    const allCounted = visible.every((col) => {
        const state = board.columns[col.key];
        return state && state.page > 0 && !state.error;
    });
    const outside = board.matching !== null && allCounted ? board.matching - shownTotal : 0;

    const viewCustomer = useCallback(
        (customerId: string) => ({ label: m.viewCustomer, onClick: () => router.push(routes.sales.customerDetail(customerId)) }),
        [m.viewCustomer, router],
    );

    const patchLead = useCallback(
        async (lead: BoardLead, from: string, to: string, body: Record<string, string | null>) => {
            const undo = board.move(lead, from, to);
            try {
                const updated = await api.updateLead(lead.id, body);
                if (updated?.id) board.replace(updated);
            } catch (err) {
                undo();
                toast.error(`${fmt(b.moveFailed, { name: lead.name })} ${errorText(err)}`.trim());
            }
        },
        [board, b.moveFailed, fmt],
    );

    const onDragStart = ({ active }: DragStartEvent) => {
        const data = active.data.current as { lead: BoardLead; from: string } | undefined;
        setDragging(data ?? null);
    };

    const onDragEnd = ({ active, over }: DragEndEvent) => {
        setDragging(null);
        const data = active.data.current as { lead: BoardLead; from: string } | undefined;
        if (!data || !over) return;
        const from = columns.find((col) => col.key === data.from);
        const to = columns.find((col) => col.key === over.id);
        if (!from || !to) return;
        const action = dropAction(data.lead, from, to);
        if (action.kind === 'patch') {
            void patchLead(data.lead, from.key, to.key, action.body);
        } else if (action.kind === 'lost') {
            setReason('');
            setPending({ kind: 'lost', lead: data.lead, from: from.key, to: to.key, body: action.body });
        } else if (action.kind === 'convert') {
            setPending({ kind: 'convert', lead: data.lead, from: from.key, to: to.key });
        }
    };

    const confirmLost = async () => {
        if (pending?.kind !== 'lost') return;
        setBusy(true);
        try {
            const updated = await api.updateLead(pending.lead.id, { ...pending.body, lost_reason: reason.trim() });
            board.move(pending.lead, pending.from, pending.to);
            if (updated?.id) board.replace(updated);
            setPending(null);
        } catch (err) {
            // The dialog stays open with the reason typed, so it can be retried.
            toast.error(`${fmt(b.moveFailed, { name: pending.lead.name })} ${errorText(err)}`.trim());
        } finally {
            setBusy(false);
        }
    };

    const confirmConvert = async () => {
        if (pending?.kind !== 'convert') return;
        setBusy(true);
        try {
            const result = await api.convertLead(pending.lead.id);
            board.move(pending.lead, pending.from, pending.to);
            if (result?.lead?.id) board.replace(result.lead);
            const customerId = result?.customer?.id;
            toast.success(m.converted, customerId ? { action: viewCustomer(customerId) } : undefined);
            setPending(null);
        } catch (err: any) {
            setPending(null);
            const customerId = err?.customerId ?? err?.response?.customerId;
            if (customerId) toast.error(m.customerExists, { action: viewCustomer(customerId) });
            else toast.error(errorText(err) || m.convertFailed);
        } finally {
            setBusy(false);
        }
    };

    if (board.denied) {
        return (
            <div className="rounded-md border border-red-200 bg-danger-light px-4 py-3 text-sm font-semibold text-danger-text">
                {m.accessDenied}
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {outside > 0 && <Alert tone="info">{fmt(b.outsideColumns, { count: outside })}</Alert>}

            <DndContext
                sensors={sensors}
                collisionDetection={collision}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragCancel={() => setDragging(null)}
            >
                {/* The board scrolls sideways inside itself, never the page. */}
                <div className={`overflow-x-auto pb-2 ${dragging ? 'select-none' : ''}`} data-testid="leads-board">
                    <div className="flex items-start gap-3">
                        {visible.map((column) => (
                            <Column
                                key={column.key}
                                column={column}
                                state={board.columns[column.key]}
                                group={group}
                                labels={labels}
                                draggingFrom={dragging?.from ?? null}
                                onRetry={board.retry}
                                onLoadMore={(key) => void board.loadMore(key)}
                            />
                        ))}
                    </div>
                </div>
                <DragOverlay dropAnimation={null}>
                    {dragging ? <LeadCard lead={dragging.lead} group={group} labels={labels} overlay /> : null}
                </DragOverlay>
            </DndContext>

            <ConfirmDialog
                open={pending?.kind === 'lost'}
                title={b.lostTitle}
                prompt={pending ? fmt(b.lostPrompt, { name: pending.lead.name }) : ''}
                confirmLabel={b.lostConfirm}
                cancelLabel={c.cancel}
                workingLabel={b.working}
                loading={busy}
                confirmDisabled={!reason.trim()}
                danger
                onConfirm={() => void confirmLost()}
                onCancel={() => setPending(null)}
            >
                <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={m.fields.lostReasonPlaceholder}
                    aria-label={m.fields.lostReason}
                    rows={3}
                    autoFocus
                />
            </ConfirmDialog>

            <ConfirmDialog
                open={pending?.kind === 'convert'}
                title={b.convertTitle}
                prompt={pending ? fmt(b.convertPrompt, { name: pending.lead.name }) : ''}
                confirmLabel={m.convert}
                cancelLabel={c.cancel}
                workingLabel={b.working}
                loading={busy}
                onConfirm={() => void confirmConvert()}
                onCancel={() => setPending(null)}
            />
        </div>
    );
}
