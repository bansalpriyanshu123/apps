package com.example.pdfvoicereader

import android.app.Activity
import android.webkit.JavascriptInterface

/**
 * What the web app sees as `window.AndroidTTS` (see js/services/device-tts.js). A deliberately thin layer: every
 * method just hops to the UI thread and hands over to [SpeechEngine] or [KeepAlive].
 */
class AndroidTtsBridge(
    private val activity: Activity,
    private val engine: SpeechEngine,
    private val keepAlive: KeepAlive
) {

    /** JSON array of {id, name, lang, online}. */
    @JavascriptInterface
    fun getVoices(): String = engine.voicesJson()

    @JavascriptInterface
    fun speak(text: String, voiceId: String, rate: Float, utteranceId: String, flush: Boolean) {
        activity.runOnUiThread { engine.speak(text, voiceId, rate, utteranceId, flush) }
    }

    @JavascriptInterface
    fun stop() {
        activity.runOnUiThread { engine.stop() }
    }

    /** Starts / stops the foreground service that keeps reading alive with the screen off. */
    @JavascriptInterface
    fun setPlaying(playing: Boolean, title: String) {
        activity.runOnUiThread { keepAlive.playbackChanged(playing, title) }
    }
}
