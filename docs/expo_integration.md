# Expo Integration — Implementation Notes

User-facing features: [Expo.md](Expo.md).

## Current implementation

- Expo Android: build APK → install → Metro → launch → connect.
- Runtime injection, React Scan, inspector, hierarchy, and structured JS logs.
- Lifecycle controls, stream reconnection, device settings, and screen capture.
- Experimental background Hermes debugging with on-screen pause controls.

## Keep these boundaries

- `ExpoSession` coordinates; `ExpoProcesses` owns processes; `expoLifecycle.cjs`
  uses the project's Expo CLI APIs for build/launch.
- Metro injection lives in extension storage; no app entry/config/dependency edits.
- Verify cached APK identity/hash; reinstall preserves data. Never auto-uninstall.
  Clean rebuild means Gradle clean, not Expo prebuild `--clean`.
- Keep generic emulator use independent of Expo. Reconnect only restarts streaming.
- Inspector/log source links must resolve to verified project files.

## Remaining work

- Stabilize Hermes breakpoints/source maps and reconnect after unexpected disconnects.
- Add permissions, animation settings, and device reboot. Language remains deferred.
- Add Redux Toolkit/RTK Query and TanStack Query panels with explicit store/client registration.
- Add Expo Router navigation and Storybook source actions.
- Add rolling replay and recording audio (currently video-only, three-minute limit).
- Support nested/monorepo apps, hoisted dependencies, and trusted shared source roots.
- Extend launch support to bare React Native, Expo Go, and external Metro sessions.

Expo/Metro private APIs and React inspection are version-sensitive; validate against real apps.
