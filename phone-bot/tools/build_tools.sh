#!/bin/bash
# Build tools/MotionLogger.java into a DEX JAR for Android app_process.
#
# Prerequisites:
#   - JDK 8+ installed (javac in PATH)
#   - Android SDK with d8 tool ($ANDROID_HOME/build-tools/*/d8)
#   - android.jar from SDK ($ANDROID_HOME/platforms/android-29/android.jar)
#
# Output: motionlogger.jar (contains classes.dex, ready for app_process)
#
# Deploy and run on phone:
#   adb push motionlogger.jar /data/local/tmp/
#   adb shell "CLASSPATH=/data/local/tmp/motionlogger.jar app_process / com.phonebot.MotionLogger"
#
# Stop:
#   adb shell pkill -f MotionLogger

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ---- Android SDK detection ------------------------------------------------

if [ -z "$ANDROID_HOME" ]; then
    if [ -d "$HOME/Android/Sdk" ]; then
        ANDROID_HOME="$HOME/Android/Sdk"
    elif [ -d "$HOME/Library/Android/sdk" ]; then
        ANDROID_HOME="$HOME/Library/Android/sdk"
    elif [ -d "/opt/android-sdk" ]; then
        ANDROID_HOME="/opt/android-sdk"
    else
        echo "ERROR: ANDROID_HOME not set and SDK not found in common locations."
        echo "       Set ANDROID_HOME to your Android SDK directory."
        exit 1
    fi
fi
echo "Android SDK: $ANDROID_HOME"

# Prefer API 29 (Android 10) for widest compatibility; fall back to higher APIs.
ANDROID_JAR=""
for api in 29 30 31 32 33 34; do
    candidate="$ANDROID_HOME/platforms/android-$api/android.jar"
    if [ -f "$candidate" ]; then
        ANDROID_JAR="$candidate"
        echo "android.jar: $ANDROID_JAR (API $api)"
        break
    fi
done
if [ -z "$ANDROID_JAR" ]; then
    echo "ERROR: android.jar not found in $ANDROID_HOME/platforms/"
    echo "       Install an Android platform via SDK Manager."
    exit 1
fi

# Find d8 (DEX compiler), prefer newest build-tools version.
D8=""
for dir in $(ls -d "$ANDROID_HOME/build-tools/"* 2>/dev/null | sort -V -r); do
    if [ -f "$dir/d8" ] || [ -f "$dir/d8.bat" ]; then
        D8="$dir/d8"
        break
    fi
done
if [ -z "$D8" ]; then
    echo "ERROR: d8 not found in $ANDROID_HOME/build-tools/"
    echo "       Install build-tools via SDK Manager."
    exit 1
fi
echo "d8: $D8"

# ---- Build ----------------------------------------------------------------

echo ""
echo "Cleaning previous build..."
rm -rf com/ classes.dex motionlogger.jar

echo "Compiling MotionLogger.java -> .class files..."
javac -source 8 -target 8 \
    -bootclasspath "$ANDROID_JAR" \
    -d . \
    MotionLogger.java

echo "DEXing .class -> classes.dex..."
"$D8" com/phonebot/MotionLogger.class \
    --min-api 21 \
    --output .

echo "Packaging -> motionlogger.jar..."
jar cf motionlogger.jar classes.dex

echo "Cleaning build intermediates..."
rm -rf com/ classes.dex

echo ""
echo "Build complete: $(pwd)/motionlogger.jar"
echo ""
echo "Deploy:"
echo "  adb push motionlogger.jar /data/local/tmp/"
echo "  adb shell \"CLASSPATH=/data/local/tmp/motionlogger.jar app_process / com.phonebot.MotionLogger\""
