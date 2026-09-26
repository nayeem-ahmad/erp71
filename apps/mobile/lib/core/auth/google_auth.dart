import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';

/// A Google sign-in that could not produce an ID token, with a message fit to
/// show the user.
class GoogleAuthException implements Exception {
  const GoogleAuthException(this.message);

  final String message;

  @override
  String toString() => 'GoogleAuthException: $message';
}

/// Gets a Google ID token for the backend to verify. An interface so widget
/// tests can sign in without the platform plugin.
abstract class GoogleAuth {
  /// Shows Google's account picker and returns the ID token, or null when the
  /// user backs out.
  ///
  /// [serverClientId] is the backend's web OAuth client (`GET
  /// /auth/google/config`). Android needs it to issue an ID token at all, and on
  /// both platforms it becomes the token's audience, which is exactly the id
  /// the backend already accepts from the web app — so no backend change is
  /// needed for the phone to sign in.
  Future<String?> obtainIdToken({required String serverClientId});

  /// Forgets the Google account, so the next sign-in offers the picker again
  /// instead of silently reusing the last account.
  Future<void> signOut();
}

class PluginGoogleAuth implements GoogleAuth {
  Future<void>? _initialized;
  String? _initializedFor;

  @override
  Future<String?> obtainIdToken({required String serverClientId}) async {
    final signIn = GoogleSignIn.instance;
    // `initialize` may run exactly once per process.
    _initialized ??= signIn.initialize(serverClientId: serverClientId);
    _initializedFor ??= serverClientId;
    try {
      await _initialized;
    } on GoogleSignInException catch (e) {
      _initialized = null;
      _initializedFor = null;
      throw GoogleAuthException(_describe(e));
    }
    if (_initializedFor != serverClientId) {
      // The server switched OAuth clients while the app was running; the new
      // one takes effect on the next launch.
      debugPrint('Google server client changed; restart the app to use it.');
    }

    if (!signIn.supportsAuthenticate()) {
      throw const GoogleAuthException(
        'Google sign-in is not available on this device.',
      );
    }

    try {
      final account = await signIn.authenticate();
      final idToken = account.authentication.idToken;
      if (idToken == null || idToken.isEmpty) {
        throw const GoogleAuthException(
          'Google did not return a sign-in token. Try again.',
        );
      }
      return idToken;
    } on GoogleSignInException catch (e) {
      if (e.code == GoogleSignInExceptionCode.canceled) return null;
      throw GoogleAuthException(_describe(e));
    }
  }

  @override
  Future<void> signOut() async {
    if (_initialized == null) return;
    try {
      await GoogleSignIn.instance.signOut();
    } on GoogleSignInException {
      // Nothing to forget, or the plugin is unavailable: either way the ERP71
      // session is already gone, which is what signing out is for.
    }
  }

  static String _describe(GoogleSignInException e) {
    // The plugin's descriptions are written for developers; only debug builds
    // show them.
    final detail = kDebugMode && (e.description?.isNotEmpty ?? false)
        ? ' (${e.description})'
        : '';
    // Not exhaustive on purpose: the plugin may add codes without a major
    // version, and those should land in the generic message, not a compile
    // error.
    switch (e.code) {
      case GoogleSignInExceptionCode.clientConfigurationError:
      case GoogleSignInExceptionCode.providerConfigurationError:
        // The OAuth client for this build (package name + signing SHA-1 on
        // Android, bundle id on iOS) is missing from the Google Cloud project.
        return 'Google sign-in is not set up for this version of the app yet.$detail';
      case GoogleSignInExceptionCode.interrupted:
      case GoogleSignInExceptionCode.uiUnavailable:
        return 'Google sign-in was interrupted. Try again.$detail';
      default:
        return 'Google sign-in failed. Try again.$detail';
    }
  }
}
