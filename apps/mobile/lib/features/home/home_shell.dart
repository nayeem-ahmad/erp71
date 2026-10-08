import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/access.dart';
import '../../core/auth/auth_controller.dart';
import '../../ui/widgets.dart';
import '../alerts/alerts_data.dart' show unreadAlertsProvider;
import '../approvals/approvals_data.dart' show approvalsInboxProvider;

/// The shell's branches, in the order the router declares them. Fixed, so a
/// link like `/leads?status=open` resolves the same way whichever tabs this
/// member is shown. New areas are appended, never inserted.
abstract final class ShellBranch {
  static const home = 0;
  static const cashiers = 1;
  static const crm = 2;
  static const leads = 3;
  static const activities = 4;
  static const contacts = 5;
  static const alerts = 6;
  static const more = 7;
  static const approvals = 8;
}

/// One entry of the bottom bar, and the branches it stands for.
class ShellTab {
  const ShellTab({
    required this.label,
    required this.icon,
    required this.selectedIcon,
    required this.branches,
  });

  final String label;
  final IconData icon;
  final IconData selectedIcon;

  /// The first is where tapping the tab goes; any of them highlights it.
  final List<int> branches;
}

const _alertsTab = ShellTab(
  label: 'Alerts',
  icon: Icons.notifications_none,
  selectedIcon: Icons.notifications,
  branches: [ShellBranch.alerts],
);

/// The bar for [access]. Someone who runs the shop gets *Home · Approvals ·
/// Alerts · More*, with Cashiers and the CRM behind More; a CRM-only member
/// keeps the CRM's own four tabs, with Alerts beside them.
List<ShellTab> shellTabsFor(MobileAccess access) {
  if (!access.business) {
    return const [
      ShellTab(
        label: 'Overview',
        icon: Icons.space_dashboard_outlined,
        selectedIcon: Icons.space_dashboard,
        branches: [ShellBranch.crm],
      ),
      ShellTab(
        label: 'Leads',
        icon: Icons.people_alt_outlined,
        selectedIcon: Icons.people_alt,
        branches: [ShellBranch.leads],
      ),
      ShellTab(
        label: 'Activities',
        icon: Icons.event_note_outlined,
        selectedIcon: Icons.event_note,
        branches: [ShellBranch.activities],
      ),
      ShellTab(
        label: 'Contacts',
        icon: Icons.contacts_outlined,
        selectedIcon: Icons.contacts,
        branches: [ShellBranch.contacts],
      ),
      _alertsTab,
    ];
  }
  return [
    if (access.home)
      const ShellTab(
        label: 'Home',
        icon: Icons.insights_outlined,
        selectedIcon: Icons.insights,
        branches: [ShellBranch.home],
      ),
    if (access.approvals)
      const ShellTab(
        label: 'Approvals',
        icon: Icons.fact_check_outlined,
        selectedIcon: Icons.fact_check,
        branches: [ShellBranch.approvals],
      ),
    _alertsTab,
    const ShellTab(
      label: 'More',
      icon: Icons.menu,
      selectedIcon: Icons.menu_open,
      branches: [
        ShellBranch.more,
        ShellBranch.cashiers,
        ShellBranch.crm,
        ShellBranch.leads,
        ShellBranch.activities,
        ShellBranch.contacts,
      ],
    ),
  ];
}

/// The bottom bar over the shell's branches. Each branch keeps its own
/// navigation stack, so going to Leads and back to Home does not lose place.
class HomeShell extends ConsumerWidget {
  const HomeShell({super.key, required this.shell});

  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final workspace = ref.watch(activeWorkspaceProvider);
    final tabs = workspace == null
        ? const <ShellTab>[]
        : shellTabsFor(MobileAccess.of(workspace));
    final selected = tabs.indexWhere(
      (tab) => tab.branches.contains(shell.currentIndex),
    );
    final unread = ref.watch(unreadAlertsProvider).value ?? 0;
    final waiting = tabs.any((t) => t.branches.first == ShellBranch.approvals)
        ? ref.watch(approvalsInboxProvider).value?.total ?? 0
        : 0;

    return Scaffold(
      body: shell,
      // A bar needs two places to go between.
      bottomNavigationBar: tabs.length < 2
          ? null
          : NavigationBar(
              selectedIndex: selected < 0 ? 0 : selected,
              onDestinationSelected: (index) {
                final tab = tabs[index];
                shell.goBranch(
                  tab.branches.first,
                  // Tapping the tab you are on returns to its first screen.
                  initialLocation: index == selected,
                );
              },
              destinations: [
                for (final tab in tabs)
                  NavigationDestination(
                    icon: _withBadge(tab, Icon(tab.icon), unread, waiting),
                    selectedIcon: _withBadge(
                      tab,
                      Icon(tab.selectedIcon),
                      unread,
                      waiting,
                    ),
                    label: tab.label,
                  ),
              ],
            ),
    );
  }

  Widget _withBadge(ShellTab tab, Widget icon, int unread, int waiting) {
    final count = switch (tab.branches.first) {
      ShellBranch.alerts => unread,
      ShellBranch.approvals => waiting,
      _ => 0,
    };
    return count > 0
        ? Badge(label: Text(count > 99 ? '99+' : '$count'), child: icon)
        : icon;
  }
}

/// The signed-in person's avatar, top right of every tab: account, switching
/// workspace, signing out.
class AccountButton extends ConsumerWidget {
  const AccountButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final initials = auth is AuthSignedIn ? auth.user.initials : '?';
    return IconButton(
      tooltip: 'Account',
      onPressed: () => context.push('/account'),
      icon: InitialsAvatar(initials, size: 32),
    );
  }
}
