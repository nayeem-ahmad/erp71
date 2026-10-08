import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/access.dart';
import '../../core/auth/auth_controller.dart';
import '../../ui/theme.dart';
import '../business/widgets/business_widgets.dart' show TitleWithWorkspace;
import 'home_shell.dart';

/// Everything that is not a tab of its own: the tills, the CRM, and the
/// account. Each entry shows only when the member can open it.
class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final workspace = ref.watch(activeWorkspaceProvider);
    final access = workspace == null ? null : MobileAccess.of(workspace);

    return Scaffold(
      appBar: AppBar(
        title: const TitleWithWorkspace('More'),
        actions: const [AccountButton()],
      ),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          if (access?.cashiers ?? false)
            _Section(
              title: 'Shop',
              entries: [
                _Entry(
                  icon: Icons.point_of_sale_outlined,
                  label: 'Cashiers',
                  detail: "Open tills and today's closed shifts",
                  onTap: () => context.go('/cashiers'),
                ),
              ],
            ),
          if (access?.crm ?? false)
            _Section(
              title: 'CRM',
              entries: [
                _Entry(
                  icon: Icons.space_dashboard_outlined,
                  label: 'Overview',
                  detail: "Pipeline and today's follow-ups",
                  onTap: () => context.go('/crm'),
                ),
                _Entry(
                  icon: Icons.people_alt_outlined,
                  label: 'Leads',
                  onTap: () => context.go('/leads'),
                ),
                _Entry(
                  icon: Icons.event_note_outlined,
                  label: 'Activities',
                  onTap: () => context.go('/activities'),
                ),
                _Entry(
                  icon: Icons.contacts_outlined,
                  label: 'Contacts',
                  onTap: () => context.go('/contacts'),
                ),
              ],
            ),
          _Section(
            title: 'You',
            entries: [
              _Entry(
                icon: Icons.notifications_active_outlined,
                label: 'Notifications',
                detail: 'What reaches this phone, and quiet hours',
                onTap: () => context.push('/notification-settings'),
              ),
              _Entry(
                icon: Icons.account_circle_outlined,
                label: 'Account',
                detail: 'Workspace, branch, app lock, sign out',
                onTap: () => context.push('/account'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.entries});

  final String title;
  final List<Widget> entries;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
          child: Text(title, style: Theme.of(context).textTheme.titleMedium),
        ),
        Card(
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              for (final (i, entry) in entries.indexed) ...[
                if (i > 0) const Divider(height: 1),
                entry,
              ],
            ],
          ),
        ),
      ],
    ),
  );
}

class _Entry extends StatelessWidget {
  const _Entry({
    required this.icon,
    required this.label,
    required this.onTap,
    this.detail,
  });

  final IconData icon;
  final String label;
  final String? detail;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => ListTile(
    minTileHeight: kTouchTarget + 4,
    tileColor: Colors.transparent,
    leading: Icon(icon, color: AppColors.primary),
    title: Text(label),
    subtitle: detail == null ? null : Text(detail!),
    trailing: const Icon(Icons.chevron_right, color: AppColors.textHint),
    onTap: onTap,
  );
}
