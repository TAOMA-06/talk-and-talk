import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import webpack from 'webpack';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import { createRequire } from 'node:module';
import { primitives } from './primitives.mjs';

const require = createRequire(import.meta.url);
const { GlassEaselMiniprogramWebpackPlugin, GlassEaselMiniprogramWxmlLoader, GlassEaselMiniprogramWxssLoader } = require('glass-easel-miniprogram-webpack-plugin');
const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../miniprogram');
const generated = path.join(here, '.generated');
const output = path.resolve(here, '../web/public/mini');
await fs.mkdir(generated, { recursive: true });
await fs.mkdir(output, { recursive: true });
const app = JSON.parse(await fs.readFile(path.join(source, 'app.json'), 'utf8'));
const pageConfigs = Object.fromEntries(await Promise.all(app.pages.map(async (route) => [route, JSON.parse(await fs.readFile(path.join(source, `${route}.json`), 'utf8'))])));
const evidence = { source: 'frontend/miniprogram', pages: [...app.pages], components: { ...app.usingComponents }, files: {} };
async function copy(relative = '') {
  for (const entry of await fs.readdir(path.join(source, relative), { withFileTypes: true })) {
    const item = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.git', 'typings'].includes(entry.name)) await copy(item);
    } else if (/\.(ts|js|json|wxml|wxss|png|jpg|jpeg|svg|webp|gif)$/.test(item)) {
      const bytes = await fs.readFile(path.join(source, item));
      evidence.files[item] = crypto.createHash('sha256').update(bytes).digest('hex');
      await fs.mkdir(path.dirname(path.join(generated, item)), { recursive: true });
      let content = bytes;
      if (item.endsWith('.wxml')) {
        content = bytes.toString().replace(/style="([^"]*)"/g, (_, style) => `style="${style.replace(/(\{\{.*?\}\})rpx/g, 'calc($1 * 100vw / 750)').replace(/(-?\d*\.?\d+)rpx/g, (_, value) => `${Number(value) / 7.5}vw`)}"`);
        // Browser-backed view components also bubble native taps. A forwarding
        // component must stop that original event after emitting its own tap.
        if (/^components\/tt-(card-shell|media-card|scene-card|list-cell)\/index.wxml$/.test(item)) content = content.replace('bindtap="onTap"', 'catchtap="onTap"');
      }
      if (app.pages.some((page) => `${page}.json` === item)) {
        const config = JSON.parse(bytes);
        config.usingComponents ??= {};
        config.styleIsolation = 'apply-shared';
        content = JSON.stringify(config);
      }
      await fs.writeFile(path.join(generated, item), content);
    }
  }
}
await copy();
const primitiveComponents = {};
for (const [name, primitive] of Object.entries(primitives)) {
  const base = path.join(generated, 'browser-primitives', name);
  await fs.mkdir(path.dirname(base), { recursive: true });
  await fs.writeFile(`${base}.json`, JSON.stringify({ component: true, styleIsolation: 'shared' }));
  await fs.writeFile(`${base}.js`, primitive.script || 'Component({});');
  await fs.writeFile(`${base}.wxml`, (primitive.template || '<slot/>').replace(/\b(bind|catch)([a-z]\w*)=/g, '$1:$2='));
  await fs.writeFile(`${base}.wxss`, primitive.styles || ':host { display: block; }');
  primitiveComponents[name] = `/browser-primitives/${name}`;
}
for (const item of Object.keys(evidence.files).filter((item) => /^(pages|components)\/.+\.json$/.test(item))) {
  const target = path.join(generated, item);
  const config = JSON.parse(await fs.readFile(target, 'utf8'));
  config.usingComponents = { ...primitiveComponents, ...config.usingComponents };
  await fs.writeFile(target, JSON.stringify(config));
}
await fs.writeFile(path.join(generated, 'app.json'), JSON.stringify(app));
await fs.writeFile(path.join(generated, 'browser-config.json'), JSON.stringify({ ...app, pageConfigs, theme: JSON.parse(await fs.readFile(path.join(source, 'theme.json'), 'utf8')).light }));
const config = {
  mode: 'production', context: here,
  entry: './entry.cjs', devtool: 'source-map',
  output: { path: output, filename: 'runtime.js', publicPath: '/mini/' },
  resolve: { extensions: ['.ts', '.js', '.cjs'], modules: [path.join(here, 'node_modules'), 'node_modules'] },
  resolveLoader: { modules: [path.join(here, 'node_modules')] },
  module: { rules: [
    { test: /\.ts$/, loader: path.join(here, 'typescript-loader.cjs'), exclude: /node_modules/ },
    { test: /\.wxml$/, use: GlassEaselMiniprogramWxmlLoader, exclude: /node_modules/ },
    { test: /\.wxss$/, use: [MiniCssExtractPlugin.loader, { loader: 'css-loader', options: { url: false } }, GlassEaselMiniprogramWxssLoader, { loader: 'less-loader', options: { lessOptions: { math: 'always' } } }], exclude: /node_modules/ }
  ] },
  plugins: [new MiniCssExtractPlugin({ filename: 'runtime.css' }), new GlassEaselMiniprogramWebpackPlugin({
    path: generated, customBootstrap: true, tagNamePrefix: 'wx-', resourceFilePattern: /\.(png|jpg|jpeg|svg|webp|gif)$/, defaultEntry: 'pages/consent/index'
  })],
  optimization: { minimize: true },
};
await new Promise((resolve, reject) => webpack(config, (error, stats) => {
  if (error || stats.hasErrors()) return reject(error || new Error(stats.toString({ all: false, errors: true })));
  console.log(stats.toString({ all: false, timings: true, assets: true, warnings: true }));
  resolve();
}));
for (const file of ['index.html', 'app.html', 'shell.css']) await fs.copyFile(path.join(here, file), path.join(output, file));
const notices = await Promise.all(['glass-easel', 'glass-easel-miniprogram-adapter'].map(async (name) => `${name}\n${await fs.readFile(path.join(here, 'node_modules', name, 'LICENSE'), 'utf8')}`));
await fs.writeFile(path.join(output, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n\n'));
await fs.writeFile(path.join(output, 'source-manifest.json'), JSON.stringify(evidence, null, 2));
console.log(`Compiled ${app.pages.length} original pages and ${Object.keys(evidence.components).length} original components.`);
