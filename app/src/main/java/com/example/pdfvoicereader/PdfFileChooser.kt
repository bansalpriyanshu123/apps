package com.example.pdfvoicereader

import android.content.ActivityNotFoundException
import android.net.Uri
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts

/**
 * Opens the system file picker when the page's <input type="file"> asks for a PDF and hands the choice back to the
 * WebView. Must be created while the activity is being constructed (it registers an activity-result callback).
 *
 * [onOpened] / [onClosed] bracket the time the app sits in the background behind the picker.
 */
class PdfFileChooser(
    activity: ComponentActivity,
    private val onOpened: () -> Unit,
    private val onClosed: () -> Unit
) {
    private var pendingCallback: ValueCallback<Array<Uri>>? = null

    private val launcher = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        onClosed()
        val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        pendingCallback?.onReceiveValue(uris)
        pendingCallback = null
    }

    /** @return true if the picker was launched */
    fun show(callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
        pendingCallback?.onReceiveValue(null)
        pendingCallback = callback
        onOpened()
        return try {
            launcher.launch(params.createIntent())
            true
        } catch (e: ActivityNotFoundException) {
            pendingCallback = null
            onClosed()
            false
        }
    }
}
