package com.wealthwithin.app.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.widget.RemoteViews
import com.wealthwithin.app.R

// Reads the same SharedPreferences file @capacitor/preferences writes to
// from the JS side (src/utils/widgetSync.js). Default file name is
// "CapacitorStorage" — verify against your installed app if this ever
// shows blank values, since plugin defaults can change between versions.
private const val PREFS_FILE = "CapacitorStorage"
private const val KEY_NET_WORTH = "widget_net_worth"
private const val KEY_AVAILABLE = "widget_available"
private const val KEY_UPDATED_AT = "widget_updated_at"

class WealthWithinWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (widgetId in appWidgetIds) {
            updateWidget(context, appWidgetManager, widgetId)
        }
    }

    private fun updateWidget(context: Context, appWidgetManager: AppWidgetManager, widgetId: Int) {
        val prefs = context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
        val netWorth = prefs.getString(KEY_NET_WORTH, null)
        val available = prefs.getString(KEY_AVAILABLE, null)

        val views = RemoteViews(context.packageName, R.layout.widget_net_worth)

        if (netWorth != null) {
            views.setTextViewText(R.id.widget_net_worth_value, "£${formatThousands(netWorth)}")
            views.setTextViewText(R.id.widget_available_value, "£${formatThousands(available ?: "0")}/mo left")
        } else {
            // No data synced yet — first install before the app has been
            // opened once, or the JS-side sync hasn't run.
            views.setTextViewText(R.id.widget_net_worth_value, "Open the app")
            views.setTextViewText(R.id.widget_available_value, "to load your numbers")
        }

        // Tapping the widget opens the app — same as tapping the launcher icon.
        val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val pendingIntent = android.app.PendingIntent.getActivity(
            context, 0, launchIntent,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
        )
        views.setOnClickPendingIntent(R.id.widget_root, pendingIntent)

        appWidgetManager.updateAppWidget(widgetId, views)
    }

    private fun formatThousands(raw: String): String {
        val n = raw.toLongOrNull() ?: return raw
        return "%,d".format(n)
    }
}
