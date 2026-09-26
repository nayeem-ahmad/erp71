import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../ui/widgets.dart';
import '../../home/home_shell.dart';
import '../data/crm_providers.dart';
import '../data/crm_repository.dart';
import '../data/models.dart';
import '../widgets/crm_widgets.dart';

/// Every lead, searchable, open ones first by default.
class LeadsScreen extends ConsumerStatefulWidget {
  const LeadsScreen({super.key, this.initialQuery = const LeadQuery()});

  /// Set by links from the overview tiles (`/leads?stale=14`).
  final LeadQuery initialQuery;

  @override
  ConsumerState<LeadsScreen> createState() => _LeadsScreenState();
}

class _LeadsScreenState extends ConsumerState<LeadsScreen> {
  late LeadQuery _query = widget.initialQuery;

  static const _statusChoices = <(String?, String)>[
    (LeadQuery.openStatus, 'Open'),
    ('NEW', 'New'),
    ('CONTACTED', 'Contacted'),
    ('QUALIFIED', 'Qualified'),
    ('CONVERTED', 'Converted'),
    ('LOST', 'Lost'),
    (null, 'All'),
  ];

  bool get _isDefault => _query.copyWith(mine: false) == const LeadQuery();

  @override
  Widget build(BuildContext context) {
    final mine = ref.watch(crmMineOnlyProvider);
    final query = _query.copyWith(mine: mine);
    final state = ref.watch(leadsProvider(query));
    final controller = ref.read(leadsProvider(query).notifier);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Leads'),
        actions: [
          IconButton(
            tooltip: 'New lead',
            icon: const Icon(Icons.person_add_alt_1_outlined),
            onPressed: () => context.push('/leads/new'),
          ),
          const AccountButton(),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
            child: SearchField(
              hint: 'Search name, mobile, email',
              initial: _query.search,
              onChanged: (search) =>
                  setState(() => _query = _query.copyWith(search: search)),
            ),
          ),
          SizedBox(
            height: 44,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              children: [
                FilterChip(
                  label: const Text('Mine'),
                  selected: mine,
                  onSelected: ref.read(crmMineOnlyProvider.notifier).set,
                ),
                const SizedBox(width: 8),
                if (_query.staleDays != null) ...[
                  InputChip(
                    label: Text('No activity ${_query.staleDays} d'),
                    selected: true,
                    onDeleted: () => setState(
                      () => _query = _query.copyWith(staleDays: null),
                    ),
                  ),
                  const SizedBox(width: 8),
                ],
                for (final (status, label) in _statusChoices) ...[
                  ChoiceChip(
                    label: Text(label),
                    selected: _query.status == status,
                    onSelected: (_) => setState(
                      () => _query = _query.copyWith(status: status),
                    ),
                  ),
                  const SizedBox(width: 8),
                ],
              ],
            ),
          ),
          const SizedBox(height: 4),
          Expanded(
            child: PagedListView<Lead>(
              state: state,
              onRefresh: controller.refresh,
              onLoadMore: controller.loadMore,
              itemBuilder: (context, lead) => LeadTile(
                lead: lead,
                onTap: () => context.push('/leads/${lead.id}'),
              ),
              empty: EmptyView(
                icon: Icons.people_outline,
                title: _isDefault ? 'No open leads' : 'No leads match',
                message: _isDefault
                    ? 'Add the first one, or switch to All to see closed leads.'
                    : 'Try a different search or filter.',
                action: _isDefault
                    ? FilledButton.icon(
                        onPressed: () => context.push('/leads/new'),
                        icon: const Icon(Icons.add, size: 18),
                        label: const Text('New lead'),
                      )
                    : null,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
