#!/usr/bin/env node
/**
 * Checks what `expo prebuild` generated, after it has run:
 *
 *     npx expo prebuild --no-install && node tools/ci/check-native-config.mjs
 *
 * The native projects are generated, not committed, so a config plugin that
 * silently stops applying is only noticed when an app fails on a device. The
 * one that matters most is the UIScene adoption: without it iOS 27 kills the
 * app at launch. Checked here:
 *
 * - iOS: AppDelegate hands window creation to Expo's scene delegate, and
 *   Info.plist declares the scene manifest (plugins/withSceneLifecycle.js);
 *   the Icon Composer icon was copied in with both glass layers;
 * - both: the microphone permission and its explanation are present.
 *
 * Pass `ios` or `android` to check one platform only.
 */
import { existsSync, readFileSync } from 'node:fs';

const only = process.argv[2];
const failures = [];
const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);
const requireThat = (condition, message) => { if (!condition) failures.push(message); };

if (!only || only === 'ios') {
  const delegate = read('ios/Ponticello/AppDelegate.swift');
  const plist = read('ios/Ponticello/Info.plist');
  requireThat(delegate, 'ios/Ponticello/AppDelegate.swift was not generated — did prebuild run?');
  if (delegate) {
    requireThat(delegate.includes('ExpoReactNativeFactoryProvider'),
      'AppDelegate does not conform to ExpoReactNativeFactoryProvider — withSceneLifecycle did not apply');
    requireThat(!/window = UIWindow\(frame:/.test(delegate),
      'AppDelegate still creates its own window — iOS 27 needs the scene delegate to');
  }
  requireThat(plist, 'ios/Ponticello/Info.plist was not generated');
  if (plist) {
    requireThat(plist.includes('UIApplicationSceneManifest') && plist.includes('EXExpoAppSceneDelegate'),
      'Info.plist has no scene manifest naming EXExpoAppSceneDelegate — the app will not launch on iOS 27');
    requireThat(plist.includes('NSMicrophoneUsageDescription'), 'Info.plist has no microphone usage description');
  }
  const icon = read('ios/Ponticello/expo.icon/icon.json');
  requireThat(icon, 'the Icon Composer icon was not copied into ios/Ponticello/expo.icon');
  for (const layer of ['ponticello-bridge.svg', 'ponticello-strings.svg']) {
    requireThat(existsSync(`ios/Ponticello/expo.icon/Assets/${layer}`), `the iOS icon is missing its ${layer} layer`);
  }
}

if (!only || only === 'android') {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  requireThat(manifest, 'android/app/src/main/AndroidManifest.xml was not generated — did prebuild run?');
  if (manifest) {
    requireThat(manifest.includes('android.permission.RECORD_AUDIO'), 'AndroidManifest has no RECORD_AUDIO permission');
    requireThat(manifest.includes('com.bermeo.ponticello') || read('android/app/build.gradle')?.includes('com.bermeo.ponticello'),
      'the Android package is not com.bermeo.ponticello');
  }
}

if (failures.length) {
  console.error('✗ Native configuration:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log(`✓ Native configuration (${only ?? "ios and android"}): ${only === "android" ? "permissions and package" : "scene lifecycle, icon, permissions"} in place.`);
