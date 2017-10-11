const SVGSpritePlugin = require('svg-sprite-loader/plugin');
const Sprite = require('svg-baker/lib/sprite');
const Chunk = require('webpack/lib/Chunk');
const Promise = require('bluebird');

const {
  MappedList,
} = require('svg-sprite-loader/lib/utils');

class MSNTSVGSpritePluginCommon extends SVGSpritePlugin {

  constructor(params) {
    super();

    this.processOutput = params.processOutput;
    this.options = params.options;
  }
  
  apply(compiler) {
    const plugin = this;
    const { symbols } = this.svgCompiler;

    let svgEntryChunks,
        symbolsMap;
    
    compiler.plugin('this-compilation', compilation => {
      // Share plugin with loader
      compilation.plugin('normal-module-loader', (loaderContext) => {
        loaderContext[this.NAMESPACE] = plugin;
      });
      
      // all required modules are processed, time to get
      // information about svg symbols usage
      compilation.plugin('optimize', modules => {
        symbolsMap = new MappedList(symbols, compilation);
        svgEntryChunks = this.getEntryChunks(symbolsMap.items)
      });

      compilation.plugin('additional-assets', done => {
        if (!symbolsMap.items.length) {
          done();
          return true;
        }
        
        const chunkTargetSetId = this.getSVGChunkID(svgEntryChunks);

        const itemsByEntry = this.getItemsByTargetSet(symbolsMap, chunkTargetSetId);
        const filenames = Object.keys(itemsByEntry);
        
        const outputConfig = this.getOutputConfig(symbolsMap, svgEntryChunks, chunkTargetSetId);

        if (this.processOutput && typeof this.processOutput === 'function') {
          this.processOutput(outputConfig);
        }

        return Promise.map(filenames, (filename) => {
          const spriteSymbols = itemsByEntry[filename].map(item => item.symbol);

          return Sprite.create({ symbols: spriteSymbols })
            .then((sprite) => {
              const content = sprite.render();
              const chunkName = filename.replace(/\.svg$/, '');
              const chunk = new Chunk(chunkName);
              chunk.ids = [];
              chunk.files.push(filename);

              compilation.assets[plugin.options.publicPath + filename] = {
                source() { return content; },
                size() { return content.length; }
              };

              compilation.chunks.push(chunk);
            });
        }).then(() => {
          done();
          return true;
        }).catch(e => done(e));
      });
    });
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
    var spriteFilename = symbolsMap.items[0].spriteFilename,
        items = {};

    for (var i in chunkTargetSetId) {
      let entrySetName = this.processChunkName(spriteFilename, {
        index: chunkTargetSetId[i]
      });

      items[entrySetName] = [];
    }

    symbolsMap.items.forEach(item => {
      let entrySetName = this.processChunkName(spriteFilename, {
        index: chunkTargetSetId[item.resource]
      });

      items[entrySetName].push(item);
    });

    return items;
  }

  getOutputConfig(symbolsMap, svgEntryChunks, chunkTargetSetId) {
    var sybmbolItems = symbolsMap.items,
        spriteFilename = sybmbolItems[0].spriteFilename,
        symbolsBySvgEntry = {},
        result = {};

    for (var svgEntry in svgEntryChunks) {
      var chunks = svgEntryChunks[svgEntry];

      chunks.forEach(chunk => {
        var sybmbols,
            curResult = result[chunk.name],
            setName = this.processChunkName(spriteFilename, {
              index: chunkTargetSetId[svgEntry]
            });

        if (!curResult) {
          curResult = result[chunk.name] = {
            sets: [],
          };
        }

        if (!symbolsBySvgEntry[svgEntry]) {
          symbolsBySvgEntry[svgEntry] = sybmbolItems
            .filter(item => item.resource === svgEntry)
            .map(item => item.symbol.id);
        }

        sybmbols = symbolsBySvgEntry[svgEntry];

        sybmbols.forEach(symbol => {
          curResult[symbol] = setName;
        });

        curResult.sets.push(setName)
      });
    }

    return result;
  }

  processChunkName(chunkName, params) {
    for (var i in params) {
      chunkName = chunkName.replace(`[${i}]`, params[i]);
    }
    
    return chunkName;
  }

  /**
   * Finds entry chunks for each SVG file
   * 
   * @param {Array} requiredSVG 
   * @return {Object}
   */
  getEntryChunks(requiredSVG) {
    var result = {};

    requiredSVG.forEach(svg => {
      const path = svg.resource,
            svgModule = svg.module;

      result[path] = new Set();

      svgModule.reasons.forEach(reason => {
        var module = reason.module;

        while (module.issuer) {
          module = module.issuer;
        }

        if (!module.chunks || module.chunks > 0) {
          new Error(`Cannot find entry chunk for module "${module.resource}"`);
        }

        result[path].add(module.chunks[0]);
      });
    });


    return result;
  }

  /**
   * Calculates result collection index for every SVG file
   * 
   * @param {Object} svgEntryChunk 
   * @return {Object}
   */
  getSVGChunkID(svgEntryChunk) {
    var svgChunks = {},
        uniqueChunkNames = {},
        curIndex = 0;

    for (var i in svgEntryChunk) {
      let tempName = this.getUniqueCommonChunksName(svgEntryChunk[i]); 

      if (tempName in uniqueChunkNames) {
        svgChunks[i] = uniqueChunkNames[tempName];
      } else {
        svgChunks[i] = uniqueChunkNames[tempName] = curIndex++;
      }
    }

    return svgChunks;
  }

  /**
   * Returns unique identifier for set of chunks by their name
   * 
   * @param {Map} chunks 
   * @return {string}
   */
  getUniqueCommonChunksName(chunks) {
    return Array.from(chunks)
      .map(chunk => chunk.name)
      .join('&');
  }
}

module.exports = MSNTSVGSpritePluginCommon;