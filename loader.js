const path = require('path');

const MSNTSVGSpritePluginCommon = require('msnt-svg-sprite-loader-common/plugin');

const { getOptions } = require('loader-utils');

module.exports = function (content) {
  const options = getOptions(this);

  const loaderContext = this;
  const compiler = loaderContext._compiler;
  const isChildCompiler = compiler.isChild();
  const parentCompiler = isChildCompiler
    ? compiler.parentCompilation.compiler
    : null;

  let targetCompiler = parentCompiler ?? compiler;

  const plugin = targetCompiler.options.plugins.find(
    (p) => p instanceof MSNTSVGSpritePluginCommon
  );

  let iconUsageMap = plugin.svgCompiler.usageMap;

  let entryName;

  if (options && options.optimize) {
    let module = this._module;
    while (module.issuer) {
      module = module.issuer;
    }
    entryName = path.basename(module.resource, '.css');
  } else {
    entryName = 'single-entry';
  }

  if (!iconUsageMap) {
    iconUsageMap = plugin.svgCompiler.usageMap = {};
  }

  if (!iconUsageMap[this.resourcePath]) {
    iconUsageMap[this.resourcePath] = [entryName];
  } else if (options && options.optimize) {
    iconUsageMap[this.resourcePath].push(entryName);
  }

  return content;
};
