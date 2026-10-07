import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/format/format.dart';
import '../../../ui/theme.dart';
import '../../../ui/widgets.dart';
import '../data/business_providers.dart';
import '../data/models.dart';
import '../widgets/business_widgets.dart';

/// One shift: who, where, how the drawer should add up, and every hand
/// movement of cash in or out of it.
class TillDetailScreen extends ConsumerWidget {
  const TillDetailScreen({super.key, required this.sessionId});

  final String sessionId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Reached from the Cashiers list, which already holds who and where.
    final session = ref
        .watch(cashierOverviewProvider)
        .whenData((o) => o.find(sessionId))
        .value;
    final summary = ref.watch(tillSummaryProvider(sessionId));
    final movements = ref.watch(cashMovementsProvider(sessionId));

    return Scaffold(
      appBar: AppBar(title: Text(session?.cashierName ?? 'Till')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref
            ..invalidate(tillSummaryProvider(sessionId))
            ..invalidate(cashMovementsProvider(sessionId));
          await ref.read(tillSummaryProvider(sessionId).future);
        },
        child: ListView(
          padding: const EdgeInsets.all(12),
          children: [
            if (session != null) ...[
              _Header(session: session),
              const SizedBox(height: 12),
            ],
            summary.when(
              skipLoadingOnRefresh: true,
              loading: () => const Padding(
                padding: EdgeInsets.all(32),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (error, _) => SectionCard(
                child: Column(
                  children: [
                    Text(describeError(error), textAlign: TextAlign.center),
                    TextButton.icon(
                      onPressed: () =>
                          ref.invalidate(tillSummaryProvider(sessionId)),
                      icon: const Icon(Icons.refresh, size: 18),
                      label: const Text('Try again'),
                    ),
                  ],
                ),
              ),
              data: (s) => Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _Drawer(summary: s),
                  const SizedBox(height: 12),
                  _Takings(summary: s),
                ],
              ),
            ),
            const SizedBox(height: 12),
            SectionCard(
              title: 'Cash in and out',
              child: movements.when(
                skipLoadingOnRefresh: true,
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (error, _) => Text(describeError(error)),
                data: (rows) => rows.isEmpty
                    ? const Text(
                        'No cash was added or taken out by hand.',
                        style: TextStyle(
                          fontSize: 13,
                          color: AppColors.textSecondary,
                        ),
                      )
                    : Column(
                        children: [
                          for (final row in rows) _MovementLine(movement: row),
                        ],
                      ),
              ),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.session});

  final TillSession session;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  [?session.counterName, session.branchName].join(' · '),
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              StatusBadge(
                session.isOpen ? 'Open' : 'Closed',
                tone: session.isOpen ? Tone.primary : Tone.neutral,
              ),
            ],
          ),
          const SizedBox(height: 8),
          InfoRow(label: 'Opened', value: formatDateTime(session.openedAt)),
          if (!session.isOpen)
            InfoRow(label: 'Closed', value: formatDateTime(session.closedAt)),
        ],
      ),
    );
  }
}

/// Opening float, plus cash sales and cash in, less refunds and cash out,
/// is what the drawer should hold; at close, against what was counted.
class _Drawer extends StatelessWidget {
  const _Drawer({required this.summary});

  final TillSummary summary;

  @override
  Widget build(BuildContext context) {
    final badge = summary.closingCash == null
        ? null
        : varianceBadge(summary.variance);
    return SectionCard(
      title: 'Cash drawer',
      trailing: badge == null
          ? null
          : StatusBadge(badge.label, tone: badge.tone),
      child: Column(
        children: [
          FigureLine(
            label: 'Opening float',
            value: formatBDT(summary.openingCash),
          ),
          FigureLine(
            label: 'Cash sales',
            value: '+ ${formatBDT(summary.cashTakings)}',
          ),
          if (summary.cashIn > 0)
            FigureLine(
              label: 'Cash in',
              value: '+ ${formatBDT(summary.cashIn)}',
            ),
          if (summary.refunds > 0)
            FigureLine(
              label: 'Refunds',
              value: '− ${formatBDT(summary.refunds)}',
            ),
          if (summary.cashOut > 0)
            FigureLine(
              label: 'Cash out',
              value: '− ${formatBDT(summary.cashOut)}',
            ),
          const Divider(height: 16),
          FigureLine(
            label: 'Expected in drawer',
            value: formatBDT(summary.expectedCash),
            strong: true,
          ),
          if (summary.closingCash != null) ...[
            FigureLine(
              label: 'Counted at close',
              value: formatBDT(summary.closingCash),
              strong: true,
            ),
            if (summary.variance != null)
              FigureLine(
                label: 'Difference',
                value: summary.variance!.abs() < 1
                    ? formatBDT(0)
                    : '${summary.variance! < 0 ? '−' : '+'} '
                          '${formatBDT(summary.variance!.abs())}',
                tone: badge?.tone ?? Tone.neutral,
              ),
          ],
        ],
      ),
    );
  }
}

class _Takings extends StatelessWidget {
  const _Takings({required this.summary});

  final TillSummary summary;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      title: 'Takings',
      trailing: Text(
        '${formatCount(summary.salesCount)} '
        '${summary.salesCount == 1 ? 'sale' : 'sales'}',
        style: const TextStyle(fontSize: 13, color: AppColors.textSecondary),
      ),
      child: Column(
        children: [
          for (final row in summary.paymentBreakdown)
            FigureLine(label: row.method, value: formatBDT(row.amount)),
          if (summary.paymentBreakdown.isEmpty)
            const FigureLine(label: 'No payments yet', value: '—'),
          const Divider(height: 16),
          FigureLine(
            label: 'Sales total',
            value: formatBDT(summary.salesTotal),
            strong: true,
          ),
        ],
      ),
    );
  }
}

class _MovementLine extends StatelessWidget {
  const _MovementLine({required this.movement});

  final CashMovement movement;

  @override
  Widget build(BuildContext context) {
    final out = movement.amount < 0;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(movement.typeLabel, style: const TextStyle(fontSize: 13)),
                Text(
                  [
                    if (movement.description?.trim().isNotEmpty ?? false)
                      movement.description!.trim(),
                    formatDueLabel(movement.createdAt),
                  ].join(' · '),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          Text(
            '${out ? '−' : '+'} ${formatBDT(movement.amount.abs())}',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: out ? AppColors.text : Tone.success.foreground,
            ),
          ),
        ],
      ),
    );
  }
}
