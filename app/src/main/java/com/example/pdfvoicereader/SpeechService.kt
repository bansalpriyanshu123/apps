package com.example.pdfvoicereader

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/** Hook the notification's Pause button uses to reach the page. Set by MainActivity. */
object PlaybackControl {
    var onPause: (() -> Unit)? = null
}

/**
 * Keeps the process (and the WebView that drives line-after-line reading) alive while speech is playing,
 * so reading carries on with the screen off or the app in the background.
 */
class SpeechService : Service() {

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_PAUSE) {
            PlaybackControl.onPause?.invoke()
            stopSelf() // paused: drop the foreground notification
            return START_NOT_STICKY
        }
        createChannel()
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val pause = PendingIntent.getService(
            this, 1, Intent(this, SpeechService::class.java).setAction(ACTION_PAUSE),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(intent?.getStringExtra(EXTRA_TITLE)?.ifBlank { null } ?: "PDF Voice Reader")
            .setContentText("Reading aloud")
            .setContentIntent(open)
            .setOngoing(true)
            .setSilent(true)
            .addAction(android.R.drawable.ic_media_pause, "Pause", pause)
            .build()
        val type = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)

        if (wakeLock == null) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "pdfvoicereader:speech").apply {
                setReferenceCounted(false)
                acquire(6 * 60 * 60 * 1000L) // safety timeout
            }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        super.onDestroy()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Reading aloud", NotificationManager.IMPORTANCE_LOW)
            )
        }
    }

    companion object {
        const val ACTION_PAUSE = "com.example.pdfvoicereader.PAUSE"
        const val EXTRA_TITLE = "title"
        private const val CHANNEL_ID = "reading"
        private const val NOTIFICATION_ID = 1
    }
}
