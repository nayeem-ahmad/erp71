import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/router.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/push/push_channel.dart';
import '../../core/push/push_registrar.dart';
import '../../ui/widgets.dart';
import 'alerts_data.dart';

/// Turns a tapped notification into the screen it is about: into its
/// workspace first if it belongs to another one, then to the matching phone
/// screen (the Alerts list when there is none), marking it read on the way.
/// A notification arriving with the app open is shown as a toast and bumps
/// the Alerts badge.
class PushTapHandler extends ConsumerStatefulWidget {
  const PushTapHandler({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<PushTapHandler> createState() => _PushTapHandlerState();
}

class _PushTapHandlerState extends ConsumerState<PushTapHandler> {
  final List<StreamSubscription<PushTap>> _subscriptions = [];

  @override
  void initState() {
    super.initState();
    final registrar = ref.read(pushRegistrarProvider.notifier);
    _subscriptions
      ..add(registrar.taps.listen(_open))
      ..add(registrar.arrivals.listen(_arrived));
  }

  @override
  void dispose() {
    for (final sub in _subscriptions) {
      sub.cancel();
    }
    super.dispose();
  }

  void _arrived(PushTap tap) {
    ref.invalidate(unreadAlertsProvider);
    final title = tap.title;
    if (title != null && title.isNotEmpty) showToast(title);
  }

  Future<void> _open(PushTap tap) async {
    final auth = ref.read(authControllerProvider);
    if (auth is! AuthSignedIn) return;

    final tenantId = tap.tenantId;
    if (tenantId != null && auth.workspace?.id != tenantId) {
      final target = auth.workspaces.where((w) => w.id == tenantId);
      // A workspace this person has left: nothing of theirs to open.
      if (target.isEmpty) return;
      await ref
          .read(authControllerProvider.notifier)
          .selectWorkspace(target.first);
      // Switching workspace rebuilds the router; route with the new one.
      await SchedulerBinding.instance.endOfFrame;
    }

    final id = tap.notificationId;
    if (id != null) {
      unawaited(
        ref
            .read(alertsRepositoryProvider)
            .markRead(id)
            .then((_) => ref.invalidate(unreadAlertsProvider))
            .catchError((_) {}),
      );
    }
    if (!mounted) return;
    ref
        .read(routerProvider)
        .go(mobileRouteForAlert(tap.data['type'], tap.link) ?? '/alerts');
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
