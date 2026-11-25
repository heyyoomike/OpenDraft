# OpenDraft — Claude Instructions

## Open-Core Architecture

OpenDraft is the **open-source core** (MIT license). A separate **OpenDraft-Pro** repo (private, at `../OpenDraft-Pro/`) extends it with commercial plugins.

### Plugin System

The core exposes a plugin architecture so Pro features can be added without modifying core code:

- **Frontend:** `frontend/src/plugins/registry.ts` — `pluginRegistry.register()` to add menu items, sidebar panels, routes, editor extensions, and `importers` / `exporters` / `reports`
- **Backend:** `backend/app/plugins.py` — `register_router()` and `register_hook()` for API routes and lifecycle hooks
- **Integration points:** MenuBar appends plugin menu items, App.tsx renders plugin routes, ScreenplayEditor renders plugin panels and editor extensions
- **Importers** join every import path through `utils/importScreenplay.ts` (`importExtensions()`, `isBinaryImportExtension()` …) — a plugin can add a format but never take over a built-in one. **Exporters** are listed under File → Export. **Reports** return a `ReportTable` and appear in Tools → Analytics → Reports beside the built-in ones (`utils/scriptReports.ts`), with the same CSV and PDF export

### Key Rules

- **Never add commercial/Pro features to this repo** — they go in OpenDraft-Pro
- Plugin architecture changes (registry, hooks, extension points) belong HERE
- Bug fixes to existing features go HERE — they automatically flow to Pro via git submodule
- The `pluginRegistry` import in MenuBar, App.tsx, and ScreenplayEditor is how Pro injects features at runtime

### Repo Relationship

```
OpenDraft (this repo, public, MIT)     ← upstream
    ↑
OpenDraft-Pro (private, proprietary)   ← imports this as git submodule at core/
```

---

## Codebase Map

Four runnable pieces. The **desktop and mobile apps do not use the Python
backend** — they store everything in local SQLite through Tauri. The backend
only serves the **web** build (and `open-draft.com`).

| Piece | Path | Stack | Dev port |
|-------|------|-------|----------|
| Frontend (all platforms) | `frontend/` | React 19, TypeScript, Vite, TipTap 2, Zustand | 5173 |
| Desktop/mobile shell | `src-tauri/` | Tauri 2 (Rust) | — (loads 5173 in dev) |
| Web API backend | `backend/` | FastAPI, per-project git (dulwich) | 8008 |
| Collaboration server | `collab-server/` | Hocuspocus + Yjs, Express, SQLite/Postgres | 4000 |

### Editor

- `frontend/src/components/ScreenplayEditor.tsx` — the editor screen (~7k
  lines): builds the TipTap editor, wires collaboration, hosts docks/panels,
  menu bar and toolbar. Routes `/`, `/project/:id/edit/:scriptId`,
  `/collab/:token` and history all render it (`App.tsx`).
- `frontend/src/editor/extensions/` — one TipTap node/mark per screenplay
  element (`SceneHeading`, `Action`, `Character`, `Dialogue`, `Parenthetical`,
  `Transition`, `DualDialogue`, `Note`, `RevisionMark`, …), re-exported from
  `index.ts`.
- `frontend/src/editor/*.ts` — ProseMirror plugins and editor logic:
  `pagination.ts`, `smartType.ts` (autocomplete), `contdAuto.ts`,
  `revisionMarks.ts`, `suggestions.ts`/`trackChanges.ts`, `spellchecker.ts`,
  `sceneReorder.ts`, `grammar/` providers.
- `frontend/src/stores/editorStore.ts` — Zustand store for editor/session
  state, including every panel's open flag (`navigatorOpen`,
  `scriptNotesOpen`, `dialogueTunerOpen`, …).
- `frontend/src/components/MenuBar.tsx` (menus + What's New),
  `components/Toolbar.tsx` + `components/toolbar/` (toolbar,
  `toolbarMeta.tsx` icons/labels per panel).
- Import/export: `frontend/src/utils/` — `importScreenplay.ts` (entry point),
  `fdxParser.ts`/`fdxExporter.ts`, `fountainParser.ts`/`fountainExporter.ts`,
  `pdfExporter.ts`, `pdfImport.ts`, `docxExporter.ts`, `osfParser.ts`,
  `odraftFormat.ts` (native format).
- `frontend/src/components/TreatmentEditor.tsx` — the separate treatment editor.

### Collaboration (Yjs / WebSocket)

- **Client:** `ScreenplayEditor.tsx` creates a `HocuspocusProvider` (search
  `new HocuspocusProvider`) and swaps TipTap's History for
  `Collaboration` + `CollaborationCursor`.
  - `services/collabSync.ts` — bridges a Yjs `metadata` Y.Map with Zustand
    stores (character profiles, notes, tags, beats, synopses, template).
  - `services/collabAuth.ts`, `services/reviewProtocol.ts`,
    `services/rejectedCollabRecovery.ts`, `components/ShareDialog.tsx`,
    `components/JoinCollabDialog.tsx`, `components/CollabLoginDialog.tsx`.
  - Server URL: `config.ts` `getCollabWsUrl()` — localStorage
    `opendraft:collabServerUrl` (Settings), else `VITE_COLLAB_WS_URL`, else
    `wss://collab.open-draft.com`.
- **Server:** `collab-server/src/server.ts` — Hocuspocus hooks
  (`onAuthenticate` checks JWT/invite token and role, `onLoadDocument` /
  `onStoreDocument` persist each Yjs doc as a binary update file under
  `collab-server/data/`), plus Express routes: `routes/auth.ts` (accounts,
  JWT), `routes/collab.ts` (sessions/invites), `routes/admin.ts`,
  `routes/internal.ts`. `services/suggestionGuard.ts` enforces suggest-only
  roles; `database/` has SQLite and Postgres adapters; `config.ts` reads env.
- The collab server also owns **user accounts**; the backend validates its
  JWTs with the shared secret (`COLLAB_JWT_SECRET` = collab's `JWT_SECRET`,
  written by `setup_auth_env.sh`).

### File storage

`frontend/src/services/api.ts` exports `api`, the one storage interface. At
start-up it picks an implementation:

| Platform | Implementation | Where data lives |
|----------|----------------|------------------|
| Web | HTTP to `backend/` (`api.ts` itself, `authedFetch.ts`) | `backend/data/projects/users/<id>/` — one git repo per project (`backend/app/services/git_service.py`, `project_service.py`, `script_service.py`) |
| Tauri (desktop/mobile) | `services/local-storage.ts` over `services/db.ts` | SQLite `opendraft.db` (WAL) in the app data dir; assets on disk next to it; versions are delta commits in SQLite |
| Tauri, SQLite unusable | `file-fallback-storage.ts`, then `fallback-storage.ts` (localStorage) | — |

- Scripts can also be **linked to files on disk** (`.odraft`, `.fountain`,
  `.fdx`): `services/linkedFiles.ts`, `utils/linkedFileFormat.ts`,
  `components/LinkedFileSync.tsx`; see `docs/PROJECT_STORAGE.md`.
- Native file I/O (atomic save, file pickers, backups) is Rust:
  `src-tauri/src/lib.rs` (`invoke_handler` lists every command),
  `safe_file.rs`, `source_backups.rs`.
- Backups/recovery: `services/backupService.ts`, `recoveryService.ts`,
  `pendingSave.ts`. Device/cloud sync: `deviceProjectSync.ts`,
  `offlineCloud.ts` (`docs/cloud-sync-merge.md`).
- Backend API routers: `backend/app/api/` (`scripts`, `projects`,
  `versions`, `assets`, `locations`, `collab`, `export`, `auth`, `admin`),
  mounted in `backend/app/main.py`, which also serves `backend/static/` (the
  built frontend) for self-hosting.

### UI panels

- **Built-in panels** live in `frontend/src/components/` (`SceneNavigator`,
  `ScriptNotes`, `CharacterProfiles`, `TagsPanel`, `LocationDatabase`,
  `SceneDetailsPanel`, `DialogueTuner`, `SuggestionsPanel`, `TableReadPanel`).
- `utils/workspaceLayout.ts` — panel ids (`NAVIGATOR_PANELS`, `TOOL_PANELS`),
  docks (`start` / `end` / `bottom`), groups and layout presets.
- `utils/panelActions.ts` — maps panel ids to their open flags
  (`panelOpenIn`) and open/close actions.
- `ScreenplayEditor.tsx` — `dockPanels[...]` says how each panel renders in a
  dock (search `Workspace docks`).
- Pop-out windows: `components/PanelPopout.tsx`, `stores/panelPopoutStore.ts`,
  `src-tauri/src/panel_windows.rs` (`docs/panel-windows.md`). A panel in a
  pop-out renders into another `document` — use `ownerDocument`, not the
  global `document`, for DOM work.
- **Plugin/add-on panels** render in the "add-ons" strip via
  `components/PluginPanelTabs.tsx` (`pluginRegistry.getPanels('right-sidebar')`);
  `status-bar` panels render at the bottom of the editor.
- Other views: `IndexCards.tsx`, `BeatBoard.tsx`, `OutlineView.tsx`,
  `ScriptStatistics.tsx`, `ReportsDialog.tsx`.

### Adding a new panel or tool

Pick the route first:

1. **Optional/opt-in tool → add-on** (preferred for anything a writer may not
   want, and anything using the network). Create
   `frontend/src/addons/<id>/index.ts` default-exporting an `OpenDraftPlugin`
   with `optIn: true`, a `description` and a `privacy` statement, and add it
   to `CORE_ADDONS` in `addons/index.ts`. Contribute through the registry:
   `panels: [{ id, slot: 'right-sidebar', label, component }]`, `menuItems`
   (`section: 'Tools'`, open your panel by dispatching
   `PLUGIN_PANEL_OPEN_EVENT` with `{ panelId }`), `editorExtensions`,
   `importers` / `exporters` / `reports`, `sceneActions`,
   `grammarProviders`, `settings`. Nothing outside `src/addons/` may import
   your add-on (`addons/boundary.test.ts` enforces it). Model:
   `addons/dictation/index.ts`.
2. **Commercial feature** → same plugin shape, but in OpenDraft-Pro, never here.
3. **Built-in core panel** — touch every place the Dialogue Tuner (`'tuner'`)
   appears:
   - component in `components/` taking `editor` and `style`;
   - `stores/editorStore.ts`: `xxxOpen` flag, `openXxx`/`closeXxx`, and
     persist it via `saveViewState` like the others;
   - `utils/workspaceLayout.ts`: add the id to `TOOL_PANELS` and to the
     presets in `workspacePreset()`;
   - `utils/panelActions.ts`: `usePanelOpen`, `OpenFlags`, `panelOpenIn`
     and the show/hide switch;
   - `ScreenplayEditor.tsx`: `openFlags` and `dockPanels.<id>.render`;
   - `components/toolbar/toolbarMeta.tsx`: icon and label;
   - `components/MenuBar.tsx`: View → Panels entry;
   - strings in `frontend/src/locales/en/*.json` (and other locales —
     `npm run i18n:check`, `docs/i18n.md`).
4. **Backend endpoint** → router in `backend/app/api/`, include it in
   `main.py` (or `register_router()` from a plugin). Remember desktop/mobile
   never call it — mirror the behaviour in `services/local-storage.ts`.
5. **Native capability** → `#[tauri::command]` in `src-tauri/src/`, add it
   to `generate_handler![...]` in `lib.rs`, and allow it in
   `src-tauri/capabilities/` if it needs a plugin permission.

Tests: `cd frontend && npm test` (Vitest, tests sit next to sources),
`npm run lint`, `npm run build` (runs `tsc -b`).

---

## Running locally on Windows

The `start_*.sh` scripts assume macOS/Linux (`venv/bin`, `source .env`). The
equivalents below were verified on Windows 11 with Python 3.12, Node 24,
Rust 1.96 and VS 2022 Build Tools (C++ workload; WebView2 is built in).

One-time setup (Git Bash for the first command — it needs `openssl`):

```bash
./setup_auth_env.sh   # writes backend/.env + collab-server/.env with a shared JWT secret
```

- It also rewrites `backend/.env.example` and `collab-server/.env.example`;
  `git checkout` them afterwards.
- It writes `COLLAB_DB_PATH` as a Git Bash path (`/d/...`). Change it to a
  Windows path in `backend/.env`, e.g.
  `COLLAB_DB_PATH=D:/OpenDraft/collab-server/data/collab.sqlite3`.

```powershell
py -3.12 -m venv venv
venv\Scripts\pip install -r backend\requirements.txt
npm ci --prefix collab-server
npm ci --prefix frontend
```

If an `npm ci` ends with `ENOTEMPTY` / `TAR_ENTRY_ERROR`, or packages come out
half-extracted (no `node_modules\.bin`, `Cannot find module 'better-sqlite3'`),
Defender or the indexer was holding files. Delete the folder with
`Remove-Item node_modules -Recurse -Force` and run `npm ci` again; excluding
the repo from Defender scanning avoids it.

Run, each in its own terminal:

```powershell
# Collaboration server — ws://localhost:4000 (reads collab-server/.env itself)
cd collab-server; npm run dev
```

```powershell
# Web API backend — http://localhost:8008 (docs at /docs). It does not read .env itself.
Get-Content backend\.env | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object { $k,$v = $_ -split '=',2; Set-Item "env:$k" $v }
cd backend; ..\venv\Scripts\python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8008
```

```powershell
# Desktop app — run from the REPO ROOT. Starts Vite on 5173 itself; the first run compiles Rust for several minutes.
frontend\node_modules\.bin\tauri dev
```

```powershell
# Web app in a browser instead — http://localhost:5173, talks to the backend on 8008
cd frontend; npm run dev
```

- The Tauri CLI must run from the repo root: from `frontend/` it panics
  "Couldn't recognize the current folder as a Tauri project". It also runs
  `beforeDevCommand` / `beforeBuildCommand` from the root, which is why both
  start with `cd frontend`.
- If Vite is already running on 5173, `tauri dev` fails (`strictPort`). Stop
  it, or reuse it with
  `--config '{\"build\":{\"beforeDevCommand\":\"\"}}'`
  (Git Bash: `--config '{"build":{"beforeDevCommand":""}}'`).

- The **desktop app does not use the backend**: it stores data in local
  SQLite under `%APPDATA%\com.proteus.opendraft\`. To collaborate against
  the local collab server, set Settings → Collaboration Server → Server URL
  to `ws://localhost:4000` (default is `wss://collab.open-draft.com`).
- The root `node_modules` file is a git symlink to `frontend/node_modules`;
  on Windows without symlink support it checks out as a text file, so
  `npm run tauri` from the root does not work — call
  `frontend\node_modules\.bin\tauri` directly, as above.
- Without SMTP configured, the collab server prints sign-up verification
  codes to its console.
- A Windows `tauri dev` rewrites `src-tauri/gen/schemas/*.json` (and adds
  `windows-schema.json`) and can flip `src-tauri/Cargo.toml` line endings.
  Don't commit those by accident.

---

## macOS Desktop Build — Code Signing & Notarization

The macOS `.dmg` is built via **GitHub Actions** (in `.github/workflows/release.yml`), same as Windows, Linux, and Android. It is signed and notarized automatically when the correct GitHub secrets are configured.

### GitHub Secrets for macOS

| Secret | Description |
|--------|-------------|
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` file containing the Developer ID Application certificate + private key |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` file |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Base Information Management Pvt. Ltd. (335RGMFDB6)` |
| `APPLE_ID` | Apple ID email for notarization |
| `APPLE_TEAM_ID` | `335RGMFDB6` |
| `APPLE_PASSWORD` | App-specific password from appleid.apple.com |

### How to export the certificate as `.p12`

1. Open Keychain Access, find `Developer ID Application: Base Information Management Pvt. Ltd.`
2. Right-click → Export Items → save as `.p12` with a password
3. Base64-encode: `base64 -i certificate.p12 | pbcopy`
4. Paste into the `APPLE_CERTIFICATE` GitHub secret

### Local build (optional)

`./build-desktop.sh` can still build a signed `.dmg` locally if you have Apple credentials in `.env`.

### Common mistakes to avoid

- **Never skip signing/notarization** — unsigned `.dmg` files trigger "damaged and can't be opened" on user machines
- Use **Developer ID Application** certificate for direct distribution (not "3rd Party Mac Developer" — that's for App Store only)
- The App Store build (`build-appstore.sh` locally, or `build-mac-appstore` CI job) uses different certificates. Don't mix them up.

## macOS App Store Build (CI)

The macOS `.pkg` for the Mac App Store is built via **GitHub Actions** (in `.github/workflows/release.yml`, the `build-mac-appstore` job). This runs **in addition to** the direct distribution `.dmg` build — both are produced on every release.

### How it works

1. Builds the Tauri app unsigned (`APPLE_SIGNING_IDENTITY="-"`)
2. Re-signs with Apple Distribution certificate and App Store entitlements
3. Embeds the macOS provisioning profile
4. Packages as `.pkg` with the Mac Installer certificate
5. Uploads to App Store Connect via API key

### GitHub Secrets for macOS App Store

Reuses `IOS_CERTIFICATE` (Apple Distribution) and `APPSTORE_API_KEY*` secrets. Additional secrets:

| Secret | Description |
|--------|-------------|
| `MAC_INSTALLER_CERTIFICATE` | Base64-encoded `.p12` of "3rd Party Mac Developer Installer" or "Mac Installer Distribution" certificate |
| `MAC_INSTALLER_CERTIFICATE_PASSWORD` | Password for the `.p12` file |
| `MAC_APPSTORE_PROVISION_PROFILE` | Base64-encoded `.provisionprofile` for macOS App Store |

### Local build (optional)

`./build-appstore.sh` can still build locally if you have Apple credentials in Keychain.

## Promotion & Articles

Promotion materials (blog posts, articles, social media content) go in `Promotion/posts/` in the project root — **not** in `docs/`.

---

## Release Process

See `docs/RELEASE.md` for the full checklist. Key points:
- Use `./release.sh X.Y.Z` to automate the full release
- GitHub Actions builds **all platforms**: macOS (.dmg), Windows (.exe/.msi), Linux (.deb/.AppImage), Android (.apk/.aab), iOS (.ipa)
- macOS builds are signed and notarized via Apple secrets in GitHub
- Update "What's New" content in MenuBar.tsx and user-manual before releasing
- **Never name another mobile platform in an app's UI text** — no "Android" anywhere the iOS or Mac app shows it, and no "iOS", "iPhone" or "iPad" anywhere the Android app shows it. This covers release notes, What's New, the user manual, store notes, translations, toasts and dialogs. App Review rejects it under guideline 2.3.10, and store reviewers treat the reverse the same way. Write platform-neutral words ("phones and tablets", "the mobile app"), or gate the text by platform: `<NotOnApple>` in MenuBar.tsx and `data-platform="android"` in the manual for Android-only wording. See `docs/RELEASE.md` step 3

---

## Android Build

The Android `.apk` and `.aab` are built via **GitHub Actions** (in `.github/workflows/release.yml`, the `build-android` job). There is no local Android build — the CI runner provides the SDK, NDK, and Rust cross-compilation targets.

### How it works

1. CI runs `tauri android init` to generate the Gradle project (since `src-tauri/gen/` is gitignored)
2. Patches `tauri.conf.json` to remove `externalBin` (no Python sidecar on Android — the app uses local SQLite)
3. If signing secrets are configured, patches `build.gradle.kts` with release signing config
4. Builds both `.apk` (sideloadable) and `.aab` (Play Store)
5. Uploads renamed artifacts (`OpenDraft_X.Y.Z_android.apk/aab`) to the GitHub Release

### 16 KB memory page support (required by Google Play)

Apps targeting Android 15+ must ship native libraries laid out for 16 KB memory
pages; Play has refused updates without it since November 2025. NDK 27's linker
still defaults to 4 KB, so `src-tauri/build.rs` passes
`-Wl,-z,max-page-size=16384` for Android targets.

That flag lives in `build.rs`, **not** in `.cargo/config.toml`: the Tauri CLI
sets `CARGO_TARGET_<TRIPLE>_RUSTFLAGS` for every Android build, and that
environment variable replaces a target's rustflags from config rather than
merging with them, so anything written there is dropped silently.

The `Verify native libraries are 16 KB page aligned` CI step reads the alignment
back off the built APK and fails the release if it regresses. To check by hand:

```bash
$NDK_HOME/toolchains/llvm/prebuilt/*/bin/llvm-readelf -l libopendraft_lib.so | grep LOAD
# the last column must be 0x4000, not 0x1000
```

### Compiling the Android Rust before a release

`.github/workflows/test.yml` type-checks `src-tauri` against
`aarch64-linux-android` on every push and pull request. The desktop jobs build
for the host, so without it every `#[cfg(target_os = "android")]` block — the
JNI behind export, print, the file picker and backups — first compiles inside
`build-android`, during a release, on the one workflow that cannot be re-run
without a tag.

It is `cargo check`, not a build: no Gradle, no APK, nothing about Kotlin or
R8. Two things it needs that a desktop check does not, and that the Tauri CLI
would otherwise set:

- `CC_aarch64_linux_android` and friends pointing into the NDK. cc-rs looks for
  `aarch64-linux-android-clang`, which no NDK ships, so C build scripts (ring's
  among them) fail before any OpenDraft code is reached.
- A real `frontend/dist`, because `tauri::generate_context!()` embeds it at
  compile time.

The NDK version is pinned to the one `build-android` uses. Keep the two in step.

### GitHub Secrets for Android signing

For unsigned builds (testing), no secrets are needed. For signed/production builds, add these repository secrets:

| Secret | Description |
|--------|-------------|
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded release keystore (`base64 -i release.keystore`) |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias (e.g., `opendraft`) |
| `ANDROID_KEY_PASSWORD` | Key password |

### Generate a keystore (one-time)

```bash
keytool -genkey -v -keystore opendraft-release.keystore \
  -alias opendraft -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=OpenDraft, O=Proteus Technologies"
base64 -i opendraft-release.keystore | pbcopy  # copy to clipboard for GitHub secret
```

### Local Android development (optional)

Requires Android Studio (or SDK command-line tools), NDK 27, and Rust Android targets:
```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
cd frontend && npx tauri android init && npx tauri android build --apk
```

---

## Linux Build — AppImage

The `.deb`, `.rpm` and `.AppImage` come out of the `ubuntu-22.04` leg of
`build-desktop`. The AppImage then gets repacked before it ships.

### Why the AppImage is repacked

linuxdeploy (which the Tauri AppImage bundler drives) walks `ldd` and copies
every dependency into `AppDir/usr/lib` — including `libwayland-client.so.0`. It
does **not** bundle Mesa: `libEGL` always comes from the user's machine. Since
`AppRun` puts `AppDir/usr/lib` ahead of the system path, the host's own
`libEGL_mesa` gets resolved against our Ubuntu 22.04 `libwayland-client`, fails
to find symbols it needs (`wl_fixes_interface`,
`wl_display_create_queue_with_name`, `wl_display_dispatch_queue_timeout`), and
`libEGL` reports `EGL_BAD_PARAMETER`. WebKit is left with no renderer and the
window comes up blank white — reported from Arch + GNOME/Wayland as issue #113.
`GDK_BACKEND=x11` is already set by linuxdeploy's GTK hook, so this bites under
XWayland too; it is a bundled-library problem, not a Wayland-backend one.

`libwayland` is host-ABI-coupled for exactly this reason and sits on the
upstream AppImage excludelist — the linuxdeploy build Tauri fetches just misses
it. Every desktop that can run a GTK3 app already ships it, so removing ours is
strictly a fix.

- `.github/scripts/fix-appimage-wayland.sh` strips `libwayland-*` and repacks
- `.github/scripts/verify-appimage-wayland.sh` fails the release if any come back
- `.github/scripts/appimage-squashfs.py` reads the offset, compressor and block
  size out of the file, shared by both

The repack reuses the AppImage's **own** runtime (the ELF prefix the file
already starts with) and the compressor recorded in its superblock, so it needs
neither appimagetool nor FUSE, and the runtime that will mount the result is
reading exactly the format it wrote. Hardcoding gzip instead of the zstd Tauri
uses cost 10 MB.

`tauri-action` uploads the AppImage itself, so the repacked file is re-uploaded
over the draft asset afterwards.

### Testing the Linux AppImage without a Linux machine

Both scripts take a release version or a path, exit non-zero on the bug, and
need only Docker — no VM, no GPU, no Wayland compositor. They run under x86
emulation on an Apple Silicon Mac and natively (much faster) on any x86_64
Linux box or free cloud shell.

```bash
./test-script/repro_issue_113_egl.sh [version | path.AppImage]      # ~1 min
./test-script/launch_appimage_headless.sh [version | path.AppImage] # ~5 min
```

The first loads a current Arch Mesa's EGL driver against the AppImage's bundled
`libwayland-client` and diffs the symbols — quick enough for the inner loop.
The second boots the real app under Xvfb in the same container, screenshots it
to `test-script/output/issue-113/`, and fails on either an `EGL_BAD_PARAMETER`
in the log or a near-flat screenshot. Mesa falls back to software rendering
there, which is fine: the bug is library resolution during EGL driver load, not
anything the GPU does. On a native runner set `SETTLE_SECONDS=45`.

Run at least the second one against a fresh build after touching anything in
the Linux bundle path.

### The same test in CI

`.github/workflows/test-appimage.yml` is a `workflow_dispatch` job that runs
both scripts on a GitHub runner and uploads the screenshot and console log as
artifacts. Give it a released version to test that release, or leave `version`
empty to build the AppImage from the branch first. Untick `repack` to skip the
Wayland strip and confirm the test still catches the bug.

The job runs the app inside the same Arch container the local scripts use — the
runner's own Mesa is no good for this. Ubuntu builds Mesa against its own older
wayland, so even 24.04 with Mesa 25.2 loads our bundled `libwayland-client`
happily. Of the common cloud images only Debian 13, Ubuntu 25.04, Fedora 41+
and Arch reproduce it; Debian 12 and Ubuntu 22.04/24.04 do not.

---

## iOS Build

The iOS `.ipa` is built via **GitHub Actions** (in `.github/workflows/release.yml`, the `build-ios` job). It runs on a macOS runner, builds the Tauri iOS app, and uploads to both the GitHub Release and App Store Connect.

The job runs on GitHub's `xcode-27` image and selects **Xcode 27.2** (`/Applications/Xcode_27.2.app`). It must stay on an iOS 27.1+ SDK: `FoldPosture.m`, the iPhone Duo hinge bridge (#231), only compiles its hinge code against one, and `macos-26` stops at Xcode 26.6. The step fails the build if 27.2 or its iOS 27.2 SDK is missing, rather than shipping without it.

Xcode 27's SwiftPM builds with its new `swiftbuild` engine by default, which forces macOS SDK flags onto Tauri's Swift package and fails with "could not build module 'AppKit'/'UIKit'". The next step puts a `swift` shim first on `PATH` that runs `swift build --build-system native`; local Xcode 27 builds need the same shim. v2.13.0's first run failed here before it was added.

### How it works

1. CI runs `tauri ios init` to generate the Xcode project (since `src-tauri/gen/` is gitignored)
2. Imports the Apple Distribution certificate and provisioning profile from GitHub secrets
3. Patches `tauri.conf.json` to remove `externalBin` (no Python sidecar on iOS — the app uses local SQLite)
4. Builds with `tauri ios build --export-method app-store-connect`
5. If App Store Connect API key is configured, uploads the IPA directly to App Store Connect
6. Uploads renamed artifact (`OpenDraft_X.Y.Z_ios.ipa`) to the GitHub Release

### GitHub Secrets for iOS

All secrets are required for the build to succeed:

| Secret | Description |
|--------|-------------|
| `IOS_CERTIFICATE` | Base64-encoded `.p12` containing the Apple Distribution certificate + private key |
| `IOS_CERTIFICATE_PASSWORD` | Password for the `.p12` file |
| `IOS_PROVISION_PROFILE` | Base64-encoded `.mobileprovision` file for the app |

For automatic App Store Connect upload (optional):

| Secret | Description |
|--------|-------------|
| `APPSTORE_API_KEY` | Base64-encoded App Store Connect API key (`.p8` file) |
| `APPSTORE_API_KEY_ID` | Key ID from App Store Connect (e.g., `XXXXXXXXXX`) |
| `APPSTORE_API_ISSUER_ID` | Issuer ID from App Store Connect |

### How to export the iOS certificate as `.p12`

1. Open Keychain Access, find `Apple Distribution: Base Information Management Pvt. Ltd. (335RGMFDB6)`
2. Right-click → Export Items → save as `.p12` with a password
3. Base64-encode: `base64 -i distribution.p12 | pbcopy`
4. Paste into the `IOS_CERTIFICATE` GitHub secret

### How to get the provisioning profile

1. Go to developer.apple.com → Certificates, Identifiers & Profiles → Profiles
2. Create or download an App Store provisioning profile for `com.proteus.opendraft`
3. Base64-encode: `base64 -i OpenDraft_AppStore.mobileprovision | pbcopy`
4. Paste into the `IOS_PROVISION_PROFILE` GitHub secret

### How to create an App Store Connect API key

1. Go to appstoreconnect.apple.com → Users and Access → Integrations → App Store Connect API
2. Click "+" to generate a new key with "App Manager" role
3. Download the `.p8` file (only available once!)
4. Base64-encode: `base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy`
5. Note the Key ID and Issuer ID shown on the page
6. Add all three values to GitHub secrets

---

## Local iOS Device Build

**Always use `./build-ios-device.sh` to build and deploy to a physical iOS device.** Do NOT run `tauri ios build` directly — Tauri overwrites Info.plist on every build, stripping file association declarations (CFBundleDocumentTypes, UTImportedTypeDeclarations). The script handles building, patching Info.plist, re-signing, re-exporting the IPA, and installing on the connected device.

```bash
./build-ios-device.sh              # build + patch + install on device
./build-ios-device.sh --no-install # build + patch only (IPA in build/patched-export/)
```

**Always build for physical device in release mode** (the script does this by default).

---

## Local iOS Simulator Build

Building and running on the iOS simulator requires specific steps. **Do NOT use `tauri ios dev`** — it tries to start a new Vite dev server which fails if one is already running (the user runs the dev server in a separate terminal).

### Steps to build and run on iPad simulator

```bash
# 1. Build the frontend first
cd frontend && npm run build && cd ..

# 2. Build the iOS app for the simulator (debug, unsigned)
APPLE_SIGNING_IDENTITY="-" frontend/node_modules/.bin/tauri ios build --target aarch64-sim --debug

# 3. Boot the simulator (pick an iPad device)
xcrun simctl boot "iPad Air 11-inch (M3)"

# 4. Install and launch
xcrun simctl install "iPad Air 11-inch (M3)" src-tauri/gen/apple/build/arm64-sim/OpenDraft.app
xcrun simctl launch "iPad Air 11-inch (M3)" com.proteus.opendraft

# 5. Bring Simulator app to front
open -a Simulator
```

### Common issues

- **"Port 5173 is already in use"** — The user's dev server is running. Never use `tauri ios dev`; always use `tauri ios build` + `simctl install`.
- **"Couldn't recognize the current folder as a Tauri project"** — Run from the project root (`/Users/kandarpbaghar/ai-projects/OpenDraft/`), not from `src-tauri/` or `frontend/`.
- **PhaseScriptExecution failed** — Same root cause as above. Use the CLI build, not Xcode's Run button directly.
- **If `src-tauri/gen/apple` doesn't exist** — Run `frontend/node_modules/.bin/tauri ios init` first.

### macOS desktop (local testing)

```bash
# Unsigned build for local testing (no Apple credentials needed):
APPLE_SIGNING_IDENTITY="-" frontend/node_modules/.bin/tauri build
# Output: src-tauri/target/release/bundle/macos/OpenDraft.app
```
