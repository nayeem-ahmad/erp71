import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../ui/widgets.dart';
import '../../home/home_shell.dart';
import '../data/crm_providers.dart';
import '../data/crm_repository.dart';
import '../data/models.dart';
import '../widgets/crm_widgets.dart';

/// The CRM address book: people and companies worth keeping, with no pipeline.
class ContactsScreen extends ConsumerStatefulWidget {
  const ContactsScreen({super.key});

  @override
  ConsumerState<ContactsScreen> createState() => _ContactsScreenState();
}

class _ContactsScreenState extends ConsumerState<ContactsScreen> {
  String _search = '';

  @override
  Widget build(BuildContext context) {
    final mine = ref.watch(crmMineOnlyProvider);
    final query = ContactQuery(search: _search, mine: mine);
    final state = ref.watch(contactsProvider(query));
    final controller = ref.read(contactsProvider(query).notifier);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Contacts'),
        actions: [
          IconButton(
            tooltip: 'New contact',
            icon: const Icon(Icons.person_add_alt_outlined),
            onPressed: () => context.push('/contacts/new'),
          ),
          const AccountButton(),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
            child: SearchField(
              hint: 'Search name, company, mobile',
              initial: _search,
              onChanged: (search) => setState(() => _search = search),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Row(
              children: [
                FilterChip(
                  label: const Text('Mine'),
                  selected: mine,
                  onSelected: ref.read(crmMineOnlyProvider.notifier).set,
                ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          Expanded(
            child: PagedListView<Contact>(
              state: state,
              onRefresh: controller.refresh,
              onLoadMore: controller.loadMore,
              itemBuilder: (context, contact) => ContactTile(
                contact: contact,
                onTap: () => context.push('/contacts/${contact.id}'),
              ),
              empty: EmptyView(
                icon: Icons.contacts_outlined,
                title: _search.isEmpty && !mine
                    ? 'No contacts yet'
                    : 'No contacts match',
                message: mine
                    ? 'Showing contacts assigned to you.'
                    : 'Suppliers, partners and anyone else worth keeping.',
                action: _search.isEmpty
                    ? FilledButton.icon(
                        onPressed: () => context.push('/contacts/new'),
                        icon: const Icon(Icons.add, size: 18),
                        label: const Text('New contact'),
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
