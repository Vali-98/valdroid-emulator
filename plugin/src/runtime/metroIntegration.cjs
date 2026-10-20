const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const {createHash} = require('node:crypto');

// Called only in the Valdroid-owned Metro process, before Expo loads its config.
function installMetroIntegration(sessionFile, cli) {
  const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  const fromProject = createRequire(cli);
  let loader;
  let method;
  // New Expo owns config loading; older versions delegate to metro-config.
  const expoRoot = path.dirname(fromProject.resolve('@expo/metro-config/package.json'));
  const expoLoader = path.join(expoRoot, 'build/config/loadUserConfig.js');
  if (fs.existsSync(expoLoader)) {
    loader = fromProject(expoLoader); method = 'loadUserConfig';
  } else {
    const metroIndex = fromProject.resolve('metro-config');
    loader = fromProject(path.join(path.dirname(metroIndex), 'loadConfig.js')); method = 'loadConfig';
  }
  const original = loader[method];
  if (typeof original !== 'function') throw new Error('This Expo version does not expose a compatible Metro config loader.');
  loader[method] = async function(...args) {
    const config = await original.apply(this, args);
    const {resolveEntryPoint} = fromProject('@expo/config/paths');
    const entryPath = fs.realpathSync(resolveEntryPoint(session.root, {platform: 'android'}));
    const wrapped = wrapMetroConfig(config, {...session, entryPath}, __filename);
    process.stderr.write('[Valdroid] Metro runtime injection enabled; project files are unchanged.\n');
    return wrapped;
  };
}

function wrapMetroConfig(config, session, integrationPath) {
  const transformerPath = path.join(path.dirname(session.runtimePath), 'transformer.cjs');
  const transformer = config.transformer?.babelTransformerPath;
  if (!transformer) throw new Error('Metro has no Babel transformer to wrap for Valdroid.');
  const originalTransformer = createRequire(path.join(session.root, 'package.json')).resolve(transformer);
  const options = {...session, originalTransformer};
  fs.writeFileSync(transformerPath, `module.exports = require(${JSON.stringify(integrationPath)}).createTransformer(${JSON.stringify(options)});\n`);
  const originalResolve = config.resolver?.resolveRequest;
  return {
    ...config,
    watchFolders: [...new Set([config.projectRoot ?? session.root, ...(config.watchFolders ?? []), path.dirname(session.runtimePath)])],
    resolver: {
      ...config.resolver,
      resolveRequest(context, moduleName, platform) {
        if (moduleName === session.runtimePath) return {type: 'sourceFile', filePath: session.runtimePath};
        // Resolve the bundled adapter's external RN import using the app's resolver,
        // not extension dependencies (which must never introduce a second React/RN).
        const origin = context.originModulePath === session.runtimePath
          ? {...context, originModulePath: path.join(session.root, 'package.json')}
          : context;
        return originalResolve ? originalResolve.call(config.resolver, origin, moduleName, platform) : origin.resolveRequest(origin, moduleName, platform);
      },
    },
    transformer: {...config.transformer, babelTransformerPath: transformerPath},
  };
}

function createTransformer(options) {
  const original = require(options.originalTransformer);
  const identifier = name => ({type: 'Identifier', name});
  const string = value => ({type: 'StringLiteral', value});
  return {
    ...original,
    getCacheKey(...args) {
      // Include bridge identity and adapter contents: cached transforms must never
      // connect a new app session to an expired control endpoint.
      return createHash('sha256').update(String(original.getCacheKey?.(...args) ?? ''))
        .update(JSON.stringify(options)).update(fs.readFileSync(options.runtimePath)).digest('hex');
    },
    async transform(args) {
      const result = await original.transform(args);
      if (!args.options.dev || args.options.platform !== 'android' ||
          ['node', 'react-server'].includes(args.options.customTransformOptions?.environment)) return result;
      const filename = path.resolve(args.options.projectRoot ?? options.root, args.filename);
      if (filename !== options.entryPath) {
        try {if (fs.realpathSync(filename) !== options.entryPath) return result;}
        catch {return result;}
      }
      const program = result.ast?.program ?? result.ast;
      if (!Array.isArray(program?.body)) throw new Error('Valdroid cannot inject into this Metro transformer’s AST.');
      // Insert after Babel has transformed the real entry, before Metro collects
      // dependencies. Existing AST locations remain unchanged for source maps.
      // Expo/React Compiler may defer ESM lowering to Metro. A side-effect import
      // must lead that hoisting pass; a normal require would run AFTER app imports.
      program.body.unshift(args.options.experimentalImportSupport ? {
        type: 'ImportDeclaration', specifiers: [], source: string(options.runtimePath),
      } : {
        type: 'IfStatement', test: identifier('__DEV__'), alternate: null,
        consequent: {type: 'BlockStatement', body: [{
          type: 'ExpressionStatement', expression: {
            type: 'CallExpression', callee: identifier('require'), arguments: [string(options.runtimePath)],
          },
        }]},
      });
      return result;
    },
  };
}

module.exports = {installMetroIntegration, wrapMetroConfig, createTransformer};
