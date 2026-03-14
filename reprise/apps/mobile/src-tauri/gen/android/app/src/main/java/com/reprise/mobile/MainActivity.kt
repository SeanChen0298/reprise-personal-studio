package com.reprise.mobile

import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.enableEdgeToEdge
import android.util.Log

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    Log.e("REPRISE", "onCreate called")
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    Log.e("REPRISE", "onCreate finished")
  }

  override fun onWebViewCreate(webView: WebView) {
    Log.e("REPRISE", "onWebViewCreate called!")
    webView.webViewClient = object : WebViewClient() {
      override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
        Log.e("REPRISE", "WebView page started: $url")
      }
      override fun onPageFinished(view: WebView?, url: String?) {
        Log.e("REPRISE", "WebView page finished: $url")
      }
      override fun onReceivedError(view: WebView?, errorCode: Int, description: String?, failingUrl: String?) {
        Log.e("REPRISE", "WebView error: $errorCode $description $failingUrl")
      }
    }
    setContentView(webView)
    Log.e("REPRISE", "setContentView called!")
  }

  override fun onStart() {
    Log.e("REPRISE", "onStart called")
    super.onStart()
  }

  override fun onResume() {
    Log.e("REPRISE", "onResume called")
    super.onResume()
  }
}