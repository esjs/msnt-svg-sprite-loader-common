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

  plugin.msntLoaderOptions = options;

  return content;
};
