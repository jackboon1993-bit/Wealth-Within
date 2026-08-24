# Android widget — setup

1. Install `@capacitor/preferences`:
   ```
   npm install @capacitor/preferences
   npx cap sync
   ```

2. Place the files:
   - `WealthWithinWidgetProvider.kt` → `android/app/src/main/java/com/wealthwithin/app/widget/`
     (adjust the package path to match your actual `applicationId`)
   - `widget_net_worth.xml` → `android/app/src/main/res/layout/`
   - `widget_info.xml` → `android/app/src/main/res/xml/`

3. Register the receiver in `android/app/src/main/AndroidManifest.xml`, inside `<application>`:
   ```xml
   <receiver
       android:name=".widget.WealthWithinWidgetProvider"
       android:exported="false">
       <intent-filter>
           <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
       </intent-filter>
       <meta-data
           android:name="android.appwidget.provider"
           android:resource="@xml/widget_info" />
   </receiver>
   ```

4. Build and run. Long-press the home screen → Widgets → Wealth Within should appear.

**Verifying the data bridge:** if the widget shows "Open the app" permanently after you've opened it once, the SharedPreferences file name doesn't match. On a device/emulator with adb:
```
adb shell run-as com.wealthwithin.app cat /data/data/com.wealthwithin.app/shared_prefs/CapacitorStorage.xml
```
If that file doesn't exist, check what `@capacitor/preferences` actually names it in your installed version and update `PREFS_FILE` in the Kotlin file to match.

**Refresh timing:** `updatePeriodMin="30"` is the Android-enforced minimum for widget auto-refresh — it won't update more often than every ~30 minutes in the background, regardless of what's set here. That's an OS-level battery constraint, not something to work around; the widget will still refresh instantly whenever the app itself is opened and calls `syncWidgetData`.
