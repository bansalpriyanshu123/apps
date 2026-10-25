package com.example.pdfvoicereader

/**
 * Lets the notification's Pause button (handled in [SpeechService]) reach the page. MainActivity sets the hook while
 * it is alive and clears it in onDestroy.
 */
object PlaybackControl {
    var onPause: (() -> Unit)? = null
}
