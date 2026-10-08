import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/access.dart';
import '../core/auth/auth_controller.dart';
import '../features/alerts/alert_settings_screen.dart';
import '../features/alerts/alerts_screen.dart';
import '../features/approvals/approvals_screen.dart';
import '../features/auth/sign_in_screen.dart';
import '../features/auth/splash_screen.dart';
import '../features/auth/two_factor_screen.dart';
import '../features/business/cashiers/cashiers_screen.dart';
import '../features/business/cashiers/till_detail_screen.dart';
import '../features/business/home/business_home_screen.dart';
import '../features/crm/activities/activities_screen.dart';
import '../features/crm/contacts/contact_detail_screen.dart';
import '../features/crm/contacts/contact_form_screen.dart';
import '../features/crm/contacts/contacts_screen.dart';
import '../features/crm/data/crm_repository.dart';
import '../features/crm/data/models.dart';
import '../features/crm/home/crm_home_screen.dart';
import '../features/crm/leads/lead_detail_screen.dart';
import '../features/crm/leads/lead_form_screen.dart';
import '../features/crm/leads/leads_screen.dart';
import '../features/crm/no_crm_screen.dart';
import '../features/home/home_shell.dart';
import '../features/home/more_screen.dart';
import '../features/workspace/workspace_screens.dart';

/// Screens that belong to getting signed in, and are left once that is done.
const _entryLocations = {
  '/splash',
  '/sign-in',
  '/two-factor',
  '/workspaces',
  '/no-workspace',
  '/no-crm',
};

/// Where [auth] says the user must be, or null to let them go to [location].
String? redirectFor(AuthState auth, String location) {
  String? only(String page) => location == page ? null : page;

  switch (auth) {
    case AuthRestoring():
    case AuthRestoreFailed():
      return only('/splash');
    case AuthSignedOut():
      return only('/sign-in');
    case AuthNeedsTwoFactor():
      return only('/two-factor');
    case AuthSignedIn(:final workspaces, :final workspace):
      if (workspaces.isEmpty) return only('/no-workspace');
      if (workspace == null) return only('/workspaces');
      final access = MobileAccess.of(workspace);
      if (!access.any) {
        return {'/no-crm', '/workspaces', '/account'}.contains(location)
            ? null
            : '/no-crm';
      }
      // `/workspaces` stays reachable for switching.
      if (location == '/workspaces') return null;
      if (_entryLocations.contains(location)) return access.startLocation;
      // A link into an area this member cannot open — or one left over from
      // the workspace they just switched away from — lands on their start.
      return access.allows(location) ? null : access.startLocation;
  }
}

/// Reads `/leads?status=…&stale=…` and `/leads?statusId=…` — the links the
/// overview tiles and pipeline bars make.
/// Anything unrecognised falls back to the default list rather than a
/// request the API would refuse.
LeadQuery leadQueryFromLink(Map<String, String> params) {
  final status = params['status'];
  final stale = int.tryParse(params['stale'] ?? '');
  final staleDays = stale != null && stale > 0 && stale <= 3650 ? stale : null;
  // A pipeline bar links at one of the workspace's stages.
  final statusId = params['statusId'];
  if (statusId != null && statusId.isNotEmpty) {
    return LeadQuery(status: null, statusId: statusId, staleDays: staleDays);
  }
  return LeadQuery(
    status: status == LeadQuery.openStatus || LeadStatus.parse(status) != null
        ? status
        : LeadQuery.openStatus,
    staleDays: staleDays,
  );
}

/// Rebuilt whenever the workspace changes, so switching shops starts every
/// tab afresh instead of leaving the previous shop's records on screen. Each
/// router gets its own navigator key for the same reason.
final routerProvider = Provider<GoRouter>((ref) {
  ref.watch(activeWorkspaceProvider.select((w) => w?.id));

  final rootNavigatorKey = GlobalKey<NavigatorState>();
  final refresh = ValueNotifier<int>(0);
  ref.listen(authControllerProvider, (_, _) => refresh.value++);

  final router = GoRouter(
    navigatorKey: rootNavigatorKey,
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (context, state) =>
        redirectFor(ref.read(authControllerProvider), state.matchedLocation),
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const SplashScreen()),
      GoRoute(path: '/sign-in', builder: (_, _) => const SignInScreen()),
      GoRoute(path: '/two-factor', builder: (_, _) => const TwoFactorScreen()),
      GoRoute(
        path: '/workspaces',
        builder: (_, _) => const WorkspacePickerScreen(),
      ),
      GoRoute(
        path: '/no-workspace',
        builder: (_, _) => const NoWorkspaceScreen(),
      ),
      GoRoute(path: '/no-crm', builder: (_, _) => const NoCrmScreen()),
      GoRoute(path: '/account', builder: (_, _) => const AccountScreen()),
      GoRoute(
        path: '/notification-settings',
        builder: (_, _) => const AlertSettingsScreen(),
      ),
      GoRoute(
        path: '/leads/new',
        parentNavigatorKey: rootNavigatorKey,
        builder: (_, _) => const LeadFormScreen(),
      ),
      GoRoute(
        path: '/leads/:id/edit',
        parentNavigatorKey: rootNavigatorKey,
        builder: (_, state) =>
            LeadFormScreen(leadId: state.pathParameters['id']),
      ),
      GoRoute(
        path: '/contacts/new',
        parentNavigatorKey: rootNavigatorKey,
        builder: (_, _) => const ContactFormScreen(),
      ),
      GoRoute(
        path: '/contacts/:id/edit',
        parentNavigatorKey: rootNavigatorKey,
        builder: (_, state) =>
            ContactFormScreen(contactId: state.pathParameters['id']),
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => HomeShell(shell: shell),
        // Every branch exists for everyone, in ShellBranch order; the
        // redirect keeps a member out of the ones they cannot use and the bar
        // shows only theirs.
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/home',
                builder: (_, _) => const BusinessHomeScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/cashiers',
                builder: (_, _) => const CashiersScreen(),
                routes: [
                  GoRoute(
                    path: ':id',
                    builder: (_, state) => TillDetailScreen(
                      sessionId: state.pathParameters['id']!,
                    ),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(path: '/crm', builder: (_, _) => const CrmHomeScreen()),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/leads',
                // Keyed on the query so a link from the overview with new
                // filters starts a fresh list instead of keeping the old one.
                builder: (_, state) => LeadsScreen(
                  key: ValueKey(state.uri.query),
                  initialQuery: leadQueryFromLink(state.uri.queryParameters),
                ),
                routes: [
                  GoRoute(
                    path: ':id',
                    builder: (_, state) =>
                        LeadDetailScreen(leadId: state.pathParameters['id']!),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/activities',
                builder: (_, state) => ActivitiesScreen(
                  key: ValueKey(state.uri.query),
                  initialView: ActivityView.values
                      .asNameMap()[state.uri.queryParameters['view']],
                ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/contacts',
                builder: (_, _) => const ContactsScreen(),
                routes: [
                  GoRoute(
                    path: ':id',
                    builder: (_, state) => ContactDetailScreen(
                      contactId: state.pathParameters['id']!,
                    ),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(path: '/alerts', builder: (_, _) => const AlertsScreen()),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(path: '/more', builder: (_, _) => const MoreScreen()),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/approvals',
                builder: (_, _) => const ApprovalsScreen(),
              ),
            ],
          ),
        ],
      ),
    ],
  );
  ref.onDispose(() {
    // The screen shows this router until the next frame installs its
    // replacement; disposing it any sooner pulls its delegate out from
    // under the Router widget still using it.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      router.dispose();
      refresh.dispose();
    });
  });
  return router;
});
