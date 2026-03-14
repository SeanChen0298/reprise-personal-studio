---
name: android-build
description: Build, debug, or configure the Reprise Android app. Use when dealing with build errors, native module issues, ADB installs, Metro bundler problems, or Google OAuth on Android.
argument-hint: [rebuild | fix-error | dev-workflow | <describe task>]
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---

You are working on the **Reprise Android app** (React Native + Expo bare workflow). Use this project-specific knowledge to perform the requested task: **$ARGUMENTS**

---

## Tech Stack

| Layer | Choice | Version |
|-------|--------|---------|
| Framework | Expo bare workflow | SDK 53 |
| React Native | react-native | 0.79.2 |
| Navigation | expo-router + react-native-screens | 4.11.1 |
| State | Zustand | 5.x |
| Auth | Supabase JS + expo-linking deep links | — |
| Storage | AsyncStorage | — |
| Audio | expo-av | — |
| Architecture | New Architecture (Fabric/JSI) | enabled |
| Package manager | pnpm (isolated node_modules) | 10.x |
| Build system | Gradle | 8.x |

---

## Project Paths

| Path | Purpose |
|------|---------|
| `reprise/apps/mobile-rn/` | Mobile app root |
| `reprise/apps/mobile-rn/android/` | Native Android project |
| `reprise/apps/mobile-rn/android/app/src/main/AndroidManifest.xml` | Deep links, permissions, intents |
| `reprise/apps/mobile-rn/android/gradle.properties` | `newArchEnabled=true`, ABI filter |
| `reprise/apps/mobile-rn/metro.config.js` | Monorepo + single-React workaround |
| `reprise/apps/mobile-rn/.env` | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` |
| `reprise/.npmrc` | Hoists react, react-native, react-dom to monorepo root |

---

## Dev Workflow — Spin Up & Test on Physical Device

> Device ID: `39161FDJG000SK` (Samsung physical device)

### First time / after native changes

```bash
# 1. Kill any offline emulators that break Expo device detection
adb kill-server && adb start-server

# 2. Verify only physical device is listed
adb devices

# 3. Full build + install (from monorepo root or mobile-rn dir)
cd reprise/apps/mobile-rn
npx expo run:android

# If Expo picks the wrong device, install the APK directly:
adb -s 39161FDJG000SK install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s 39161FDJG000SK shell am start -n com.reprise.mobile/.MainActivity
```

### JS-only changes (no new native modules)

No rebuild needed. Metro hot-reloads automatically. If the app is stale:

```bash
# Restart Metro with cleared cache
cd reprise/apps/mobile-rn
npx expo start --clear

# Then shake device → "Reload" OR press R in Metro terminal
```

### When to do a full rebuild vs Metro reload

| Change | Action needed |
|--------|---------------|
| JS/TS files only | Metro reload (shake → Reload) |
| New npm package (JS-only) | Metro restart with `--clear` |
| New native module added | Full rebuild (`npx expo run:android`) |
| `AndroidManifest.xml` changed | Full rebuild |
| `gradle.properties` changed | Full rebuild |
| `package.json` native deps changed | `pnpm install` then full rebuild |

---

## Known Issues & Fixes

### 1. "Cannot read property 'useMemo' of null"
**Cause:** pnpm's isolated `node_modules` causes Metro to bundle multiple copies of React. @react-navigation uses a different React instance than the app.

**Fix:** `metro.config.js` intercepts all `react` / `react-native` imports and forces them to resolve from the app's own `node_modules`:
```js
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react') return { filePath: path.resolve(reactPath, 'index.js'), type: 'sourceFile' };
  if (moduleName === 'react-native') return { filePath: path.resolve(reactNativePath, 'index.js'), type: 'sourceFile' };
  return context.resolveRequest(context, moduleName, platform);
};
```
Also `reprise/.npmrc` hoists `react`, `react-native`, `react-dom` to monorepo root.

### 2. react-native-screens version mismatch
**Cause:** `@react-navigation/native-stack@7.x` requires `react-native-screens >= 4.0.0`. Version 4.24.0 introduced C++ (`ShadowTreeCommitOptions`) not present in RN 0.79.x headers.

**Fix:** Pin to `~4.11.1` (Expo SDK 53 recommended). Do NOT use 3.x (causes useMemo error) or 4.24.0+ (C++ build failure).

### 3. "Maximum update depth exceeded" with Zustand
**Cause:** Selector returns a new object reference every render (e.g. `getLocalFiles` returns `{}`), causing Zustand to think value changed → infinite re-render.

**Fix:** Wrap selector with `useShallow`:
```ts
import { useShallow } from "zustand/react/shallow";
const localFiles = useSongFilesStore(useShallow((s) => s.getLocalFiles(id)));
```

### 4. Expo device detection fails with offline emulator
**Cause:** Expo enumerates all ADB devices including offline ones, throws when it can't reach the offline emulator port.

**Fix:**
```bash
adb kill-server && adb start-server
# Verify only physical device remains
adb devices
```

### 5. Windows MAX_PATH build errors (CMake)
**Cause:** CMake `.cxx` build dirs inside the repo exceed Windows 260-char path limit.

**Fix:** `C:/Users/cheny/.gradle/init.gradle` redirects all `.cxx` dirs to `C:/cxx/<module-name>`.

### 6. `app.json` intentFilters ignored in bare workflow
**Cause:** Bare React Native projects use the native `AndroidManifest.xml` directly; `app.json` config plugins that generate manifest entries are only applied during `expo prebuild`.

**Fix:** Always edit `android/app/src/main/AndroidManifest.xml` directly for deep links, intents, and permissions.

---

## Google Drive OAuth (Mobile)

**Why server-side?** Google's OAuth client types all have restrictions on Android:
- Android client → no browser PKCE (designed for Google Sign-In SDK only)
- Desktop client → only `http://127.0.0.1` loopback, no custom URI schemes
- Web client → HTTPS only

**Solution:** Three Supabase Edge Functions act as OAuth relay:

```
App → opens browser → google-drive-auth (edge fn)
                    → Google OAuth consent
                    → google-drive-callback (edge fn, HTTPS ✓)
                    → 302 reprise://auth/drive-callback?tokens
                    → App catches deep link via Linking.useURL()
```

**Key files:**
| File | Purpose |
|------|---------|
| `supabase/functions/google-drive-auth/index.ts` | Redirects to Google OAuth |
| `supabase/functions/google-drive-callback/index.ts` | Exchanges code for tokens, redirects to deep link |
| `supabase/functions/google-drive-refresh/index.ts` | Refreshes expired token (called by app directly) |
| `src/lib/google-drive-download.ts` | `buildDriveAuthUrl()`, `refreshAccessToken()` |
| `app/_layout.tsx` | `Linking.useURL()` deep link handler |
| `app/(tabs)/settings.tsx` | `WebBrowser.openAuthSessionAsync()` to start flow |

**Deploy commands:**
```bash
supabase functions deploy google-drive-auth --no-verify-jwt
supabase functions deploy google-drive-callback --no-verify-jwt
supabase functions deploy google-drive-refresh --no-verify-jwt
```
> `--no-verify-jwt` is required — these functions are hit via browser redirects with no auth header.

**Required Supabase secrets:**
```bash
supabase secrets set GOOGLE_DRIVE_CLIENT_ID=<web-oauth-client-id>
supabase secrets set GOOGLE_DRIVE_CLIENT_SECRET=<web-oauth-client-secret>
```

**Google Cloud Console requirements:**
- OAuth client type: **Web application**
- Authorized redirect URI: `https://jkedbxufzzcpiljefvtt.supabase.co/functions/v1/google-drive-callback`
- Scope: `https://www.googleapis.com/auth/drive.file`
- Add test user while in Testing mode

---

## Invariants to Preserve

- **`newArchEnabled=true`** must stay in `gradle.properties` — react-native-screens 4.x requires New Architecture
- **react-native-screens must stay at `~4.11.1`** — do not upgrade without verifying RN headers match
- **Never remove `metro.config.js`** — pnpm monorepo needs the React resolver fix
- **Edit `AndroidManifest.xml` directly** — never rely on `app.json` intentFilters in bare workflow
- **Edge functions need `--no-verify-jwt`** — browser redirects cannot send Authorization headers
