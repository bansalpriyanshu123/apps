package com.example.pdfvoicereader

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewClientCompat

/**
 * A thin shell around the web app in assets/ (index.html + css/ + js/).
 *
 * The page cannot do three things on its own inside a WebView, so the shell provides them:
 *  1. serving the bundled files over https ([AssetServer]),
 *  2. the system file picker for choosing a PDF ([PdfFileChooser]),
 *  3. Android's native text-to-speech, exposed as `window.AndroidTTS` ([SpeechEngine] + [AndroidTtsBridge]),
 *     plus a foreground service that keeps reading alive with the screen off ([KeepAlive] + [SpeechService]).
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var speech: SpeechEngine
    private val assetServer by lazy { AssetServer(assets) }
    private val keepAlive by lazy { KeepAlive(this) }
    private val fileChooser = PdfFileChooser(this, { keepAlive.pickerOpened() }, { keepAlive.pickerClosed() })

    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* optional: reading works without the notification */ }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestNotificationPermission()
        PlaybackControl.onPause = { runJs("window.__androidTts && window.__androidTts.onPauseRequested()") }

        webView = WebView(this)
        setContentView(webView)
        WebView.setWebContentsDebuggingEnabled((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0)
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            mediaPlaybackRequiresUserGesture = false
            textZoom = 100
        }

        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetServer.serve(request.url)

            override fun onPageFinished(view: WebView?, url: String?) {
                if (speech.isReady) notifyVoicesChanged()
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean = fileChooser.show(filePathCallback, params)
        }

        speech = SpeechEngine(this, object : SpeechEngine.Listener {
            override fun onReady() = notifyVoicesChanged()
            override fun onUtteranceDone(utteranceId: String) =
                runJs("window.__androidTts && window.__androidTts.onEnd('$utteranceId')")
            override fun onUtteranceError(utteranceId: String, message: String) =
                runJs("window.__androidTts && window.__androidTts.onError('$utteranceId', '$message')")
        })
        webView.addJavascriptInterface(AndroidTtsBridge(this, speech, keepAlive), "AndroidTTS")

        webView.loadUrl(AssetServer.START_URL)
    }

    override fun onDestroy() {
        PlaybackControl.onPause = null
        keepAlive.release()
        speech.shutdown()
        webView.destroy()
        super.onDestroy()
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    // ---------------------------------------------------------------- native -> page

    private fun runJs(code: String) = runOnUiThread { webView.evaluateJavascript(code, null) }

    private fun notifyVoicesChanged() = runJs("window.__androidTts && window.__androidTts.onVoicesChanged()")
}
