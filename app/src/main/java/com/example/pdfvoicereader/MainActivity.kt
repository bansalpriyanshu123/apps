package com.example.pdfvoicereader

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.net.Uri
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
import androidx.webkit.WebViewAssetLoader
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

    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        fileCallback?.onReceiveValue(uris)
        fileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            mediaPlaybackRequiresUserGesture = false
            textZoom = 100
        }

        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

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
                return try {
                    filePicker.launch(params.createIntent())
                    true
                } catch (e: ActivityNotFoundException) {
                    fileCallback = null
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
        webView.loadUrl("https://appassets.androidapp.com/assets/index.html")
    }

    override fun onDestroy() {
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
}
