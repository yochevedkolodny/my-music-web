# My Music — private iPhone beta

This repository keeps the current GitHub Pages music app intact and adds a separate Capacitor iOS build path. The existing HTML app is copied into a local iOS web bundle; no music is uploaded or moved by these build scripts.

## What is ready
- Capacitor project configuration and scripts for building the existing interface on iOS.
- An independent native build directory so GitHub Pages can keep publishing normally.
- Automatic or manual light/dark mode and current local-library functionality in the bundled interface.

## What is NOT ready
- This is **not yet a distributable native iPhone app**. A signed Xcode archive, Apple developer team, and TestFlight setup are still required.
- Web IndexedDB music is **not automatically migrated** into native app storage. Users must keep original audio files and a verified backup.
- iOS background audio, lock-screen remote controls, durable native audio storage, Files Share Extension, and reliable file import need native implementations and device testing.
- Do not submit this as a paid/public app until those capabilities, accessibility, privacy information, and restore tests are complete.

## Build on a Mac or macOS cloud runner
1. Install Node.js 20+ and Xcode (with command line tools).
2. Run `npm install`.
3. Run `npm run native:ios:add` once.
4. Run `npm run native:ios:sync` after updating the web UI.
5. Run `npm run native:ios:open` to configure signing and capabilities in Xcode.
6. Use an Apple Developer Program team for signing and TestFlight distribution.

**Important:** The app ID `com.mymusic.privateplayer` is a provisional placeholder. Set a unique final bundle identifier in Capacitor config and Xcode before registering the app in App Store Connect.

## Migration and release checklist
- [ ] Native storage/import pipeline with security-scoped Files access and a Share Extension
- [ ] iOS background audio capability, lock-screen metadata, remote transport controls
- [ ] Export from the existing web app; verify archive integrity and import into native storage
- [ ] Playback testing: locked screen, interruption handling, Bluetooth, headset, queue, repeat
- [ ] TestFlight internal build and device smoke tests
- [ ] Privacy policy, support contact, screenshots and public distribution decisions

The current public web app remains at https://yochevedkolodny.github.io/my-music-web/.
