# This session's changes — copy-in and push instructions

9 files changed this session. All already verified with `npm run build` and the
eslint no-undef check on my end (except the Android files — see the note at the
bottom, those need YOUR build to actually verify).

## 1. Where each file goes

Unzip this alongside your project, then copy each file into the matching path
in `C:\Users\jackb\Downloads\wealth-within-app\wealth-within-app` — same
relative path as shown below, overwriting the existing file.

**Web app (mascot fix, Life Events/scenarios wrap-fix, Subscriptions hint, debt-preview wrap-fix):**
```
src/App.jsx
src/tabs/ForecastTab.jsx
src/tabs/IncomeTab.jsx
src/components/SetupWizard.jsx
```

**Android (Capacitor 8 alignment — Gradle/AGP/SDK/AndroidX versions):**
```
android/variables.gradle
android/build.gradle
android/app/build.gradle
android/gradle/wrapper/gradle-wrapper.properties
android/app/src/main/AndroidManifest.xml
```

Note: there are **two different files both named `build.gradle`** —
`android/build.gradle` and `android/app/build.gradle` are NOT the same file.
Make sure each one goes to its own correct folder, not on top of the other.

## 2. Command prompt — verify and push

Open Command Prompt, and make sure `npm run dev` isn't running anywhere first
(stop it with Ctrl+C in that window if it is — it'll block these commands).

```
cd C:\Users\jackb\Downloads\wealth-within-app\wealth-within-app
npm install
npm run build
```

If that build succeeds with no errors, you're good to commit and push:

```
git add .
git commit -m "Fix mascot overlap, wrap-safe layouts for Life Events/scenarios/debt preview, subscriptions hint, Android Capacitor 8 alignment"
git push
```

## 3. One thing to know about the Android changes specifically

Everything above was verified the same way as always this session — a real
`npm run build` plus the eslint check — **except the 5 Android files**. Those
I could only base on Capacitor's own official v8 migration docs; I have no
Android SDK or Gradle toolchain available to actually compile and confirm
them myself.

So when you get to the "test on a real device" item on the to-do list, that
first build attempt in Android Studio is the real verification for these
changes — not something already confirmed. If it fails, the error message
will tell us exactly what's still mismatched, and that's genuinely useful
information either way.

Also worth checking before that first Android build: **Node.js 22+** is
required by Capacitor 8 on whatever machine does the build — worth confirming
your local Node version if it's been a while since you checked.
