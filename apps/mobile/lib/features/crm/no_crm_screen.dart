import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../ui/widgets.dart';
import '../auth/sign_in_screen.dart' show webAppUrl;

/// The chosen workspace has no CRM: not in its plan, or not activated yet.
class NoCrmScreen extends ConsumerStatefulWidget {
  const NoCrmScreen({super.key});

  @override
  ConsumerState<NoCrmScreen> createState() => _NoCrmScreenState();
}

class _NoCrmScreenState extends ConsumerState<NoCrmScreen> {
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
    if (auth is! AuthSignedIn || auth.workspace == null) {
      return const Scaffold(body: LoadingView());
    }
    final workspace = auth.workspace!;
    final message = workspace.pendingActivation
        ? '${workspace.name} is not activated yet. Once payment is complete '
              'on the web, the CRM opens here.'
        : "The CRM isn't part of ${workspace.name}'s plan. The owner can add "
              'it from Billing on the web.';

    return Scaffold(
      appBar: AppBar(
        title: Text(workspace.name),
        actions: [
          IconButton(
            tooltip: 'Account',
            icon: const Icon(Icons.account_circle_outlined),
            onPressed: () => context.push('/account'),
          ),
        ],
      ),
      body: EmptyView(
        icon: Icons.lock_outline,
        title: 'CRM is not available here',
        message: message,
        action: Column(
          children: [
            FilledButton(
              onPressed: () =>
                  launchUrl(webAppUrl, mode: LaunchMode.externalApplication),
              child: const Text('Open app.erp71.com'),
            ),
            const SizedBox(height: 8),
            if (auth.workspaces.length > 1) ...[
              OutlinedButton(
                onPressed: () => context.push('/workspaces'),
                child: const Text('Switch workspace'),
              ),
              const SizedBox(height: 8),
            ],
            TextButton(
              onPressed: _checking ? null : _checkAgain,
              child: const Text('Check again'),
            ),
          ],
        ),
      ),
    );
  }
}
