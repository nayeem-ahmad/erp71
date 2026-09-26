import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../ui/widgets.dart';
import '../../home/home_shell.dart';
import '../access.dart';
import '../data/crm_providers.dart';
import '../data/crm_repository.dart';
import '../widgets/crm_widgets.dart';
import 'activity_sheets.dart';

/// Tasks and logged touches across every lead — the web's Activities page,
/// cut to what a phone is for: what is due, what is late, what got done.
class ActivitiesScreen extends ConsumerStatefulWidget {
  const ActivitiesScreen({super.key, this.initialView});

  /// Set by links from the overview tiles (`/activities?view=overdue`).
  final ActivityView? initialView;

  @override
  ConsumerState<ActivitiesScreen> createState() => _ActivitiesScreenState();
}

class _ActivitiesScreenState extends ConsumerState<ActivitiesScreen> {
  late ActivityView _view = widget.initialView ?? ActivityView.today;

  @override
  Widget build(BuildContext context) {
    if (!ref.can(CrmPermission.viewActivities)) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('Activities'),
          actions: const [AccountButton()],
        ),
        body: const EmptyView(
          icon: Icons.lock_outline,
          title: "Your role doesn't include activities",
          message:
              'Ask the workspace owner to add the "View CRM interactions" '
              'permission to your role.',
        ),
      );
    }

    final mine = ref.watch(crmMineOnlyProvider);
    final query = ActivityQuery(view: _view, mine: mine);
    final state = ref.watch(activitiesProvider(query));
    final controller = ref.read(activitiesProvider(query).notifier);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Activities'),
        actions: const [AccountButton()],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
            child: SizedBox(
              width: double.infinity,
              child: SegmentedButton<ActivityView>(
                showSelectedIcon: false,
                segments: [
                  for (final view in ActivityView.values)
                    ButtonSegment(value: view, label: Text(view.label)),
                ],
                selected: {_view},
                onSelectionChanged: (views) =>
                    setState(() => _view = views.first),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Row(
              children: [
                FilterChip(
                  label: const Text('Assigned to me'),
                  selected: mine,
                  onSelected: ref.read(crmMineOnlyProvider.notifier).set,
                ),
                const Spacer(),
                if (!state.loading && state.error == null)
                  Text(
                    '${state.total}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          Expanded(
            child: PagedListView(
              state: state,
              onRefresh: controller.refresh,
              onLoadMore: controller.loadMore,
              itemBuilder: (context, activity) => ActivityTile(
                activity: activity,
                onTap: () => showActivitySheet(context, activity),
              ),
              empty: EmptyView(
                icon: Icons.event_available_outlined,
                title: switch (_view) {
                  ActivityView.today => 'Nothing due today',
                  ActivityView.overdue => 'Nothing overdue',
                  ActivityView.open => 'No open activities',
                  ActivityView.done => 'Nothing done yet',
                },
                message: mine
                    ? 'Showing activities assigned to you.'
                    : "Showing everyone's activities.",
              ),
            ),
          ),
        ],
      ),
    );
  }
}
