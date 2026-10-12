import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/access.dart';
import '../../../core/auth/auth_controller.dart';
import '../../../core/format/format.dart';
import '../../../ui/theme.dart';
import '../../../ui/widgets.dart';
import '../../ask/ask_screen.dart' show AskButton;
import '../../home/home_shell.dart';
import '../data/business_providers.dart';
import '../data/models.dart';
import '../widgets/business_widgets.dart';

final DateFormat _weekday = DateFormat('EEEE');
final DateFormat _weekdayShort = DateFormat('E');

/// The owner's glance: how today is going against yesterday and the same day
/// last week, how it was paid, what the tills hold and what is owed.
class BusinessHomeScreen extends ConsumerWidget {
  const BusinessHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final workspace = ref.watch(activeWorkspaceProvider);
    final tills = workspace != null && MobileAccess.of(workspace).cashiers;
    final pulse = ref.watch(pulseProvider);

    return Scaffold(
      appBar: AppBar(
        title: const TitleWithWorkspace('Home'),
        actions: const [AskButton(), AccountButton()],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          if (tills) ref.invalidate(cashierOverviewProvider);
          ref.invalidate(pulseProvider);
          await ref.read(pulseProvider.future);
        },
        child: ListView(
          padding: const EdgeInsets.all(12),
          children: [
            const BranchFilter(),
            pulse.when(
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
                      onPressed: () => ref.invalidate(pulseProvider),
                      icon: const Icon(Icons.refresh, size: 18),
                      label: const Text('Try again'),
                    ),
                  ],
                ),
              ),
              data: (p) => _Pulse(pulse: p, tills: tills),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}

class _Pulse extends StatelessWidget {
  const _Pulse({required this.pulse, required this.tills});

  final Pulse pulse;
  final bool tills;

  @override
  Widget build(BuildContext context) {
    final today = pulse.today;
    final margin = pulse.marginPct;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _TodayCard(pulse: pulse),
        const SizedBox(height: 4),
        Row(
          children: [
            KpiTile(label: 'Sales', value: formatCount(today.count)),
            const SizedBox(width: 8),
            KpiTile(
              label: 'Average sale',
              value: today.avgTicket == null ? '—' : formatBDT(today.avgTicket),
            ),
          ],
        ),
        Row(
          children: [
            KpiTile(
              label: 'Gross profit',
              value: pulse.grossProfit == null
                  ? '—'
                  : formatBDT(pulse.grossProfit),
              caption: pulse.uncostedItems > 0
                  ? '${formatCount(pulse.uncostedItems)} lines without cost'
                  : null,
            ),
            const SizedBox(width: 8),
            KpiTile(
              label: 'Margin',
              value: margin == null ? '—' : '${margin.toStringAsFixed(1)}%',
              tone: margin == null || margin >= 0 ? Tone.neutral : Tone.danger,
            ),
          ],
        ),
        if (today.returns > 0) ...[
          const SizedBox(height: 4),
          InlineNotice(
            tone: Tone.warning,
            message:
                '${formatBDT(today.returns)} refunded today '
                '(${formatCount(today.returnsCount)} '
                '${today.returnsCount == 1 ? 'return' : 'returns'}), '
                'already taken off net sales.',
          ),
        ],
        const SizedBox(height: 12),
        _Tenders(tenders: pulse.tenders),
        const SizedBox(height: 12),
        _Trend(points: pulse.trend),
        if (tills) ...[const SizedBox(height: 12), const _TillsCard()],
        const SizedBox(height: 12),
        SectionCard(
          title: 'Balances',
          child: Column(
            children: [
              FigureLine(
                label:
                    'Customers owe you '
                    '(${formatCount(pulse.receivables.parties)})',
                value: formatBDT(pulse.receivables.outstanding),
              ),
              if (pulse.payables != null)
                FigureLine(
                  label:
                      'You owe suppliers '
                      '(${formatCount(pulse.payables!.parties)})',
                  value: formatBDT(pulse.payables!.outstanding),
                ),
            ],
          ),
        ),
        if (pulse.generatedAt != null) ...[
          const SizedBox(height: 12),
          Text(
            'Figures as of ${formatDateTime(pulse.generatedAt)}. '
            'Pull down to refresh.',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12, color: AppColors.textHint),
          ),
        ],
      ],
    );
  }
}

class _TodayCard extends StatelessWidget {
  const _TodayCard({required this.pulse});

  final Pulse pulse;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Net sales today',
            style: TextStyle(fontSize: 13, color: AppColors.textSecondary),
          ),
          const SizedBox(height: 4),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              formatBDT(pulse.today.net),
              style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700),
            ),
          ),
          const SizedBox(height: 12),
          _Comparison(
            label: 'Yesterday',
            amount: pulse.yesterday.net,
            change: pulse.vsYesterdayPct,
          ),
          _Comparison(
            label: 'Last ${_weekday.format(pulse.lastWeek.date)}',
            amount: pulse.lastWeek.net,
            change: pulse.vsLastWeekPct,
          ),
        ],
      ),
    );
  }
}

/// "Yesterday ৳ 4,000.00 ▲ 50.0%": the earlier day's figure and how today
/// compares with it.
class _Comparison extends StatelessWidget {
  const _Comparison({
    required this.label,
    required this.amount,
    required this.change,
  });

  final String label;
  final double amount;
  final double? change;

  @override
  Widget build(BuildContext context) {
    final change = this.change;
    final tone = change == null || change == 0
        ? Tone.neutral
        : change > 0
        ? Tone.success
        : Tone.danger;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(
            child: Text(
              '$label  ${formatBDT(amount)}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 13,
                color: AppColors.textSecondary,
              ),
            ),
          ),
          if (change == null)
            const Text(
              '—',
              style: TextStyle(fontSize: 13, color: AppColors.textHint),
            )
          else ...[
            if (change != 0)
              Icon(
                change > 0 ? Icons.arrow_upward : Icons.arrow_downward,
                size: 14,
                color: tone.foreground,
              ),
            Text(
              '${change.abs().toStringAsFixed(1)}%',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: tone.foreground,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Tenders extends StatelessWidget {
  const _Tenders({required this.tenders});

  final List<TenderSlice> tenders;

  @override
  Widget build(BuildContext context) {
    final largest = tenders.fold<double>(0, (a, t) => math.max(a, t.amount));
    return SectionCard(
      title: 'How it was paid',
      child: tenders.isEmpty
          ? const Text(
              'No payments taken yet today.',
              style: TextStyle(fontSize: 13, color: AppColors.textSecondary),
            )
          : Column(
              children: [
                for (final tender in tenders)
                  ShareRow(
                    label: tender.label,
                    amount: tender.amount,
                    share: largest <= 0 ? 0 : tender.amount / largest,
                  ),
              ],
            ),
    );
  }
}

/// Seven bars, one per day, today in full colour.
class _Trend extends StatelessWidget {
  const _Trend({required this.points});

  final List<TrendPoint> points;

  @override
  Widget build(BuildContext context) {
    if (points.isEmpty) return const SizedBox.shrink();
    final largest = points.fold<double>(0, (a, p) => math.max(a, p.netSales));
    final total = points.fold<double>(0, (a, p) => a + p.netSales);
    return SectionCard(
      title: 'Last 7 days',
      trailing: Text(
        formatBDT(total),
        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
      ),
      child: SizedBox(
        height: 104,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            for (final (index, point) in points.indexed)
              Expanded(
                child: Semantics(
                  label:
                      '${_weekday.format(point.date)} '
                      '${formatBDT(point.netSales)}',
                  excludeSemantics: true,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        Container(
                          height: largest <= 0
                              ? 2
                              : math.max(2, 72 * point.netSales / largest),
                          decoration: BoxDecoration(
                            color: index == points.length - 1
                                ? AppColors.primary
                                : AppColors.primary.withValues(alpha: 0.35),
                            borderRadius: BorderRadius.circular(
                              AppRadius.control / 2,
                            ),
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          _weekdayShort.format(point.date),
                          style: const TextStyle(
                            fontSize: 11,
                            color: AppColors.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// The tills in one line, linking to the Cashiers tab.
class _TillsCard extends ConsumerWidget {
  const _TillsCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final overview = ref.watch(cashierOverviewProvider);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.go('/cashiers'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              const Icon(
                Icons.point_of_sale_outlined,
                color: AppColors.primary,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: overview.when(
                  skipLoadingOnRefresh: true,
                  loading: () => const Text('Tills…'),
                  error: (error, _) => Text(
                    describeError(error),
                    style: const TextStyle(fontSize: 13),
                  ),
                  data: (o) => Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        o.open.isEmpty
                            ? 'No till open'
                            : '${formatCount(o.open.length)} '
                                  '${o.open.length == 1 ? 'till' : 'tills'} open',
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        o.open.isEmpty
                            ? '${formatCount(o.closedToday.length)} closed today'
                            : '${formatBDT(o.expectedCash)} expected in the '
                                  '${o.open.length == 1 ? 'drawer' : 'drawers'}',
                        style: const TextStyle(
                          fontSize: 13,
                          color: AppColors.textSecondary,
                        ),
                      ),
                      if (o.short < 0) ...[
                        const SizedBox(height: 2),
                        Text(
                          '${formatBDT(-o.short)} short at close today',
                          style: TextStyle(
                            fontSize: 13,
                            color: Tone.danger.foreground,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              const Icon(Icons.chevron_right, color: AppColors.textHint),
            ],
          ),
        ),
      ),
    );
  }
}
