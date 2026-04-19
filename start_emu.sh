#!/bin/bash
# Replace 'Pixel_6_API_33' with your actual AVD name
EMULATOR_NAME="Medium_Phone_API_36"

echo "🚀 Starting emulator..."
/Users/vali/Library/Android/sdk/emulator/emulator -avd $EMULATOR_NAME -writable-system -no-snapshot-load &

# Wait for device to be ready
adb wait-for-device
echo "✅ Emulator ready."

# Setup the tunnel for the agent to connect to our Go server
echo "🔗 Setting up ADB reverse tunnel on port 5050..."
adb reverse localabstract:screen-sharing-agent tcp:5050