import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/auth/auth_controller.dart';
import '../../../core/format/format.dart';
import '../../../ui/theme.dart';
import '../../../ui/widgets.dart';
import '../../home/home_shell.dart';
import '../access.dart';
import '../activities/activity_sheets.dart';
import '../data/crm_providers.dart';
import '../data/models.dart';
import '../widgets/crm_widgets.dart';

/// The CRM at a glance: what needs attention now, and how the pipeline
/// stands. Each number links to the list behind it.
class CrmHomeScreen extends ConsumerWidget {
  const CrmHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final workspace = ref.watch(activeWorkspaceProvider);
    final mine = ref.watch(crmMineOnlyProvider);
    final canOverview = ref.can(CrmPermission.viewLeads);
    final canActivities = ref.can(CrmPermission.viewActivities);

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Overview'),
            if (workspace != null)
              Text(
                workspace.name,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w400,
                  color: AppColors.textSecondary,
                ),
              ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'New lead',
            icon: const Icon(Icons.person_add_alt_1_outlined),
            onPressed: () => context.push('/leads/new'),
          ),
          const AccountButton(),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(todayAgendaProvider);
          if (canOverview) {
            ref.invalidate(crmOverviewProvider(mine));
            await ref.read(crmOverviewProvider(mine).future);
          }
        },
        child: ListView(
          padding: const EdgeInsets.all(12),
          children: [
            SegmentedButton<bool>(
              showSelectedIcon: false,
              segments: const [
                ButtonSegment(value: true, label: Text('Mine')),
                ButtonSegment(value: false, label: Text('Everyone')),
              ],
              selected: {mine},
              onSelectionChanged: (value) =>
                  ref.read(crmMineOnlyProvider.notifier).set(value.first),
            ),
            const SizedBox(height: 12),
            if (canOverview)
              _Overview(mine: mine, agenda: canActivities)
            else ...[
              const InlineNotice(
                tone: Tone.neutral,
                message:
                    "Your role doesn't include the CRM overview. "
                    'Leads and contacts are all yours to work.',
              ),
              if (canActivities) ...[
                const SizedBox(height: 12),
                const _TodayAgenda(),
              ],
            ],
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}

class _Overview extends ConsumerWidget {
  const _Overview({required this.mine, required this.agenda});

  final bool mine;

  /// Show today's activities between the tiles and the pipeline: what to do
  /// next comes before how things stand.
  final bool agenda;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final overview = ref.watch(crmOverviewProvider(mine));
    return overview.when(
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
              onPressed: () => ref.invalidate(crmOverviewProvider(mine)),
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('Try again'),
            ),
          ],
        ),
      ),
      data: (o) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              _Kpi(
                label: 'Open leads',
                value: o.open,
                onTap: () => context.go('/leads?status=open'),
              ),
              const SizedBox(width: 8),
              _Kpi(
                label: 'Due today',
                value: o.dueToday,
                tone: o.dueToday > 0 ? Tone.primary : Tone.neutral,
                onTap: () => context.go('/activities?view=today'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              _Kpi(
                label: 'Overdue',
                value: o.overdue,
                tone: o.overdue > 0 ? Tone.danger : Tone.neutral,
                onTap: () => context.go('/activities?view=overdue'),
              ),
              const SizedBox(width: 8),
              _Kpi(
                label: 'No activity ${o.staleAfterDays} d',
                value: o.stale,
                tone: o.stale > 0 ? Tone.warning : Tone.neutral,
                onTap: () =>
                    context.go('/leads?status=open&stale=${o.staleAfterDays}'),
              ),
            ],
          ),
          if (agenda) ...[const SizedBox(height: 12), const _TodayAgenda()],
          const SizedBox(height: 12),
          _Pipeline(overview: o),
          const SizedBox(height: 12),
          SectionCard(
            title: 'Last 30 days',
            child: Column(
              children: [
                _StatLine(
                  label: 'New leads',
                  value: formatCount(o.createdInPeriod),
                ),
                _StatLine(
                  label: 'Converted',
                  value: formatCount(o.convertedInPeriod),
                ),
                _StatLine(label: 'Lost', value: formatCount(o.lostInPeriod)),
                _StatLine(
                  label: 'Conversion rate',
                  value: o.conversionRatePct == null
                      ? '—'
                      : '${o.conversionRatePct!.toStringAsFixed(1)}%',
                ),
                _StatLine(
                  label: 'Calls and visits logged',
                  value: formatCount(o.loggedInPeriod),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Kpi extends StatelessWidget {
  const _Kpi({
    required this.label,
    required this.value,
    required this.onTap,
    this.tone = Tone.neutral,
  });

  final String label;
  final int value;
  final VoidCallback onTap;
  final Tone tone;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppColors.textSecondary,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  formatCount(value),
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w700,
                    color: tone == Tone.neutral
                        ? AppColors.text
                        : tone.foreground,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Pipeline extends StatelessWidget {
  const _Pipeline({required this.overview});

  final CrmOverview overview;

  @override
  Widget build(BuildContext context) {
    final counts = overview.statusCounts;
    final largest = counts.values.fold<int>(0, (a, b) => a > b ? a : b);
    return SectionCard(
      title: 'Pipeline',
      child: Column(
        children: [
          for (final status in LeadStatus.values)
            InkWell(
              onTap: () => context.go('/leads?status=${status.code}'),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(
                  children: [
                    SizedBox(
                      width: 88,
                      child: Text(
                        status.label,
                        style: const TextStyle(fontSize: 13),
                      ),
                    ),
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(999),
                        child: LinearProgressIndicator(
                          minHeight: 8,
                          value: largest == 0
                              ? 0
                              : (counts[status] ?? 0) / largest,
                          backgroundColor: AppColors.neutralTint,
                          color: status.tone == Tone.neutral
                              ? AppColors.primary
                              : status.tone.foreground,
                        ),
                      ),
                    ),
                    SizedBox(
                      width: 48,
                      child: Text(
                        formatCount(counts[status] ?? 0),
                        textAlign: TextAlign.right,
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _StatLine extends StatelessWidget {
  const _StatLine({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                fontSize: 13,
                color: AppColors.textSecondary,
              ),
            ),
          ),
          Text(
            value,
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

/// My activities due today, the first thing a salesperson opens the app for.
class _TodayAgenda extends ConsumerWidget {
  const _TodayAgenda();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final agenda = ref.watch(todayAgendaProvider);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 8, 0),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Due today for you',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                TextButton(
                  onPressed: () => context.go('/activities?view=today'),
                  child: const Text('See all'),
                ),
              ],
            ),
          ),
          agenda.when(
            skipLoadingOnRefresh: true,
            loading: () => const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator()),
            ),
            error: (error, _) => Padding(
              padding: const EdgeInsets.all(16),
              child: TextButton.icon(
                onPressed: () => ref.invalidate(todayAgendaProvider),
                icon: const Icon(Icons.refresh, size: 18),
                label: Text(describeError(error)),
              ),
            ),
            data: (page) => page.items.isEmpty
                ? const Padding(
                    padding: EdgeInsets.fromLTRB(16, 4, 16, 16),
                    child: Text(
                      'Nothing due today.',
                      style: TextStyle(color: AppColors.textSecondary),
                    ),
                  )
                : Column(
                    children: [
                      for (final activity in page.items.take(5))
                        ActivityTile(
                          activity: activity,
                          onTap: () => showActivitySheet(context, activity),
                        ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}
