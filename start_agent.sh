#!/bin/bash
JAR_PATH="./screen-sharing-agent.jar"
SO_PATH="./libscreen-sharing-agent.so"

echo "📂 Pushing agent files to device..."
#adb push $JAR_PATH /data/local/tmp/
#adb push $SO_PATH /data/local/tmp/

echo "🎬 Launching agent..."
# Using --codec=avc (H.264) for broad compatibility
adb shell "LD_LIBRARY_PATH=/data/local/tmp \
CLASSPATH=/data/local/tmp/screen-sharing-agent.jar \
app_process /data/local/tmp com.android.tools.screensharing.Main \
--socket=screen-sharing-agent \
--flags=1 \
--max_bit_rate=30000 \
--codec=avc"