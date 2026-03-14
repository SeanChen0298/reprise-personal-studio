const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the entire monorepo so Metro can resolve workspace packages
config.watchFolders = [monorepoRoot];

// Tell Metro to look in both the app's node_modules and the monorepo root's node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Force react and react-native to always resolve from the app's own node_modules.
// pnpm's isolated node_modules can cause Metro to find multiple copies, leading to
// "Cannot read property 'useMemo' of null" / "Invalid hook call" errors.
const reactPath = path.resolve(projectRoot, 'node_modules/react');
const reactNativePath = path.resolve(projectRoot, 'node_modules/react-native');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react') {
    return { filePath: path.resolve(reactPath, 'index.js'), type: 'sourceFile' };
  }
  if (moduleName === 'react-native') {
    return { filePath: path.resolve(reactNativePath, 'index.js'), type: 'sourceFile' };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
