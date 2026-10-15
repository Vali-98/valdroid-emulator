const esbuild = require("esbuild");

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
	const shared = {
		bundle: true,
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
			'src/webview.tsx'
		],
		format: 'iife',
		platform: 'browser',
		outfile: 'dist/webview.js',
		...shared,
	});
	const consoleCtx = await esbuild.context({
		entryPoints: ['src/console.tsx'],
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
		await extensionCtx.rebuild();
		await webviewCtx.rebuild();
		await consoleCtx.rebuild();
		await extensionCtx.dispose();
		await webviewCtx.dispose();
		await consoleCtx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
