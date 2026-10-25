package com.example.pdfvoicereader

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

/**
 * Starts and stops [SpeechService], whose foreground notification and wake lock keep the process alive.
 *
 * Needed in two situations on a low-memory phone:
 *  - while reading aloud, so speech continues with the screen off or the app in the background;
 *  - while the system file picker is open, because Android otherwise kills the backgrounded app there and the chosen
 *    PDF is lost.
 */
class KeepAlive(private val context: Context) {

    /** True while the page is reading aloud; the service then belongs to playback, not to the file picker. */
    var speaking = false
        private set

    fun playbackChanged(playing: Boolean, title: String) {
        speaking = playing
        if (playing) start(title, null) else stop()
    }

    fun pickerOpened() {
        if (!speaking) start(DEFAULT_TITLE, "Choosing a PDF…")
    }

    fun pickerClosed() {
        if (!speaking) stop()
    }

    fun release() = stop()

    private fun start(title: String, text: String?) {
        val intent = Intent(context, SpeechService::class.java).putExtra(SpeechService.EXTRA_TITLE, title)
        if (text != null) intent.putExtra(SpeechService.EXTRA_TEXT, text)
        try {
            ContextCompat.startForegroundService(context, intent)
        } catch (e: Exception) {
            // e.g. started from the background: reading still works while the app is visible
        }
    }

    private fun stop() {
        context.stopService(Intent(context, SpeechService::class.java))
    }

    private companion object {
        const val DEFAULT_TITLE = "PDF Voice Reader"
    }
}
