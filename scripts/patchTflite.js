const fs = require('fs');
const path = require('path');

const loaderPath = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-fast-tflite',
  'android',
  'src',
  'main',
  'java',
  'com',
  'margelo',
  'nitro',
  'tflite',
  'HybridAssetLoader.kt',
);

if (fs.existsSync(loaderPath)) {
  const currentContent = fs.readFileSync(loaderPath, 'utf8');
  if (!currentContent.includes('openRawResource')) {
    const fixedContent = `package com.margelo.nitro.tflite

import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import java.io.File
import java.net.URL

@Keep
@DoNotStrip
class HybridAssetLoader : HybridAssetLoaderSpec() {
  override fun loadAsset(path: String): Promise<ArrayBuffer> {
    return Promise.async {
      val context = NitroModules.applicationContext

      // 1. Check if path is http/https URL (Metro / remote)
      if (path.startsWith("http://") || path.startsWith("https://")) {
        val bytes = URL(path).readBytes()
        return@async ArrayBuffer.copy(bytes)
      }

      // 2. Check if path is a file URI or absolute path
      if (path.startsWith("file://")) {
        val file = File(path.removePrefix("file://"))
        if (file.exists()) {
          val bytes = file.readBytes()
          return@async ArrayBuffer.copy(bytes)
        }
      }
      if (path.startsWith("/")) {
        val file = File(path)
        if (file.exists()) {
          val bytes = file.readBytes()
          return@async ArrayBuffer.copy(bytes)
        }
      }

      // 3. Try Android raw resource (bundled require in release APK)
      if (context != null) {
        val cleanResName = path.substringBeforeLast('.').lowercase()
        val resId = context.resources.getIdentifier(cleanResName, "raw", context.packageName)
        if (resId != 0) {
          val bytes = context.resources.openRawResource(resId).use { it.readBytes() }
          return@async ArrayBuffer.copy(bytes)
        }

        // 4. Try Android assets folder
        try {
          val assetPath = if (path.startsWith("assets/")) path.removePrefix("assets/") else path
          val bytes = context.assets.open(assetPath).use { it.readBytes() }
          return@async ArrayBuffer.copy(bytes)
        } catch (_: Throwable) {
          // Continue to fallback
        }
      }

      // 5. Default fallback URL loader
      val bytes = URL(path).readBytes()
      return@async ArrayBuffer.copy(bytes)
    }
  }
}
`;
    fs.writeFileSync(loaderPath, fixedContent, 'utf8');
    console.log('[patchTflite] Successfully patched HybridAssetLoader.kt to support Android release bundle raw resources.');
  } else {
    console.log('[patchTflite] HybridAssetLoader.kt already patched.');
  }
} else {
  console.warn('[patchTflite] HybridAssetLoader.kt not found.');
}
