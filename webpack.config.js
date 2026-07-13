// webpack.config.js
const nodeExternals = require('webpack-node-externals');
const fs = require('node:fs');
const glob = require('glob');

const modules = glob.sync('./node_modules/*/package.json', {
  ignore: ['node_modules/.*/**'],
});
const packages = modules
  .map((module) => {
    try {
      return JSON.parse(fs.readFileSync(module, 'utf8'));
    } catch {
      return null;
    }
  })
  .filter(Boolean);

const allowlist = packages
  .filter((packageJson) => packageJson.type === 'module')
  .map((packageJson) => packageJson.name)
  .filter(Boolean)
  .map((name) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

module.exports = function (options) {
  return {
    ...options,
    entry: options.entry,
    externals: [nodeExternals({ allowlist })],
    resolve: {
      ...options.resolve,
      extensionAlias: {
        '.js': ['.ts', '.js'],
      },
    },
    output: {
      ...options.output,
      libraryTarget: 'commonjs2',
    },
  };
};
