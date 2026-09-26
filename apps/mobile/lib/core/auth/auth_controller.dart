import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../format/format.dart';
import '../providers.dart';
import 'auth_repository.dart';
import 'google_auth.dart';
import 'models.dart';

/// Where the app is in signing someone in. The router redirects on this.
sealed class AuthState {
  const AuthState();
}

/// Launching: reading the stored session and checking it with the server.
class AuthRestoring extends AuthState {
  const AuthRestoring();
}

/// A stored session exists but could not be checked — offline, or the server
/// is down. Not signed out: the session may be perfectly good.
class AuthRestoreFailed extends AuthState {
  const AuthRestoreFailed(this.message);

  final String message;
}

class AuthSignedOut extends AuthState {
  const AuthSignedOut({this.notice});

  /// Why the user is looking at the sign-in screen, when it was not their
  /// choice (e.g. the session expired).
  final String? notice;
}

class AuthNeedsTwoFactor extends AuthState {
  const AuthNeedsTwoFactor(this.userId);

  final String userId;
}

class AuthSignedIn extends AuthState {
  const AuthSignedIn({
    required this.user,
    required this.workspaces,
    this.workspace,
    this.branch,
  });

  final AuthUser user;
  final List<Workspace> workspaces;

  /// The workspace requests are made for; null until the user picks one.
  final Workspace? workspace;

  /// The branch requests are checked against (`x-store-id`); null when the
  /// member can reach none.
  final Branch? branch;
}

final authControllerProvider = NotifierProvider<AuthController, AuthState>(
  AuthController.new,
);

/// The workspace every screen below the shell works in.
final activeWorkspaceProvider = Provider<Workspace?>((ref) {
  final auth = ref.watch(authControllerProvider);
  return auth is AuthSignedIn ? auth.workspace : null;
});

/// The branch requests are checked against.
final activeBranchProvider = Provider<Branch?>((ref) {
  final auth = ref.watch(authControllerProvider);
  return auth is AuthSignedIn ? auth.branch : null;
});

class AuthController extends Notifier<AuthState> {
  @override
  AuthState build() {
    ref.read(apiClientProvider).onSessionExpired = _sessionExpired;
    Future.microtask(restore);
    return const AuthRestoring();
  }

  AuthRepository get _repo => ref.read(authRepositoryProvider);

  /// Resumes the stored session, if there is one.
  Future<void> restore() async {
    state = const AuthRestoring();
    final store = ref.read(tokenStoreProvider);
    try {
      await store.load();
    } catch (_) {
      // An unreadable keychain entry (Android can lose its key after a
      // restore from backup) is a session that cannot be resumed.
      await store.clearTokens().catchError((_) {});
      state = const AuthSignedOut();
      return;
    }
    if (store.tokens == null) {
      state = const AuthSignedOut();
      return;
    }
    try {
      final (user, workspaces) = await _repo.me();
      await _enter(user, workspaces);
    } on ApiException catch (e) {
      if (e.isUnauthorized) {
        await store.clearTokens();
        state = const AuthSignedOut(notice: ApiException.sessionEndedMessage);
      } else {
        state = AuthRestoreFailed(e.message);
      }
    } catch (_) {
      // Not the API's refusal but an answer this build cannot read; the
      // session itself may be fine, so offer to retry rather than sign out.
      state = const AuthRestoreFailed(
        "ERP71 sent something this version of the app can't read. "
        'Try again, or update the app.',
      );
    }
  }

  /// Runs Google's picker and exchanges its ID token for an ERP71 session.
  /// Completes quietly if the user backs out; throws [GoogleAuthException],
  /// [NoAccountForGoogle] or [ApiException] for the screen to show.
  Future<void> signInWithGoogle() async {
    final config = await _repo.googleConfig();
    if (!config.enabled) {
      throw const GoogleAuthException(
        'Google sign-in is turned off on this ERP71 server.',
      );
    }
    final idToken = await ref
        .read(googleAuthProvider)
        .obtainIdToken(serverClientId: config.clientId!);
    if (idToken == null) return;

    try {
      await _complete(await _repo.signInWithGoogle(idToken));
    } on NoAccountForGoogle {
      // Let them pick a different Google account on the next try.
      await ref.read(googleAuthProvider).signOut();
      rethrow;
    }
  }

  Future<void> verifyTwoFactor(String code) async {
    final current = state;
    if (current is! AuthNeedsTwoFactor) return;
    await _complete(
      await _repo.verifyTwoFactor(userId: current.userId, code: code),
    );
  }

  void cancelTwoFactor() {
    state = const AuthSignedOut();
    unawaited(ref.read(googleAuthProvider).signOut());
  }

  Future<void> selectWorkspace(Workspace workspace) async {
    final current = state;
    if (current is! AuthSignedIn) return;
    await _activate(
      current.user,
      current.workspaces,
      workspace,
      preferredBranchId: ref.read(tokenStoreProvider).storeId,
    );
  }

  Future<void> selectBranch(Branch branch) async {
    final current = state;
    if (current is! AuthSignedIn || current.workspace == null) return;
    await _activate(
      current.user,
      current.workspaces,
      current.workspace,
      preferredBranchId: branch.id,
    );
  }

  /// Re-reads the account, e.g. after an owner granted CRM access on the web.
  Future<void> reloadAccount() async {
    final (user, workspaces) = await _repo.me();
    await _enter(user, workspaces);
  }

  /// Forgets the session on the phone first, so signing out holds whatever
  /// happens next; telling the server and Google is best effort after that.
  Future<void> signOut() async {
    final store = ref.read(tokenStoreProvider);
    final refreshToken = store.tokens?.refreshToken;
    await store.clearTokens();
    setActiveTimeZone(null);
    state = const AuthSignedOut();

    if (refreshToken != null) {
      await _repo
          .endSession(refreshToken)
          .timeout(const Duration(seconds: 5), onTimeout: () {});
    }
    try {
      await ref.read(googleAuthProvider).signOut();
    } catch (_) {
      // The ERP71 session is already gone, which is what signing out is for.
    }
  }

  Future<void> _complete(SignInOutcome outcome) async {
    switch (outcome) {
      case TwoFactorRequired(:final userId):
        state = AuthNeedsTwoFactor(userId);
      case SignedIn(:final tokens, :final user, :final workspaces):
        await ref.read(tokenStoreProvider).saveTokens(tokens);
        await _enter(user, workspaces);
    }
  }

  /// Signs in to the workspace used last time if it is still one of theirs,
  /// the only one if there is just one, and otherwise leaves the choice to
  /// the picker.
  Future<void> _enter(AuthUser user, List<Workspace> workspaces) async {
    final store = ref.read(tokenStoreProvider);
    final current = state;
    final wanted = current is AuthSignedIn && current.workspace != null
        ? current.workspace!.id
        : store.tenantId;

    Workspace? chosen;
    for (final w in workspaces) {
      if (w.id == wanted) chosen = w;
    }
    if (chosen == null && workspaces.length == 1) chosen = workspaces.single;

    await _activate(user, workspaces, chosen, preferredBranchId: store.storeId);
  }

  Future<void> _activate(
    AuthUser user,
    List<Workspace> workspaces,
    Workspace? workspace, {
    String? preferredBranchId,
  }) async {
    final branch = workspace == null
        ? null
        : _branchFor(workspace, preferredBranchId);
    await ref
        .read(tokenStoreProvider)
        .saveContext(tenantId: workspace?.id, storeId: branch?.id);
    setActiveTimeZone(workspace?.timezone);
    state = AuthSignedIn(
      user: user,
      workspaces: workspaces,
      workspace: workspace,
      branch: branch,
    );
  }

  /// The branch chosen before if it is still reachable, otherwise the first
  /// — what the web sends too. The server refuses permission-checked routes
  /// (activities, the overview) to a non-owner with several branches and no
  /// branch named, and checks permissions against the one that is.
  static Branch? _branchFor(Workspace workspace, String? preferredId) {
    if (workspace.branches.isEmpty) return null;
    for (final b in workspace.branches) {
      if (b.id == preferredId) return b;
    }
    return workspace.branches.first;
  }

  void _sessionExpired() {
    if (state is AuthSignedOut) return;
    unawaited(ref.read(tokenStoreProvider).clearTokens());
    setActiveTimeZone(null);
    state = const AuthSignedOut(notice: ApiException.sessionEndedMessage);
  }
}
