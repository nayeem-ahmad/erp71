import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/access.dart';
import '../../core/auth/auth_controller.dart';
import '../../ui/widgets.dart';

/// The shell's branches, in the order the router declares them. Fixed, so a
/// link like `/leads?status=open` resolves the same way whichever tabs this
/// member is shown.
abstract final class ShellBranch {
  static const home = 0;
  static const cashiers = 1;
  static const crm = 2;
  static const leads = 3;
  static const activities = 4;
  static const contacts = 5;
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

/// The bar for [access]. Someone who runs the shop gets Home and Cashiers,
/// with the whole CRM behind one tab; a CRM-only member keeps the CRM's own
/// four tabs, exactly as before the business screens existed.
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
    if (access.cashiers)
      const ShellTab(
        label: 'Cashiers',
        icon: Icons.point_of_sale_outlined,
        selectedIcon: Icons.point_of_sale,
        branches: [ShellBranch.cashiers],
      ),
    if (access.crm)
      const ShellTab(
        label: 'CRM',
        icon: Icons.people_alt_outlined,
        selectedIcon: Icons.people_alt,
        branches: [
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
                    icon: Icon(tab.icon),
                    selectedIcon: Icon(tab.selectedIcon),
                    label: tab.label,
                  ),
              ],
            ),
    );
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
