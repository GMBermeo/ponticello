/**
 * Adopt the UIScene life cycle on iOS.
 *
 * iOS 27 asserts at launch — a SIGTRAP in
 * `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` — unless the
 * app declares a scene manifest. Expo 57.0.25 ships the scene delegate
 * (`ExpoAppSceneDelegate`) but its prebuild template does not yet wire it up,
 * so this plugin does, keeping `expo prebuild --clean` reproducible:
 *
 * - Info.plist gains a `UIApplicationSceneManifest` naming the delegate;
 * - AppDelegate conforms to `ExpoReactNativeFactoryProvider` and stops
 *   creating the window itself — the scene delegate creates it from the
 *   connecting scene and starts React Native into it.
 *
 * Delete this plugin once the template does the same.
 */
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const SCENE_DELEGATE = 'EXExpoAppSceneDelegate';

function withSceneManifest(config) {
  return withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: SCENE_DELEGATE,
          },
        ],
      },
    };
    return mod;
  });
}

const WINDOW_BLOCK = /#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

function withSceneAppDelegate(config) {
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== 'swift') {
      throw new Error('withSceneLifecycle: expected a Swift AppDelegate');
    }
    let source = mod.modResults.contents;
    if (source.includes('ExpoReactNativeFactoryProvider')) return mod;

    source = source.replace(
      'class AppDelegate: ExpoAppDelegate {',
      'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {',
    );
    if (!WINDOW_BLOCK.test(source)) {
      throw new Error('withSceneLifecycle: AppDelegate template changed; update the window block pattern');
    }
    source = source.replace(
      WINDOW_BLOCK,
      '    // The window is created by the scene delegate (EXExpoAppSceneDelegate),\n'
      + '    // which starts React Native into it — see plugins/withSceneLifecycle.js.\n',
    );
    mod.modResults.contents = source;
    return mod;
  });
}

module.exports = function withSceneLifecycle(config) {
  return withSceneAppDelegate(withSceneManifest(config));
};
