import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Whether the phone has a network. Save on a draft reads this and never
/// queues: offline leaves the card on screen and turns Save off.
abstract class OnlineStatus {
  bool get online;

  Stream<bool> watch();
}

class DeviceOnlineStatus implements OnlineStatus {
  DeviceOnlineStatus({Connectivity? connectivity})
    : _connectivity = connectivity ?? Connectivity();

  final Connectivity _connectivity;
  bool _online = true;

  @override
  bool get online => _online;

  static bool _up(List<ConnectivityResult> results) =>
      results.any((result) => result != ConnectivityResult.none);

  @override
  Stream<bool> watch() async* {
    try {
      _online = _up(await _connectivity.checkConnectivity());
    } catch (_) {
      _online = false;
    }
    yield _online;
    await for (final results in _connectivity.onConnectivityChanged) {
      _online = _up(results);
      yield _online;
    }
  }
}

final onlineStatusProvider = Provider<OnlineStatus>(
  (ref) => DeviceOnlineStatus(),
);

/// The latest answer from [onlineStatusProvider]. Starts from the current
/// value so the first frame is not a guess after the check has already run.
final onlineProvider = NotifierProvider<OnlineController, bool>(
  OnlineController.new,
);

class OnlineController extends Notifier<bool> {
  @override
  bool build() {
    final status = ref.watch(onlineStatusProvider);
    final subscription = status.watch().listen(
      (value) {
        if (state != value) state = value;
      },
      onError: (_, _) {
        if (state) state = false;
      },
    );
    ref.onDispose(subscription.cancel);
    return status.online;
  }
}
