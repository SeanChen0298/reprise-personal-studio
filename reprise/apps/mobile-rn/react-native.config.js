/**
 * Override for expo's android autolinking.
 *
 * expo-modules-autolinking auto-generates `packageImportPath` from the build.gradle namespace
 * ("expo.core") when it can't evaluate expo's react-native.config.js in a pnpm workspace.
 * The actual Kotlin class is in `expo.modules`, so we override it here.
 */
module.exports = {
  dependencies: {
    expo: {
      platforms: {
        android: {
          packageImportPath: 'import expo.modules.ExpoModulesPackage;',
        },
      },
    },
  },
};
