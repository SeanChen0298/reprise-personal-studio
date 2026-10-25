---
name: android-build
description: Build, debug, or configure the Reprise Android app (Expo, syncs with the desktop over Wi-Fi). Use when dealing with build errors, native module issues, ADB installs, Metro bundler problems, or phone ↔ desktop sync on Android.
argument-hint: [rebuild | fix-error | dev-workflow | <describe task>]
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---

You are working on the **Reprise Android app** (`reprise/apps/mobile-rn`, Expo SDK 53, rebuilt Oct 2026). Task: **$ARGUMENTS**

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Expo SDK 53 with **prebuild** (CNG): `android/` is generated from `app.json` and git-ignored |
| React Native | 0.79.x, New Architecture on, Hermes |
| Navigation | expo-router 5 (`app/` folder) |
| State | Zustand 5; library in files under the app's documents folder, prefs in AsyncStorage |
| Audio | expo-av (playback with rate + pitch correction, recording) |
| Pairing | expo-camera QR scan of `reprise://pair?h=<ip:port>&t=<token>&n=<host>` |
| Sync | plain HTTP to the desktop's sync server (`src-tauri/src/sync_server.rs`) on the LAN |
| Package manager | **npm**, on its own — `apps/mobile-rn` is excluded from the pnpm workspace |

No Supabase, no Google Drive, no auth: the phone only talks to the paired computer.

---

## Build & install

```bash
cd reprise/apps/mobile-rn
npm install
npx tsc --noEmit                                  # typecheck
npx expo export --platform android --output-dir dist   # quick check that Metro resolves everything
npx expo prebuild --platform android              # after app.json / native dep changes (regenerates android/)
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a   # add ,x86_64 for the emulator
# → android/app/build/outputs/apk/release/app-release.apk (debug-key signed; fine for personal use)
adb install -r app/build/outputs/apk/release/app-release.apk
```

Dev with Metro: `npx expo run:android` (debug build), then JS changes hot-reload.

Samsung test phone seen before: `39161FDJG000SK`. Emulator AVD on this machine: `Pixel_8`
(`$ANDROID_HOME/emulator/emulator -avd Pixel_8`). With an offline emulator listed, Expo device
detection can fail → `adb kill-server && adb start-server`.

---

## Lessons (keep)

1. **npm, not pnpm, for the phone app.** pnpm's linked node_modules broke the old RN app
   ("Cannot read property 'useMemo' of null", autolinking `packageImportPath`). The app is excluded
   in `pnpm-workspace.yaml` (`!apps/mobile-rn`) and has a flat npm `node_modules`.
2. **Shared code** comes only from `@reprise/shared/core` (types + pure helpers, no kuroshiro),
   mapped in `metro.config.js` (`resolveRequest`) and `tsconfig.json` (`paths`). Don't import the
   package root on the phone — it pulls in furigana generation.
3. **Missing transitive packages** (`Unable to resolve module …` while bundling): npm sometimes
   nests a package (e.g. `expo/node_modules/expo-asset`) or a library relies on an undeclared dep.
   Fixes used: `npx expo install expo-asset expo-font`, `npm install query-string@7.1.3`
   (expo-router 5 requires it without declaring it). Run `npx expo export` to find these fast.
4. **Cleartext HTTP** to the LAN needs `expo-build-properties` → `android.usesCleartextTraffic: true`
   (in app.json). Permissions (camera, mic) come from the expo-camera / expo-av plugins.
5. **Windows MAX_PATH** (CMake `.cxx` dirs): `C:/Users/cheny/.gradle/init.gradle` redirects them to `C:/cxx/<module>`.
6. **Zustand selectors** must not return new objects every render (use `useShallow` or select primitives),
   or React loops ("Maximum update depth exceeded").

---

## Sync protocol (phone side: `src/lib/sync-client.ts`, `src/stores/library-store.ts`)

- Every request sends `X-Reprise-Token`. `GET /ping`, `GET /library` (the `SyncSnapshot`),
  `GET /file?path=<desktop path>` (audio / takes), `POST /upload?name=<file>` (into the desktop inbox).
- A sync: upload unsent takes (audio, then `<id>.take.json` = `PhoneTake`), then one
  `changes-<ms>.json` (`PhoneChanges`: line notes / voice marks, take notes / stars, practised times),
  then pull the library. Phone edits stay overlaid until the snapshot's `updated_at` catches up.
- The desktop imports the inbox every 3 s and reviews phone takes (breath / high notes) at once,
  so the review shows on the phone after the next sync.
