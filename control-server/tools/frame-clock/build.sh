#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
tools="$sdk/build-tools/${ANDROID_BUILD_TOOLS:-36.0.0}"
android="$sdk/platforms/${ANDROID_PLATFORM:-android-36}/android.jar"
output="${1:-/tmp/valdroid-frame-clock.apk}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/classes" "$work/dex" "$work/res"
javac --release 8 -classpath "$android" -d "$work/classes" "$root/FrameClock.java"
"$tools/d8" --lib "$android" --min-api 26 --output "$work/dex" "$work"/classes/dev/valdroid/frameclock/*.class
"$tools/aapt" package -f -M "$root/AndroidManifest.xml" -S "$work/res" -I "$android" -F "$work/unsigned.apk"
(cd "$work/dex" && "$tools/aapt" add "$work/unsigned.apk" classes.dex)
"$tools/zipalign" -f 4 "$work/unsigned.apk" "$work/aligned.apk"
keytool -genkeypair -noprompt -keystore "$work/test.jks" -storepass android -keypass android \
    -alias test -dname 'CN=Valdroid Benchmark' -keyalg RSA -validity 2 >/dev/null 2>&1
"$tools/apksigner" sign --ks "$work/test.jks" --ks-pass pass:android --out "$output" "$work/aligned.apk"
printf 'Built %s\n' "$output"
