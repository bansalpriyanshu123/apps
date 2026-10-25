package com.example.pdfvoicereader

import android.content.res.AssetManager
import android.net.Uri
import android.util.Log
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.IOException
import java.util.Locale

/**
 * Serves https://appassets.androidapp.com/assets/<file> straight from the APK's assets folder, so the web app runs
 * from a real https origin (localStorage, IndexedDB, ES modules and relative paths all behave normally).
 *
 * androidx's WebViewAssetLoader returned nothing for index.html on the test phone, so the page fell through to the
 * network and failed with ERR_NAME_NOT_RESOLVED; this does the same job in a few lines we control.
 */
class AssetServer(private val assets: AssetManager) {

    /** Returns the response for an asset URL, or null for any other URL (the WebView then loads it normally). */
    fun serve(url: Uri): WebResourceResponse? {
        if (url.host != HOST) return null
        val path = url.path.orEmpty()
        if (!path.startsWith(PATH_PREFIX)) return null
        val name = path.removePrefix(PATH_PREFIX)
        return try {
            val mime = mimeFor(name)
            WebResourceResponse(mime, if (isText(mime)) "utf-8" else null, assets.open(name))
        } catch (e: IOException) {
            Log.e(TAG, "asset not found: $name", e)
            WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
        }
    }

    private fun isText(mime: String) = mime.startsWith("text/") || mime.endsWith("javascript") || mime.endsWith("json")

    private fun mimeFor(name: String): String = when (name.substringAfterLast('.', "").lowercase(Locale.ROOT)) {
        "html", "htm" -> "text/html"
        "js", "mjs" -> "text/javascript"   // ES modules need a JavaScript MIME type
        "css" -> "text/css"
        "json", "map" -> "application/json"
        "wasm" -> "application/wasm"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "woff2" -> "font/woff2"
        "woff" -> "font/woff"
        else -> "application/octet-stream"
    }

    companion object {
        private const val TAG = "PVR"
        private const val PATH_PREFIX = "/assets/"

        /** Virtual host the page is served from; js/core/config.js checks for it to know it runs inside the app. */
        const val HOST = "appassets.androidapp.com"
        const val START_URL = "https://$HOST/assets/index.html"
    }
}
