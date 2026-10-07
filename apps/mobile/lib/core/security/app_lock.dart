import 'package:flutter/services.dart' show PlatformException;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:local_auth/local_auth.dart';

import '../auth/auth_controller.dart';
import '../providers.dart';

/// The outcome of asking the phone who is holding it.
enum DeviceAuthResult {
  /// The person passed the fingerprint, face or screen-lock check.
  passed,

  /// They cancelled or failed it. Ask again later.
  failed,

  /// The phone has nothing to check against any more — no screen lock, or
  /// no biometric hardware and no PIN. Holding the app locked would lock its
  /// owner out for good, and a phone with no lock protects nothing anyway.
  unavailable,
}

/// The phone's own lock: fingerprint or face, falling back to its PIN,
/// pattern or passcode. An interface so tests need no platform plugin.
abstract class DeviceAuthenticator {
  /// Whether the phone has any screen lock to check against.
  Future<bool> isAvailable();

  Future<DeviceAuthResult> authenticate(String reason);
}

class LocalAuthAuthenticator implements DeviceAuthenticator {
  final LocalAuthentication _auth = LocalAuthentication();

  @override
  Future<bool> isAvailable() async {
    try {
      return await _auth.isDeviceSupported();
    } on PlatformException {
      return false;
    }
  }

  @override
  Future<DeviceAuthResult> authenticate(String reason) async {
    try {
      final passed = await _auth.authenticate(
        localizedReason: reason,
        // A phone call mid-prompt retries on return instead of failing.
        persistAcrossBackgrounding: true,
      );
      return passed ? DeviceAuthResult.passed : DeviceAuthResult.failed;
    } on LocalAuthException catch (e) {
      return switch (e.code) {
        LocalAuthExceptionCode.noCredentialsSet ||
        LocalAuthExceptionCode.noBiometricHardware =>
          DeviceAuthResult.unavailable,
        _ => DeviceAuthResult.failed,
      };
    } on PlatformException {
      return DeviceAuthResult.failed;
    }
  }
}

final deviceAuthenticatorProvider = Provider<DeviceAuthenticator>(
  (ref) => LocalAuthAuthenticator(),
);

class AppLockState {
  const AppLockState({
    this.loaded = false,
    this.enabled = false,
    this.locked = false,
  });

  /// The saved setting has been read. Until then nobody can say whether the
  /// app should be covered, so it is.
  final bool loaded;

  final bool enabled;

  /// Covered, waiting for the person to prove they are the phone's owner.
  final bool locked;

  AppLockState copyWith({bool? loaded, bool? enabled, bool? locked}) =>
      AppLockState(
        loaded: loaded ?? this.loaded,
        enabled: enabled ?? this.enabled,
        locked: locked ?? this.locked,
      );
}

/// What turning the lock on came to, for the settings screen to say.
enum AppLockEnableResult { enabled, cancelled, noScreenLock }

/// An optional lock over the whole app: on at launch, and again whenever the
/// app comes back after [gracePeriod] out of sight. Shop figures and the
/// approval actions to come are not for whoever picks up an unlocked phone.
///
/// Off by default and per phone: it is a property of the device, kept in
/// secure storage next to the session, not an account setting.
final appLockProvider = NotifierProvider<AppLockController, AppLockState>(
  AppLockController.new,
);

class AppLockController extends Notifier<AppLockState> {
  static const storageKey = 'erp71.app-lock.v1';

  /// Long enough that switching to the calculator and back does not ask
  /// again; short enough that a phone left on the counter does.
  static const gracePeriod = Duration(minutes: 5);

  DateTime? _hiddenAt;

  @override
  AppLockState build() {
    // Signing out from the lock screen must not leave the next sign-in
    // facing a lock it never set off.
    ref.listen(authControllerProvider, (_, next) {
      if (next is AuthSignedOut && state.locked) {
        state = state.copyWith(locked: false);
      }
    });
    _load();
    return const AppLockState();
  }

  Future<void> _load() async {
    final saved = await ref.read(keyValueStoreProvider).read(storageKey);
    if (!ref.mounted) return;
    final enabled = saved == '1';
    // A cold start counts as coming back after any length of time — unless
    // the stored session has already turned out to be over, in which case
    // the next thing to happen is a fresh sign-in, which proves enough.
    final signedOut = ref.read(authControllerProvider) is AuthSignedOut;
    state = AppLockState(
      loaded: true,
      enabled: enabled,
      locked: enabled && !signedOut,
    );
  }

  /// Asks for the phone's lock once before turning it on, so nobody can set
  /// a lock they cannot open.
  Future<AppLockEnableResult> enable() async {
    final authenticator = ref.read(deviceAuthenticatorProvider);
    if (!await authenticator.isAvailable()) {
      return AppLockEnableResult.noScreenLock;
    }
    final result = await authenticator.authenticate(
      'Confirm it is you to turn on App lock',
    );
    switch (result) {
      case DeviceAuthResult.unavailable:
        return AppLockEnableResult.noScreenLock;
      case DeviceAuthResult.failed:
        return AppLockEnableResult.cancelled;
      case DeviceAuthResult.passed:
        await ref.read(keyValueStoreProvider).write(storageKey, '1');
        state = state.copyWith(enabled: true, locked: false);
        return AppLockEnableResult.enabled;
    }
  }

  Future<void> disable() async {
    await ref.read(keyValueStoreProvider).delete(storageKey);
    state = state.copyWith(enabled: false, locked: false);
  }

  /// The app went out of sight: another app, the home screen, the phone
  /// locking. Not the fingerprint prompt itself, which only makes it inactive.
  void hidden({DateTime? now}) => _hiddenAt = now ?? DateTime.now();

  void shown({DateTime? now}) {
    final hiddenAt = _hiddenAt;
    _hiddenAt = null;
    if (!state.enabled || hiddenAt == null) return;
    if ((now ?? DateTime.now()).difference(hiddenAt) >= gracePeriod) {
      state = state.copyWith(locked: true);
    }
  }

  /// Shows the phone's prompt. Returns whether the app is now open.
  Future<bool> unlock() async {
    final result = await ref
        .read(deviceAuthenticatorProvider)
        .authenticate('Unlock ERP71');
    switch (result) {
      case DeviceAuthResult.passed:
        state = state.copyWith(locked: false);
        return true;
      case DeviceAuthResult.unavailable:
        // The owner removed the phone's screen lock after turning this on.
        await disable();
        return true;
      case DeviceAuthResult.failed:
        return false;
    }
  }
}
