import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/api/api_exception.dart';
import '../../../core/format/format.dart';
import '../../../ui/launch.dart';
import '../../../ui/theme.dart';
import '../../../ui/widgets.dart';
import '../data/crm_providers.dart';
import '../data/models.dart';
import '../widgets/crm_widgets.dart';

class ContactDetailScreen extends ConsumerWidget {
  const ContactDetailScreen({super.key, required this.contactId});

  final String contactId;

  Future<void> _delete(
    BuildContext context,
    WidgetRef ref,
    Contact contact,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Delete ${contact.name}?'),
        content: const Text('This cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep'),
          ),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    try {
      await ref.read(crmRepositoryProvider).deleteContact(contact.id);
      ref.refreshContactViews();
      if (context.mounted) context.pop();
      showToast('Contact deleted', tone: Tone.success);
    } on ApiException catch (e) {
      showToast(e.message, tone: Tone.danger);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final contact = ref.watch(contactProvider(contactId));
    final loaded = contact.value;

    return Scaffold(
      appBar: AppBar(
        title: Text(loaded?.name ?? 'Contact'),
        actions: [
          if (loaded != null) ...[
            IconButton(
              tooltip: 'Edit',
              icon: const Icon(Icons.edit_outlined),
              onPressed: () => context.push('/contacts/$contactId/edit'),
            ),
            PopupMenuButton<String>(
              onSelected: (value) {
                if (value == 'delete') _delete(context, ref, loaded);
              },
              itemBuilder: (_) => const [
                PopupMenuItem(
                  value: 'delete',
                  child: Text(
                    'Delete contact',
                    style: TextStyle(color: AppColors.danger),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
      body: contact.when(
        skipLoadingOnRefresh: true,
        loading: () => const LoadingView(),
        error: (error, _) => ErrorView(
          message: describeError(error),
          onRetry: () => ref.invalidate(contactProvider(contactId)),
        ),
        data: (contact) => RefreshIndicator(
          onRefresh: () => ref.refresh(contactProvider(contactId).future),
          child: ListView(
            padding: const EdgeInsets.all(12),
            children: [
              SectionCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        InitialsAvatar(initialsOf(contact.name), size: 44),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                contact.name,
                                style: Theme.of(
                                  context,
                                ).textTheme.titleMedium?.copyWith(fontSize: 16),
                              ),
                              if (contact.roleLine != null) ...[
                                const SizedBox(height: 2),
                                Text(
                                  contact.roleLine!,
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                              ],
                            ],
                          ),
                        ),
                      ],
                    ),
                    const Divider(height: 24),
                    ReachOutBar(
                      mobile: contact.mobile ?? contact.phone,
                      email: contact.email,
                    ),
                  ],
                ),
              ),
              _CardPhotos(contactId: contactId),
              const SizedBox(height: 12),
              SectionCard(
                title: 'Details',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (contact.mobile != null)
                      InfoRow(
                        label: 'Mobile',
                        value: contact.mobile!,
                        icon: Icons.call_outlined,
                        onTap: () => callNumber(contact.mobile!),
                      ),
                    if (contact.phone != null)
                      InfoRow(
                        label: 'Phone',
                        value: contact.phone!,
                        icon: Icons.call_outlined,
                        onTap: () => callNumber(contact.phone!),
                      ),
                    if (contact.email != null)
                      InfoRow(
                        label: 'Email',
                        value: contact.email!,
                        icon: Icons.mail_outline,
                        onTap: () => emailAddress(contact.email!),
                      ),
                    if (contact.address != null)
                      InfoRow(label: 'Address', value: contact.address!),
                    if (contact.websiteUrl != null)
                      InfoRow(
                        label: 'Website',
                        value: contact.websiteUrl!,
                        icon: Icons.open_in_new,
                        onTap: () => openLink(contact.websiteUrl!),
                      ),
                    if (contact.linkedinUrl != null)
                      InfoRow(
                        label: 'LinkedIn',
                        value: contact.linkedinUrl!,
                        icon: Icons.open_in_new,
                        onTap: () => openLink(contact.linkedinUrl!),
                      ),
                    InfoRow(
                      label: 'Owner',
                      value: contact.assignee?.displayName ?? 'Unassigned',
                    ),
                    if (contact.notes != null)
                      InfoRow(label: 'Notes', value: contact.notes!),
                    InfoRow(
                      label: 'Added',
                      value: formatDate(contact.createdAt),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The business-card photos kept against a contact. Shows nothing while
/// loading, on error, or when there are none — the card is a bonus, not part
/// of the record the screen exists to show.
class _CardPhotos extends ConsumerWidget {
  const _CardPhotos({required this.contactId});

  final String contactId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final urls = ref.watch(contactCardsProvider(contactId)).value ?? const [];
    if (urls.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: SectionCard(
        title: 'Business card',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final url in urls)
              GestureDetector(
                onTap: () => _open(context, url),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Image.network(
                    url,
                    fit: BoxFit.cover,
                    height: 180,
                    errorBuilder: (_, _, _) => const SizedBox(
                      height: 80,
                      child: Center(child: Text('Card photo unavailable')),
                    ),
                    loadingBuilder: (_, child, progress) => progress == null
                        ? child
                        : const SizedBox(
                            height: 180,
                            child: Center(child: CircularProgressIndicator()),
                          ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  void _open(BuildContext context, String url) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        fullscreenDialog: true,
        builder: (_) => Scaffold(
          appBar: AppBar(title: const Text('Business card')),
          body: Center(
            child: InteractiveViewer(
              minScale: 1,
              maxScale: 5,
              child: Image.network(url, fit: BoxFit.contain),
            ),
          ),
        ),
      ),
    );
  }
}
