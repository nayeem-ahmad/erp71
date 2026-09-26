import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/models.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../auth/sign_in_screen.dart' show webAppUrl;

/// Picks the shop to work in. Shown after sign-in when there is more than one
/// and none was used before, and from the account screen to switch.
class WorkspacePickerScreen extends ConsumerWidget {
  const WorkspacePickerScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    if (auth is! AuthSignedIn) return const Scaffold(body: LoadingView());
    final current = auth.workspace;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Choose a workspace'),
        automaticallyImplyLeading: current != null,
      ),
      body: ListView.separated(
        padding: const EdgeInsets.all(12),
        itemCount: auth.workspaces.length,
        separatorBuilder: (_, _) => const SizedBox(height: 8),
        itemBuilder: (context, index) {
          final workspace = auth.workspaces[index];
          final selected = workspace.id == current?.id;
          return Card(
            child: ListTile(
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(AppRadius.card),
              ),
              leading: InitialsAvatar(initialsOf(workspace.name)),
              title: Text(workspace.name),
              subtitle: Text(workspace.roleLabel),
              trailing: selected
                  ? const Icon(Icons.check_circle, color: AppColors.primary)
                  : const Icon(Icons.chevron_right),
              onTap: () {
                if (selected) {
                  if (context.canPop()) context.pop();
                  return;
                }
                // A different shop rebuilds the router, which starts afresh
                // on its overview; there is nothing here to pop.
                ref
                    .read(authControllerProvider.notifier)
                    .selectWorkspace(workspace);
              },
            ),
          );
        },
      ),
    );
  }
}

/// Signed in, but a member of no workspace: they signed up without creating
/// one, or every shop they belonged to removed them.
class NoWorkspaceScreen extends ConsumerStatefulWidget {
  const NoWorkspaceScreen({super.key});

  @override
  ConsumerState<NoWorkspaceScreen> createState() => _NoWorkspaceScreenState();
}

class _NoWorkspaceScreenState extends ConsumerState<NoWorkspaceScreen> {
  bool _checking = false;

  Future<void> _checkAgain() async {
    setState(() => _checking = true);
    try {
      await ref.read(authControllerProvider.notifier).reloadAccount();
    } on ApiException catch (e) {
      showToast(e.message, tone: Tone.danger);
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);
    final email = auth is AuthSignedIn ? auth.user.email : '';
    return Scaffold(
      appBar: AppBar(title: const Text('No workspace yet')),
      body: EmptyView(
        icon: Icons.storefront_outlined,
        title: "You're not in any workspace yet",
        message:
            '$email is signed in, but no shop has added it. Create your workspace '
            'at app.erp71.com, or ask your shop owner to invite this address.',
        action: Column(
          children: [
            FilledButton(
              onPressed: () =>
                  launchUrl(webAppUrl, mode: LaunchMode.externalApplication),
              child: const Text('Open app.erp71.com'),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: _checking ? null : _checkAgain,
              child: const Text('Check again'),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () =>
                  ref.read(authControllerProvider.notifier).signOut(),
              child: const Text('Sign out'),
            ),
          ],
        ),
      ),
    );
  }
}

/// The signed-in person, the workspace, and signing out.
class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  /// Staff can be granted different permissions in each branch, and the
  /// server checks the one named on the request.
  Future<void> _pickBranch(
    BuildContext context,
    WidgetRef ref,
    Workspace workspace,
    Branch current,
  ) => showAppSheet<void>(
    context: context,
    title: 'Branch',
    builder: (sheetContext) => Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final branch in workspace.branches)
          ListTile(
            contentPadding: EdgeInsets.zero,
            tileColor: Colors.transparent,
            title: Text(branch.name),
            trailing: branch.id == current.id
                ? const Icon(Icons.check_circle, color: AppColors.primary)
                : null,
            onTap: () {
              Navigator.of(sheetContext).pop();
              ref.read(authControllerProvider.notifier).selectBranch(branch);
            },
          ),
      ],
    ),
  );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    if (auth is! AuthSignedIn) return const Scaffold(body: LoadingView());
    final Workspace? workspace = auth.workspace;

    return Scaffold(
      appBar: AppBar(title: const Text('Account')),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          SectionCard(
            child: Row(
              children: [
                InitialsAvatar(auth.user.initials, size: 48),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        auth.user.displayName,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        auth.user.email,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          if (workspace != null)
            SectionCard(
              title: 'Workspace',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  InfoRow(label: 'Name', value: workspace.name),
                  InfoRow(label: 'Your role', value: workspace.roleLabel),
                  if (auth.branch != null)
                    InfoRow(
                      label: 'Branch',
                      value: auth.branch!.name,
                      icon: workspace.branches.length > 1
                          ? Icons.unfold_more
                          : null,
                      onTap: workspace.branches.length > 1
                          ? () => _pickBranch(
                              context,
                              ref,
                              workspace,
                              auth.branch!,
                            )
                          : null,
                    ),
                  if (workspace.timezone != null)
                    InfoRow(label: 'Time zone', value: workspace.timezone!),
                  if (auth.workspaces.length > 1) ...[
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: () => context.push('/workspaces'),
                      icon: const Icon(Icons.swap_horiz, size: 18),
                      label: const Text('Switch workspace'),
                    ),
                  ],
                ],
              ),
            ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(foregroundColor: AppColors.danger),
            onPressed: () async {
              final confirmed = await showDialog<bool>(
                context: context,
                builder: (context) => AlertDialog(
                  title: const Text('Sign out?'),
                  content: const Text(
                    'You will need your Google account to sign back in. '
                    'Your other devices stay signed in.',
                  ),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(context, false),
                      child: const Text('Cancel'),
                    ),
                    TextButton(
                      style: TextButton.styleFrom(
                        foregroundColor: AppColors.danger,
                      ),
                      onPressed: () => Navigator.pop(context, true),
                      child: const Text('Sign out'),
                    ),
                  ],
                ),
              );
              if (confirmed == true) {
                await ref.read(authControllerProvider.notifier).signOut();
              }
            },
            icon: const Icon(Icons.logout, size: 18),
            label: const Text('Sign out'),
          ),
        ],
      ),
    );
  }
}
