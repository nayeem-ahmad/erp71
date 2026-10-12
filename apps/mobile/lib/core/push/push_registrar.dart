import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../auth/auth_controller.dart';
import '../providers.dart';
import 'push_channel.dart';

/// Where this phone stands on notifications, for the account screen to say.
enum PushStatus {
  /// Not tried yet, or nobody is signed in.
  idle,

  /// The server has no push set up, or not for this platform.
  unavailable,

  /// The person declined the system permission.
  declined,

  /// This phone receives notifications.
  registered,

  /// Registering failed; it is tried again at the next sign-in or launch.
  failed,
}

/// Registers this phone for notifications whenever someone is signed in, and
/// hands on the notifications the person taps.
///
/// The server ties the phone to the sign-in session it registered under and
/// stops pushing the moment that session ends, so signing out needs nothing
/// from here beyond a best-effort [unregister] to go quiet at once.
final pushRegistrarProvider = NotifierProvider<PushRegistrar, PushStatus>(
  PushRegistrar.new,
);

class PushRegistrar extends Notifier<PushStatus> {
  final List<StreamSubscription<Object?>> _subscriptions = [];
  final StreamController<PushTap> _taps = StreamController.broadcast();
  final StreamController<PushTap> _arrivals = StreamController.broadcast();

  /// Notifications the person tapped, while the app was alive or to launch it.
  Stream<PushTap> get taps => _taps.stream;

  /// Notifications that arrived with the app open.
  Stream<PushTap> get arrivals => _arrivals.stream;

  @override
  PushStatus build() {
    ref.onDispose(() {
      for (final sub in _subscriptions) {
        sub.cancel();
      }
      _taps.close();
      _arrivals.close();
    });
    ref.listen(authControllerProvider, (previous, next) {
      final wasIn = previous is AuthSignedIn;
      if (next is AuthSignedIn && !wasIn) unawaited(_register());
      if (next is! AuthSignedIn && wasIn) state = PushStatus.idle;
    }, fireImmediately: true);
    return PushStatus.idle;
  }

  Future<void> _register() async {
    final api = ref.read(apiClientProvider);
    final channel = ref.read(pushChannelProvider);
    try {
      final config = PushConfig.fromJson(
        await api.get('/push/config') as Map<String, dynamic>,
      );
      if (!config.enabled || config.appIdFor(defaultTargetPlatform) == null) {
        if (ref.mounted) state = PushStatus.unavailable;
        return;
      }
      final token = await channel.start(config);
      if (!ref.mounted) return;
      if (token == null) {
        state = PushStatus.declined;
        return;
      }
      await _send(token);
      if (!ref.mounted) return;
      state = PushStatus.registered;

      if (_subscriptions.isEmpty) {
        _subscriptions
          ..add(channel.tokenRefreshes.listen((t) => unawaited(_send(t))))
          ..add(channel.taps.listen(_taps.add))
          ..add(channel.arrivals.listen(_arrivals.add));
        // The tap that launched the app: whoever routes taps is listening by
        // now, since registering waits for a signed-in workspace.
        final launch = await channel.launchTap();
        if (launch != null) _taps.add(launch);
      }
    } catch (_) {
      // Notifications are an extra. A failure here must never stand in the
      // way of the app; the next sign-in or launch tries again.
      if (ref.mounted) state = PushStatus.failed;
    }
  }

  Future<void> _send(String token) async {
    final refreshToken = ref.read(tokenStoreProvider).tokens?.refreshToken;
    if (refreshToken == null) return;
    ref.read(pushTokenProvider).token = token;
    await ref
        .read(apiClientProvider)
        .post(
          '/push/devices',
          body: {
            'token': token,
            'platform': defaultTargetPlatform == TargetPlatform.iOS
                ? 'ios'
                : 'android',
            'refresh_token': refreshToken,
          },
        );
  }
}

/// This phone's current push token, once registered. Its own provider,
/// depending on nothing, so signing out can read it without depending on the
/// registrar, which itself follows the signed-in state.
class PushToken {
  String? token;

  /// Best effort, before signing out: the server would stop pushing once the
  /// session ends anyway, but an offline sign-out might not reach it.
  Future<void> unregister(ApiClient api) async {
    final current = token;
    if (current == null) return;
    token = null;
    try {
      await api
          .post('/push/devices/unregister', body: {'token': current})
          .timeout(const Duration(seconds: 3));
    } catch (_) {
      // Signing out goes ahead regardless.
    }
  }
}

final pushTokenProvider = Provider<PushToken>((ref) => PushToken());
