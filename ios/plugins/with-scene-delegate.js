// iOS 27 kills apps built with its SDK at launch unless they use the scene life cycle. Expo 57
// ships ExpoAppSceneDelegate for this, but its project template still creates the window in the
// AppDelegate. This does what the SDK 58 template does. Remove it after upgrading to SDK 58.
const fs = require('fs');
const path = require('path');
const {
  IOSConfig,
  withAppDelegate,
  withDangerousMod,
  withInfoPlist,
  withXcodeProject,
} = require('expo/config-plugins');

const SCENE_DELEGATE = `internal import Expo

@objc(SceneDelegate)
class SceneDelegate: ExpoAppSceneDelegate {}
`;

const LEGACY_WINDOW = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)[\s\S]*?#endif\n/;

module.exports = function withSceneDelegate(config) {
  config = withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return config;
  });

  config = withAppDelegate(config, (config) => {
    let src = config.modResults.contents;
    if (!src.includes('ExpoReactNativeFactoryProvider')) {
      src = src.replace(
        'class AppDelegate: ExpoAppDelegate {',
        'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {'
      );
    }
    // SceneDelegate creates the window and starts React Native.
    src = src.replace(LEGACY_WINDOW, '');
    if (!src.includes('ExpoReactNativeFactoryProvider') || LEGACY_WINDOW.test(src)) {
      throw new Error('with-scene-delegate: AppDelegate.swift no longer matches the SDK 57 template');
    }
    config.modResults.contents = src;
    return config;
  });

  config = withDangerousMod(config, [
    'ios',
    (config) => {
      const dir = path.join(config.modRequest.platformProjectRoot, config.modRequest.projectName);
      fs.writeFileSync(path.join(dir, 'SceneDelegate.swift'), SCENE_DELEGATE);
      return config;
    },
  ]);

  config = withXcodeProject(config, (config) => {
    const name = config.modRequest.projectName;
    const filepath = `${name}/SceneDelegate.swift`;
    if (!config.modResults.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath,
        groupName: name,
        project: config.modResults,
      });
    }
    return config;
  });

  return config;
};
