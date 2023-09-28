const path = require('node:path');

const { Compilation } = require('webpack');

const SVGSpritePlugin = require('svg-sprite-loader/plugin');
const Sprite = require('svg-baker/lib/sprite');
const Chunk = require('webpack/lib/Chunk');
const Promise = require('bluebird');

const hashFunc = require('crypto');

const { MappedList } = require('svg-sprite-loader/lib/utils');

// load .svg from any location except from inside fonts folder
// [\/\\] - macOS/Windows difference fix
const iconRegExp = /(?<!fonts[\/\\].*)\.svg$/;

/** @type {Map<string, boolean>} */
const assetsTypeCacheMap = new Map();

class MSNTSVGSpritePluginCommon extends SVGSpritePlugin {
  constructor(params) {
    super();

    this.processOutput = params.processOutput;
    this.options = {
      /**
       * Whether split into multiple chunks should be enabled
       *
       * This will automatically set to true for production env
       */
      optimize: null,
      /**
       * RegExp which should check whether asses is an icon.
       *
       * Set to non RegExp to skip check.
       */
      iconRegExp,
      /**
       * Whether original assets should be removed
       */
      removeIconAssets: true,
      /**
       * Pattern for output file name.
       *
       * This will be set im
       * compiler.hooks.thisCompilation.tap
       * if no default value is provided
       */
      spriteFilename: null,
      spriteFilenameDev: 'sprite-common-[index].svg',
      spriteFilenameProd: 'sprite-common-[index]-[chunkcode].svg',
      ...params.options,
    };
  }

  /**
   * @param {import('webpack').Compiler} compiler
   */
  apply(compiler) {
    compiler.hooks.thisCompilation.tap(
      'MSNTSVGSpritePluginCommon',
      (compilation) => {
        const isProd = compilation.options.mode === 'production';

        if (!this.options.spriteFilename) {
          this.options.spriteFilename = isProd
            ? this.options.spriteFilenameProd
            : this.options.spriteFilenameDev;
        }

        if (this.options.optimize === null) {
          this.options.optimize = isProd ? true : false;
        }

        compilation.hooks.processAssets.tapAsync(
          {
            name: 'MSNTSVGSpritePluginCommon',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS,
          },
          async (assets, done) => {
            const svgEntryChunks = this.getEntryChunks(compilation);

            const symbolsMap = await this.getSymbolsMap(assets, compilation);

            if (!symbolsMap.items.length) return done();

            await this.proccessAndOutput(
              compilation,
              svgEntryChunks,
              symbolsMap,
              done
            );
          }
        );
      }
    );
  }

  /**
   * Calculates which entry chunks use which icons
   *
   * @param {import('webpack').Compilation} compilation
   * @returns {Map<string, Set<string>>}
   */
  getEntryChunks(compilation) {
    const { context } = compilation.options;

    const svgEntryChunks = new Map();

    compilation.chunks.forEach((chunk) => {
      let entryName = this.options.optimize ? chunk.name : 'single-entry';

      const paths = [...chunk.auxiliaryFiles].filter(
        this.isIconAsset.bind(this)
      );

      const icons = paths.map((n) => {
        const name = compilation.getAsset(n).info.sourceFilename;

        return path.join(context, name);
      });

      icons.forEach((icon) => {
        if (!svgEntryChunks.has(icon)) {
          svgEntryChunks.set(icon, new Set());
        }
        svgEntryChunks.get(icon).add(entryName);
      });
    });

    return svgEntryChunks;
  }

  /**
   * @param {object} assets
   * @param {import('webpack').Compilation} compilation
   * @returns { MappedList }
   */
  async getSymbolsMap(assets, compilation) {
    const { context } = compilation.options;

    await Promise.all(
      Object.entries(assets)
        .filter(([pathname]) => this.isIconAsset(pathname))
        .map(([pathname, source]) => {
          const assetInfo = compilation.assetsInfo.get(pathname);

          if (this.options.removeIconAssets) {
            compilation.deleteAsset(pathname);
          }

          const id = path.basename(assetInfo.sourceFilename, '.svg');
          const iconPath = path.join(context, assetInfo.sourceFilename);

          return this.svgCompiler.addSymbol({
            id,
            path: iconPath,
            content: source.source().toString(),
          });
        })
    );

    return new MappedList(this.svgCompiler.symbols, compilation);
  }

  /**
   *
   * @param { import('webpack').Compilation } compilation
   * @param { Map<string, Set<string>> } svgEntryChunks
   * @param { MappedList } symbolsMap
   * @param { * } done
   */
  proccessAndOutput(compilation, svgEntryChunks, symbolsMap, done) {
    const chunkTargetSetId = this.getSVGChunkID(svgEntryChunks);

    const itemsByEntry = this.getItemsByTargetSet(symbolsMap, chunkTargetSetId);
    const filenames = Object.keys(itemsByEntry);

    const outputConfig = {};

    Promise.map(filenames, (filename) => {
      const spriteSymbols = itemsByEntry[filename].map((item) => item.symbol);

      if (filename.includes('[chunkcode]')) {
        const content = spriteSymbols.map((symbol) => symbol.render()).join('');

        const hash = hashFunc.createHash('md5').update(content).digest('hex');

        filename = filename.replace('[chunkcode]', hash);
      }

      spriteSymbols.forEach((symbol) => {
        outputConfig[symbol.id] = filename;
      });

      return Sprite.create({ symbols: spriteSymbols }).then((sprite) => {
        const content = sprite.render();
        const chunkName = filename.replace(/\.svg$/, '');
        const chunk = new Chunk(chunkName);
        chunk.ids = [];
        chunk.files.add(filename);

        compilation.assets[this.options.publicPath + filename] = {
          source() {
            return content;
          },
          size() {
            return content.length;
          },
        };

        compilation.chunks.add(chunk);
      });
    })
      .then(() => {
        if (this.processOutput && typeof this.processOutput === 'function') {
          this.processOutput(compilation, outputConfig, this.options);
        }

        done();
        return true;
      })
      .catch((e) => done(e));
  }

  /**
   * Checks whether asset is an SVG icon
   *
   * @param {string} iconPath
   * @returns {boolean}
   */
  isIconAsset(iconPath) {
    const cachedResult = assetsTypeCacheMap.get(iconPath);

    if (cachedResult === true) return true;

    let result = false;

    if (iconPath.endsWith('.svg')) {
      if (path.basename(iconPath).startsWith('bg__')) {
        return false;
      }

      if (this.options.iconRegExp instanceof RegExp) {
        result = this.options.iconRegExp.test(iconPath);
      }
    }

    assetsTypeCacheMap.set(iconPath, result);

    return result;
  }

  /**
   * Generates structure required to create sprite files
   *
   * @param {MappedList} symbolsMap
   * @param {Object} chunkTargetSetId
   * @return {Object}
   */
  getItemsByTargetSet(symbolsMap, chunkTargetSetId) {
    // since we have only one sprite rule, we can just use first spriteFilename
    var spriteFilename = this.options.spriteFilename,
      items = {};

    for (var i in chunkTargetSetId) {
      let entrySetName = this.processChunkName(spriteFilename, {
        index: chunkTargetSetId[i],
      });

      items[entrySetName] = [];
    }

    symbolsMap.items.forEach((item) => {
      let entrySetName = this.processChunkName(spriteFilename, {
        index: chunkTargetSetId[item.resource],
      });

      items[entrySetName].push(item);
    });

    return items;
  }

  processChunkName(chunkName, params) {
    for (var i in params) {
      chunkName = chunkName.replace(`[${i}]`, params[i]);
    }

    return chunkName;
  }

  /**
   * Calculates result collection index for every SVG file
   *
   * @param {Map<string, Set<string>>} svgEntryChunk
   * @return {Object}
   */
  getSVGChunkID(svgEntryChunk) {
    var svgChunks = {},
      uniqueChunkNames = {},
      curIndex = 0;

    for (const [name, values] of svgEntryChunk.entries()) {
      let tempName = this.getUniqueCommonChunksName(values);

      if (tempName in uniqueChunkNames) {
        svgChunks[name] = uniqueChunkNames[tempName];
      } else {
        svgChunks[name] = uniqueChunkNames[tempName] = curIndex++;
      }
    }

    return svgChunks;
  }

  /**
   * Returns unique identifier for set of chunks by their name
   *
   * @param {Set<string>} chunks
   * @return {string}
   */
  getUniqueCommonChunksName(entries) {
    return Array.from(entries).join('&');
  }
}

module.exports = MSNTSVGSpritePluginCommon;
