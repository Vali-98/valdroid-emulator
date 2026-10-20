const esbuild = require("esbuild");
const fs = require('node:fs');
const { dependencyNotices } = require('./scripts/third-party.cjs');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	await esbuild.build({entryPoints: ['src/runtime/expoLifecycle.cjs'], bundle: true, platform: 'node', format: 'cjs', outfile: 'dist/expo-lifecycle.cjs'});
	await esbuild.build({entryPoints: ['src/runtime/metroIntegration.cjs', 'src/runtime/metroPreload.cjs'], bundle: true, external: ['./metroIntegration.cjs'], platform: 'node', format: 'cjs', outdir: 'dist', outExtension: {'.js': '.cjs'}});
	await esbuild.build({entryPoints: ['src/runtime/expoReporter.cjs'], bundle: true, platform: 'node', format: 'cjs', outfile: 'dist/expo-reporter.cjs'});
	const scan = await esbuild.build({entryPoints: ['src/runtime/reactScan.js'], bundle: true, platform: 'browser', external: ['react-native'], format: 'cjs', outfile: 'dist/react-scan-runtime.js', metafile: true});
	const shared = {
		bundle: true,
		metafile: true,
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin,
		],
	};

	const extensionCtx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		format: 'cjs',
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		...shared,
	});

	const webviewCtx = await esbuild.context({
		entryPoints: [
			'src/webviews/emulator/index.tsx'
		],
		format: 'iife',
		platform: 'browser',
		outfile: 'dist/webview.js',
		...shared,
	});
	const consoleCtx = await esbuild.context({
		entryPoints: ['src/webviews/console/index.tsx'],
		format: 'iife',
		platform: 'browser',
		outfile: 'dist/console.js',
		...shared,
	});
	if (watch) {
		await extensionCtx.watch();
		await webviewCtx.watch();
		await consoleCtx.watch();
	} else {
		const extension = await extensionCtx.rebuild();
		const webview = await webviewCtx.rebuild();
		const consoleView = await consoleCtx.rebuild();
		fs.writeFileSync('dist/THIRD_PARTY_NOTICES.txt', dependencyNotices([
			extension.metafile, webview.metafile, consoleView.metafile, scan.metafile,
		]));
		await extensionCtx.dispose();
		await webviewCtx.dispose();
		await consoleCtx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
