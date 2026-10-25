package com.example.pdfvoicereader

import android.annotation.SuppressLint
import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewClientCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * A thin shell around assets/index.html.
 *
 * It does two things the web page cannot do on its own inside a WebView:
 *  1. opens the system file picker when the page asks for a PDF, and
 *  2. exposes Android's native TextToSpeech engine to the page as `window.AndroidTTS`
 *     (WebView has no Web Speech API, and the native engine is better for Hindi anyway).
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    /** True while the page is reading aloud; the foreground service then belongs to playback. */
    private var speaking = false

    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (!speaking) stopService(Intent(this, SpeechService::class.java))
        val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        fileCallback?.onReceiveValue(uris)
        fileCallback = null
    }

    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* optional: reading works without the notification */ }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        PlaybackControl.onPause = { runJs("window.__androidTts && window.__androidTts.onPauseRequested()") }
        webView = WebView(this)
        setContentView(webView)
        WebView.setWebContentsDebuggingEnabled((applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            mediaPlaybackRequiresUserGesture = false
            textZoom = 100
        }

        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                serveAsset(request.url)
            override fun onPageFinished(view: WebView?, url: String?) {
                if (ttsReady) notifyVoicesChanged()
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = filePathCallback
                // The picker sends this app to the background; on a low-memory phone Android would kill it
                // there and the chosen PDF would be lost. A foreground service keeps the process alive.
                if (!speaking) startKeepAlive("Choosing a PDF…")
                return try {
                    filePicker.launch(params.createIntent())
                    true
                } catch (e: ActivityNotFoundException) {
                    fileCallback = null
                    if (!speaking) stopService(Intent(this@MainActivity, SpeechService::class.java))
                    false
                }
            }
        }

        webView.addJavascriptInterface(TtsBridge(), "AndroidTTS")

        tts = TextToSpeech(this) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) {
                tts?.language = Locale("hi", "IN")
                tts?.setOnUtteranceProgressListener(progressListener)
                notifyVoicesChanged()
            }
        }

        // Served over https from the app's own assets so localStorage and relative paths behave normally.
        webView.loadUrl("https://$ASSET_HOST/assets/index.html")
    }

    private fun startKeepAlive(text: String) {
        try {
            ContextCompat.startForegroundService(
                this,
                Intent(this, SpeechService::class.java)
                    .putExtra(SpeechService.EXTRA_TITLE, "PDF Voice Reader")
                    .putExtra(SpeechService.EXTRA_TEXT, text)
            )
        } catch (e: Exception) { /* best effort */ }
    }

    /**
     * Serves https://appassets.androidapp.com/assets/<file> straight from the APK's assets folder.
     * (androidx WebViewAssetLoader returned nothing for index.html on this device, so the page fell through
     * to the network and failed with ERR_NAME_NOT_RESOLVED.)
     */
    private fun serveAsset(url: Uri): WebResourceResponse? {
        if (url.host != ASSET_HOST) return null
        val path = url.path.orEmpty()
        if (!path.startsWith("/assets/")) return null
        val name = path.removePrefix("/assets/")
        return try {
            val stream = assets.open(name)
            val mime = mimeFor(name)
            val text = mime.startsWith("text/") || mime.endsWith("javascript") || mime.endsWith("json")
            WebResourceResponse(mime, if (text) "utf-8" else null, stream)
        } catch (e: java.io.IOException) {
            android.util.Log.e("PVR", "asset not found: $name", e)
            WebResourceResponse(
                "text/plain", "utf-8", 404, "Not Found", emptyMap(),
                java.io.ByteArrayInputStream(ByteArray(0))
            )
        }
    }

    private fun mimeFor(name: String): String = when (name.substringAfterLast('.', "").lowercase(Locale.ROOT)) {
        "html", "htm" -> "text/html"
        "js", "mjs" -> "text/javascript"
        "css" -> "text/css"
        "json", "map" -> "application/json"
        "wasm" -> "application/wasm"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "woff2" -> "font/woff2"
        "woff" -> "font/woff"
        "bcmap" -> "application/octet-stream"
        else -> "application/octet-stream"
    }

    override fun onDestroy() {
        PlaybackControl.onPause = null
        stopService(Intent(this, SpeechService::class.java))
        tts?.stop()
        tts?.shutdown()
        webView.destroy()
        super.onDestroy()
    }

    // ---------------------------------------------------------------- TTS → page callbacks

    private fun runJs(code: String) = runOnUiThread { webView.evaluateJavascript(code, null) }

    private fun notifyVoicesChanged() =
        runJs("window.__androidTts && window.__androidTts.onVoicesChanged()")

    private val progressListener = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {}

        override fun onDone(utteranceId: String?) {
            runJs("window.__androidTts && window.__androidTts.onEnd('${utteranceId.orEmpty()}')")
        }

        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String?) {
            runJs("window.__androidTts && window.__androidTts.onError('${utteranceId.orEmpty()}', 'error')")
        }

        override fun onError(utteranceId: String?, errorCode: Int) {
            runJs("window.__androidTts && window.__androidTts.onError('${utteranceId.orEmpty()}', 'error $errorCode')")
        }

        override fun onStop(utteranceId: String?, interrupted: Boolean) {
            // Interrupted by our own stop()/flush; the page already marked that job cancelled.
        }
    }

    // ---------------------------------------------------------------- page → TTS

    inner class TtsBridge {

        /** JSON array of {id, name, lang, online}. Empty until the engine has initialised. */
        @JavascriptInterface
        fun getVoices(): String {
            val engine = tts ?: return "[]"
            if (!ttsReady) return "[]"
            val voices: Set<Voice> = try { engine.voices ?: emptySet() } catch (e: Exception) { emptySet() }
            val arr = JSONArray()
            voices.sortedWith(compareBy({ it.locale.toLanguageTag() }, { it.name })).forEach { v ->
                if (v.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) == true) return@forEach
                arr.put(
                    JSONObject()
                        .put("id", v.name)
                        .put("name", prettyName(v))
                        .put("lang", v.locale.toLanguageTag())
                        .put("online", v.isNetworkConnectionRequired)
                )
            }
            return arr.toString()
        }

        @JavascriptInterface
        fun speak(text: String, voiceId: String, rate: Float, utteranceId: String) {
            val engine = tts ?: return
            runOnUiThread {
                val voice = if (voiceId.isNotEmpty()) {
                    try { engine.voices?.firstOrNull { it.name == voiceId } } catch (e: Exception) { null }
                } else null
                if (voice != null) engine.voice = voice else engine.language = Locale("hi", "IN")
                engine.setSpeechRate(rate.coerceIn(0.25f, 3f))
                engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId)
            }
        }

        @JavascriptInterface
        fun stop() {
            runOnUiThread { tts?.stop() }
        }

        /** Starts/stops the foreground service that keeps reading alive with the screen off. */
        @JavascriptInterface
        fun setPlaying(playing: Boolean, title: String) {
            runOnUiThread {
                speaking = playing
                val intent = Intent(this@MainActivity, SpeechService::class.java)
                if (playing) {
                    try {
                        ContextCompat.startForegroundService(this@MainActivity, intent.putExtra(SpeechService.EXTRA_TITLE, title))
                    } catch (e: Exception) { /* e.g. started from background; reading still works while visible */ }
                } else {
                    stopService(intent)
                }
            }
        }

        /** "hi-in-x-hia-local" → "हिन्दी (India) · hia" */
        private fun prettyName(v: Voice): String {
            val loc = v.locale
            val display = loc.getDisplayName(loc).ifBlank { loc.toLanguageTag() }
            val parts = v.name.split("-")
            val variant = parts.filter { it != "x" && it != "local" && it != "network" }
                .drop(2).joinToString("-")
            return if (variant.isNotBlank()) "$display · $variant" else display
        }
    }

    companion object {
        /** Virtual host the page is served from; index.html checks for it to know it is inside the app. */
        private const val ASSET_HOST = "appassets.androidapp.com"
    }
}
