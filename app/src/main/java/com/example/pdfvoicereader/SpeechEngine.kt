package com.example.pdfvoicereader

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * Android's native text-to-speech engine, wrapped for the web app. Knows nothing about WebView: results are reported
 * through [Listener], which MainActivity turns into JavaScript calls.
 */
class SpeechEngine(context: Context, private val listener: Listener) {

    interface Listener {
        /** The engine finished initialising (or its voices changed): the page should reload its voice list. */
        fun onReady()
        fun onUtteranceDone(utteranceId: String)
        fun onUtteranceError(utteranceId: String, message: String)
    }

    private var tts: TextToSpeech? = null

    var isReady = false
        private set

    private val progress = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {}

        override fun onDone(utteranceId: String?) {
            val id = utteranceId.orEmpty()
            if (!id.endsWith(SILENCE_SUFFIX)) listener.onUtteranceDone(id)
        }

        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String?) {
            val id = utteranceId.orEmpty()
            if (!id.endsWith(SILENCE_SUFFIX)) listener.onUtteranceError(id, "error")
        }

        override fun onError(utteranceId: String?, errorCode: Int) {
            val id = utteranceId.orEmpty()
            if (!id.endsWith(SILENCE_SUFFIX)) listener.onUtteranceError(id, "error $errorCode")
        }

        override fun onStop(utteranceId: String?, interrupted: Boolean) {
            // Interrupted by our own stop()/flush; the page already marked that job cancelled.
        }
    }

    init {
        tts = TextToSpeech(context) { status ->
            isReady = status == TextToSpeech.SUCCESS
            if (isReady) {
                tts?.language = Locale("hi", "IN")
                tts?.setOnUtteranceProgressListener(progress)
                listener.onReady()
            }
        }
    }

    /** JSON array of {id, name, lang, online}. Empty until the engine has initialised. */
    fun voicesJson(): String {
        val engine = tts ?: return "[]"
        if (!isReady) return "[]"
        val voices: Set<Voice> = try { engine.voices ?: emptySet() } catch (e: Exception) { emptySet() }
        val array = JSONArray()
        voices.sortedWith(compareBy({ it.locale.toLanguageTag() }, { it.name })).forEach { voice ->
            if (voice.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) == true) return@forEach
            array.put(
                JSONObject()
                    .put("id", voice.name)
                    .put("name", prettyName(voice))
                    .put("lang", voice.locale.toLanguageTag())
                    .put("online", voice.isNetworkConnectionRequired)
            )
        }
        return array.toString()
    }

    /**
     * flush=true: a fresh start (tap, play, previous / next) - drop whatever is playing and begin with a short silence
     * so the first syllable isn't clipped while the audio route wakes up.
     * flush=false: the next sentence of continuous reading - queue behind the current one. Online voices report
     * "done" slightly before the audio ends, and flushing there chopped off the last word.
     * Must be called on the UI thread.
     */
    fun speak(text: String, voiceId: String, rate: Float, utteranceId: String, flush: Boolean) {
        val engine = tts ?: return
        val voice = if (voiceId.isNotEmpty()) {
            try { engine.voices?.firstOrNull { it.name == voiceId } } catch (e: Exception) { null }
        } else null
        if (voice != null) {
            if (engine.voice?.name != voice.name) engine.voice = voice
        } else engine.language = Locale("hi", "IN")
        engine.setSpeechRate(rate.coerceIn(0.25f, 3f))
        if (flush) {
            engine.playSilentUtterance(LEAD_IN_MS, TextToSpeech.QUEUE_FLUSH, utteranceId + SILENCE_SUFFIX)
        }
        engine.speak(text, TextToSpeech.QUEUE_ADD, null, utteranceId)
    }

    fun stop() {
        tts?.stop()
    }

    fun shutdown() {
        tts?.stop()
        tts?.shutdown()
    }

    /** "hi-in-x-hia-local" -> "<language name> · hia" */
    private fun prettyName(voice: Voice): String {
        val locale = voice.locale
        val display = locale.getDisplayName(locale).ifBlank { locale.toLanguageTag() }
        val variant = voice.name.split("-")
            .filter { it != "x" && it != "local" && it != "network" }
            .drop(2).joinToString("-")
        return if (variant.isNotBlank()) "$display · $variant" else display
    }

    private companion object {
        const val SILENCE_SUFFIX = ":sil"
        const val LEAD_IN_MS = 150L
    }
}
