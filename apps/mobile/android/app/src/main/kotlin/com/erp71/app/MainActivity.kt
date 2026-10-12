package com.erp71.app

import io.flutter.embedding.android.FlutterFragmentActivity

// A FragmentActivity because the app lock's fingerprint and face prompt
// (local_auth) is a fragment and cannot be shown from a plain FlutterActivity.
class MainActivity : FlutterFragmentActivity()
