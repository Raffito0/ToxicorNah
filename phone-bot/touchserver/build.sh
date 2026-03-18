#!/bin/bash
# Build touchserver JAR with DEX for Android app_process
#
# Prerequisites:
#   - JDK 8+ installed (javac)
#   - Android SDK with d8 tool ($ANDROID_HOME/build-tools/*/d8)
#   - android.jar from SDK ($ANDROID_HOME/platforms/android-29/android.jar)
#
# Output: touchserver.jar (contains classes.dex)
#
# Deploy:
#   adb push touchserver.jar /data/local/tmp/
#   adb shell "CLASSPATH=/data/local/tmp/touchserver.jar app_process / touchserver.TouchServer 1080 2220 &"

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Find Android SDK
if [ -z "$ANDROID_HOME" ]; then
    if [ -d "$HOME/Android/Sdk" ]; then
        ANDROID_HOME="$HOME/Android/Sdk"
    elif [ -d "$HOME/Library/Android/sdk" ]; then
        ANDROID_HOME="$HOME/Library/Android/sdk"
    else
        echo "ERROR: ANDROID_HOME not set and SDK not found"
        exit 1
    fi
fi

# Find android.jar (prefer API 29 for Android 10 compat)
ANDROID_JAR=""
for api in 29 30 31 32 33 34; do
    if [ -f "$ANDROID_HOME/platforms/android-$api/android.jar" ]; then
        ANDROID_JAR="$ANDROID_HOME/platforms/android-$api/android.jar"
        break
    fi
done
if [ -z "$ANDROID_JAR" ]; then
    echo "ERROR: android.jar not found in $ANDROID_HOME/platforms/"
    exit 1
fi
echo "Using android.jar: $ANDROID_JAR"

# Find d8
D8=""
for dir in $(ls -d "$ANDROID_HOME/build-tools/"* 2>/dev/null | sort -V -r); do
    if [ -f "$dir/d8" ] || [ -f "$dir/d8.bat" ]; then
        D8="$dir/d8"
        break
    fi
done
if [ -z "$D8" ]; then
    echo "ERROR: d8 not found in $ANDROID_HOME/build-tools/"
    exit 1
fi
echo "Using d8: $D8"

# Clean
rm -f *.class classes.dex touchserver.jar

# Compile Java -> class files (Java 8 target for max Android compat)
echo "Compiling..."
javac -source 8 -target 8 \
    -bootclasspath "$ANDROID_JAR" \
    -d . \
    HidDescriptor.java TouchPhysics.java TouchServer.java

# DEX: class -> dex
echo "DEXing..."
"$D8" touchserver/HidDescriptor.class touchserver/TouchPhysics.class \
    touchserver/TouchPhysics\$TouchReport.class touchserver/TouchServer.class \
    --output .

# Package into JAR
echo "Packaging..."
jar cf touchserver.jar classes.dex

# Clean intermediates
rm -rf touchserver/*.class classes.dex

echo "Build complete: touchserver.jar"
echo ""
echo "Deploy:"
echo "  adb push touchserver.jar /data/local/tmp/"
echo "  adb shell \"CLASSPATH=/data/local/tmp/touchserver.jar app_process / touchserver.TouchServer 1080 2220 &\""
