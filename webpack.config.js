const path = require('path');
const fs = require('fs');
const CopyPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const ZipPlugin = require('zip-webpack-plugin');
const package = require('./package.json');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');

// Google OAuth client values live outside the repo: `oauth.local.json` (gitignored)
// or GOOGLE_OAUTH_* environment variables for CI. They are injected below with
// DefinePlugin. Missing config is not an error — the values become empty strings and
// sync reports itself as unconfigured.
function loadOAuthConfig() {
	let file = {};
	const path_ = path.resolve(__dirname, 'oauth.local.json');
	if (fs.existsSync(path_)) {
		try {
			file = JSON.parse(fs.readFileSync(path_, 'utf8'));
		} catch (error) {
			console.warn('[build] oauth.local.json is not valid JSON — ignoring it.', error.message);
		}
	}
	const config = {
		webClientId: process.env.GOOGLE_OAUTH_WEB_CLIENT_ID || file.webClientId || '',
		nativeClientId: process.env.GOOGLE_OAUTH_NATIVE_CLIENT_ID || file.nativeClientId || '',
		nativeClientSecret: process.env.GOOGLE_OAUTH_NATIVE_CLIENT_SECRET || file.nativeClientSecret || '',
		// GitHub App credentials are user-supplied in Settings (never baked in).
	};
	if (!config.webClientId || !config.nativeClientId || !config.nativeClientSecret) {
		console.warn('[build] No Google OAuth config found — Drive sync will be disabled in this build. See oauth.local.example.json.');
	}
	return config;
}

// Remove .DS_Store files
function removeDSStore(dir) {
	const files = fs.readdirSync(dir);
	files.forEach(file => {
		const filePath = path.join(dir, file);
		if (fs.statSync(filePath).isDirectory()) {
			removeDSStore(filePath);
		} else if (file === '.DS_Store') {
			fs.unlinkSync(filePath);
		}
	});
}

module.exports = (env, argv) => {
	const isFirefox = env.BROWSER === 'firefox';
	const isSafari = env.BROWSER === 'safari';
	const isProduction = argv.mode === 'production';

	const getOutputDir = () => {
		if (isProduction) {
			return isFirefox ? 'dist_firefox' : (isSafari ? 'dist_safari' : 'dist');
		} else {
			return isFirefox ? 'dev_firefox' : (isSafari ? 'dev_safari' : 'dev');
		}
	};

	const outputDir = getOutputDir();
	const browserName = isFirefox ? 'firefox' : (isSafari ? 'safari' : 'chrome');
	const oauth = loadOAuthConfig();

	const mainConfig = {
		mode: argv.mode,
		entry: {
			popup: './src/core/popup.ts',
			settings: './src/core/settings.ts',
			highlights: './src/core/highlights/index.ts',
			'reader-page': './src/core/reader-view.ts',
			content: './src/content.ts',
			background: './src/background.ts',
			style: './src/style.scss',
			'highlights-tailwind': './src/highlights-tailwind.scss',
			highlighter: './src/highlighter.scss',
			reader: './src/reader.scss',
			'reader-script': './src/reader-script.ts',
			diagram: './src/diagram.tsx',
			'video-excalidraw': './src/video-excalidraw.tsx'
		},
		output: {
			path: path.resolve(__dirname, outputDir),
			filename: '[name].js',
			module: false,
		},
		// Persistent on-disk cache: module compilation is reused across runs, so a
		// small change only recompiles what changed instead of the whole tree.
		// Invalidated automatically when this config changes.
		cache: {
			type: 'filesystem',
			buildDependencies: { config: [__filename] }
		},
		devtool: isProduction ? false : 'source-map',
		optimization: {
			minimize: true,
			minimizer: [
				new TerserPlugin({
					terserOptions: {
						mangle: false,
						compress: {
							defaults: true,
							global_defs: {
								DEBUG_MODE: !isProduction
							},
							unused: true,
							dead_code: true,
							passes: 2,
							ecma: 2020,
							module: false
						},
						format: {
							ascii_only: true,
							comments: false,
							ecma: 2020
						},
						module: false,
						toplevel: true,
						keep_classnames: true,
						keep_fnames: true
					},
					extractComments: false
				})
			],
			moduleIds: 'named',
			chunkIds: 'named'
		},
		experiments: {
			outputModule: false,
		},
		resolve: {
			extensions: ['.ts', '.tsx', '.js'],
			alias: {
				'./utils/browser-polyfill': path.resolve(__dirname, 'node_modules/webextension-polyfill/dist/browser-polyfill.min.js'),
				'../utils/browser-polyfill': path.resolve(__dirname, 'node_modules/webextension-polyfill/dist/browser-polyfill.min.js')
			}
		},
		module: {
			rules: [
				{
					test: /\.m?js$/,
					resolve: {
						fullySpecified: false,
					},
				},
				{
					test: /\.tsx?$/,
					use: [
						{
							loader: 'ts-loader',
							options: {
								// Skip type-checking during the build (the slowest part of
								// ts-loader); rely on the editor / `tsc` for types. Big speedup.
								transpileOnly: true,
								compilerOptions: {
									module: 'ES2020'
								}
							}
						}
					],
					exclude: /node_modules/,
				},
				{
					// Fonts referenced via url() in SCSS (e.g. highlights-tailwind.scss)
					// are emitted to dist/fonts/ and their url() rewritten accordingly.
					test: /\.woff2?$/,
					type: 'asset/resource',
					generator: { filename: 'fonts/[name][ext]' }
				},
				{
					test: /\.scss$/,
					use: [
						MiniCssExtractPlugin.loader,
						{
							loader: 'css-loader',
							options: {
								sourceMap: !isProduction
							}
						},
						{
							loader: 'postcss-loader',
							options: {
								sourceMap: !isProduction
							}
						},
						{
							loader: 'sass-loader',
							options: {
								sourceMap: !isProduction
							}
						}
					]
				}
			]
		},
		plugins: [
			new CopyPlugin({
				patterns: [
					{ 
						from: isFirefox ? "src/manifest.firefox.json" : 
							  (isSafari ? "src/manifest.safari.json" : "src/manifest.chrome.json"), 
						to: "manifest.json" 
					},
					{ from: "src/popup.html", to: "popup.html" },
					{ from: "src/side-panel.html", to: "side-panel.html" },
					{ from: "src/settings.html", to: "settings.html" },
					{ from: "src/highlights.html", to: "highlights.html" },
					{ from: "src/reader.html", to: "reader.html" },
					{ from: "src/diagram.html", to: "diagram.html" },
					{ from: "src/video-excalidraw.html", to: "video-excalidraw.html" },
					{ from: "src/icons", to: "icons" },
					{ from: "node_modules/webextension-polyfill/dist/browser-polyfill.min.js", to: "browser-polyfill.min.js" },
					{ from: "src/flatten-shadow-dom.js", to: "flatten-shadow-dom.js" },
					{ from: "src/vps-scrubber-patch.js", to: "vps-scrubber-patch.js" },
					{
						from: 'src/_locales',
						to: '_locales'
					},
					{ from: "node_modules/@excalidraw/excalidraw/dist/prod/index.css", to: "excalidraw.css" },
					{ from: "node_modules/@excalidraw/excalidraw/dist/prod/fonts", to: "fonts" }
				],
			}),
			new MiniCssExtractPlugin({
				filename: '[name].css'
			}),
			{
				apply: (compiler) => {
					compiler.hooks.afterEmit.tap('RemoveDSStore', (compilation) => {
						removeDSStore(path.resolve(__dirname, outputDir));
					});
				}
			},
			new webpack.DefinePlugin({
				'process.env.NODE_ENV': JSON.stringify(argv.mode),
				'DEBUG_MODE': JSON.stringify(!isProduction),
				'OAUTH_WEB_CLIENT_ID': JSON.stringify(oauth.webClientId),
				'OAUTH_NATIVE_CLIENT_ID': JSON.stringify(oauth.nativeClientId),
				'OAUTH_NATIVE_CLIENT_SECRET': JSON.stringify(oauth.nativeClientSecret)
			}),
			...(isProduction ? [
				new ZipPlugin({
					path: path.resolve(__dirname, 'builds'),
					filename: `scholiast-${package.version}-${browserName}.zip`,
				})
			] : [])
		]
	};

	return mainConfig;
};
