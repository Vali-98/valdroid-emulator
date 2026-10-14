#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$ROOT_DIR/third_party/screen_sharing_service"
APP_DIR="$PROJECT_DIR/app"
APK_PATH="$APP_DIR/build/outputs/apk/debug/app-debug.apk"
OUTPUT_DIR="$APP_DIR/build/agent"
JAR_PATH="$OUTPUT_DIR/screen-sharing-agent.jar"

(cd "$PROJECT_DIR" && bash ./gradlew :app:assembleDebug)

if [[ ! -f "$APK_PATH" ]]; then
  echo "Gradle APK was not created: $APK_PATH" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
cp "$APK_PATH" "$JAR_PATH"
echo "Packaged app_process classpath archive: $JAR_PATH"