#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$ROOT_DIR/third_party/screen_sharing_service"
APP_DIR="$PROJECT_DIR/app"
LIB_ROOT="$APP_DIR/build/intermediates/merged_native_libs/debug/mergeDebugNativeLibs/out/lib"
JAR_PATH="$APP_DIR/build/agent/screen-sharing-agent.jar"

command -v adb >/dev/null 2>&1 || { echo "adb is required on PATH." >&2; exit 1; }
bash "$ROOT_DIR/package-jar.sh"

ABI="$(adb shell getprop ro.product.cpu.abi | tr -d '\r')"
case "$ABI" in
  arm64-v8a|armeabi-v7a|x86|x86_64) ;;
  *) echo "Unsupported Android ABI: $ABI" >&2; exit 1 ;;
esac
SO_PATH="$LIB_ROOT/$ABI/libscreen-sharing-agent.so"

adb reverse localabstract:screen-sharing-agent tcp:5050
adb shell 'mkdir -p /data/local/tmp/.studio'
adb push "$JAR_PATH" /data/local/tmp/screen-sharing-agent.jar
adb push "$SO_PATH" /data/local/tmp/.studio/libscreen-sharing-agent.so
adb shell "LD_LIBRARY_PATH=/data/local/tmp/.studio CLASSPATH=/data/local/tmp/screen-sharing-agent.jar app_process /data/local/tmp com.android.tools.screensharing.Main --socket=screen-sharing-agent --flags=5 --max_bit_rate=10000000 --codec=avc"