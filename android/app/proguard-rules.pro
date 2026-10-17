# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# Nitro Modules & JNI
-keep class com.margelo.nitro.** { *; }
-keepclassmembers class com.margelo.nitro.** { *; }

# Google ML Kit Face Detection
-keep class com.google.mlkit.vision.** { *; }
-keep class com.google.android.gms.vision.** { *; }

# TensorFlow Lite / LiteRT
-keep class org.tensorflow.lite.** { *; }
-keep class com.google.ai.edge.litert.** { *; }
