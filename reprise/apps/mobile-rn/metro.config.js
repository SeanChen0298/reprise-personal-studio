// The app is installed with npm on its own (outside the pnpm workspace), so
// node_modules is flat and React Native autolinking works as Expo expects.
// The only thing shared with the desktop is @reprise/shared/core (types and
// pure helpers — no furigana generation), read straight from its source.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, "../../packages/shared");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [sharedRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

const sharedCore = path.join(sharedRoot, "src/core.ts");
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@reprise/shared/core") return { type: "sourceFile", filePath: sharedCore };
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
