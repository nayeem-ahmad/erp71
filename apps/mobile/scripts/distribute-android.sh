#!/usr/bin/env bash
# Builds a release APK and sends it to testers through Firebase App Distribution.
#
#   scripts/distribute-android.sh [group-alias] ["release notes"]
#
# Defaults: the `pilot` group, and the last commit's subject as the notes.
# Needs android/key.properties (the upload key — see README › Distributing to
# testers) and `firebase login` as an account with access to erp71-709cf.
set -euo pipefail
cd "$(dirname "$0")/.."

APP_ID="1:31523003932:android:c94a1a719dab04d3dd09d9"
PROJECT="erp71-709cf"
GROUP="${1:-pilot}"
NOTES="${2:-$(git log -1 --format='%h %s')}"
# CI pins 3.47.5; the Homebrew flutter on PATH is too old for this app.
FLUTTER="${FLUTTER:-$HOME/fvm/versions/3.47.5/bin/flutter}"

if [ ! -f android/key.properties ]; then
    echo "android/key.properties is missing, so this build would be signed with the debug key." >&2
    echo "Testers could not update from it to a properly signed build. See README › Distributing to testers." >&2
    exit 1
fi

# The commit count only grows on dev/main, so every upload is a newer versionCode
# and testers' phones offer it as an update without anyone bumping pubspec.yaml.
BUILD_NUMBER="$(git rev-list --count HEAD)"

"$FLUTTER" build apk --release --build-number="$BUILD_NUMBER"

firebase appdistribution:distribute build/app/outputs/flutter-apk/app-release.apk \
    --app "$APP_ID" \
    --project "$PROJECT" \
    --groups "$GROUP" \
    --release-notes "$NOTES"
