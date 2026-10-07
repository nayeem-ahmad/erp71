import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/auth/auth_controller.dart';
import '../../../core/format/format.dart';
import '../../../ui/theme.dart';
import '../../../ui/widgets.dart';
import '../../home/home_shell.dart';
import '../data/business_providers.dart';
import '../data/models.dart';
import '../widgets/business_widgets.dart';

/// Every till open now, with what its drawer should hold, and every shift
/// closed today with how its count came out.
class CashiersScreen extends ConsumerWidget {
  const CashiersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final overview = ref.watch(cashierOverviewProvider);
    // With more than one branch in view, each row says which.
    final selected = ref.watch(businessBranchProvider);
    final workspace = ref.watch(activeWorkspaceProvider);
    final showBranch =
        selected == allBranches ||
        (selected == null && (workspace?.branches.length ?? 0) > 1);

    return Scaffold(
      appBar: AppBar(
        title: const TitleWithWorkspace('Cashiers'),
        actions: const [AccountButton()],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(cashierOverviewProvider);
          await ref.read(cashierOverviewProvider.future);
        },
        child: ListView(
          padding: const EdgeInsets.all(12),
          children: [
            const BranchFilter(),
            overview.when(
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
                      onPressed: () => ref.invalidate(cashierOverviewProvider),
                      icon: const Icon(Icons.refresh, size: 18),
                      label: const Text('Try again'),
                    ),
                  ],
                ),
              ),
              data: (o) => _Overview(overview: o, showBranch: showBranch),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}

class _Overview extends StatelessWidget {
  const _Overview({required this.overview, required this.showBranch});

  final CashierOverview overview;
  final bool showBranch;

  @override
  Widget build(BuildContext context) {
    final net = overview.short + overview.over;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            KpiTile(
              label: 'Open tills',
              value: formatCount(overview.open.length),
            ),
            const SizedBox(width: 8),
            KpiTile(
              label: 'Expected in drawers',
              value: formatBDT(overview.expectedCash),
            ),
          ],
        ),
        if (overview.closedToday.isNotEmpty)
          Row(
            children: [
              KpiTile(
                label: 'Closed today',
                value: formatCount(overview.closedToday.length),
              ),
              const SizedBox(width: 8),
              KpiTile(
                label: 'Short / over today',
                value: net.abs() < 1
                    ? formatBDT(0)
                    : '${net < 0 ? '−' : '+'}${formatBDT(net.abs())}',
                tone: net <= -shortfallAlertTaka
                    ? Tone.danger
                    : net.abs() >= 1
                    ? Tone.warning
                    : Tone.neutral,
                caption: overview.short < 0 && overview.over > 0
                    ? '${formatBDT(-overview.short)} short, '
                          '${formatBDT(overview.over)} over'
                    : null,
              ),
            ],
          ),
        const SizedBox(height: 12),
        _Heading('Open now'),
        if (overview.open.isEmpty)
          const _Quiet('No till is open right now.')
        else
          for (final session in overview.open)
            _SessionTile(session: session, showBranch: showBranch),
        const SizedBox(height: 12),
        _Heading('Closed today'),
        if (overview.closedToday.isEmpty)
          const _Quiet('No shift has closed yet today.')
        else
          for (final session in overview.closedToday)
            _SessionTile(session: session, showBranch: showBranch),
      ],
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
    child: Text(text, style: Theme.of(context).textTheme.titleMedium),
  );
}

class _Quiet extends StatelessWidget {
  const _Quiet(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
    child: Text(
      text,
      style: const TextStyle(fontSize: 13, color: AppColors.textSecondary),
    ),
  );
}

class _SessionTile extends StatelessWidget {
  const _SessionTile({required this.session, required this.showBranch});

  final TillSession session;
  final bool showBranch;

  @override
  Widget build(BuildContext context) {
    final where = [
      ?session.counterName,
      if (showBranch) session.branchName,
    ].join(' · ');
    final when = session.isOpen
        ? 'since ${formatDueLabel(session.openedAt)}'
        : 'closed ${formatDueLabel(session.closedAt)}';
    final badge = session.isOpen ? null : varianceBadge(session.variance);

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.go('/cashiers/${session.id}'),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              InitialsAvatar(initialsOf(session.cashierName)),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      session.cashierName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      [if (where.isNotEmpty) where, when].join(' · '),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.textSecondary,
                      ),
                    ),
                    if (badge != null) ...[
                      const SizedBox(height: 6),
                      StatusBadge(badge.label, tone: badge.tone),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    session.isOpen
                        ? formatBDT(session.expectedCash)
                        : formatBDT(session.salesTotal),
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    session.isOpen
                        ? 'in drawer · ${formatCount(session.salesCount)} sales'
                        : '${formatCount(session.salesCount)} sales',
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
