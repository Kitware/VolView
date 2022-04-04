const path = require('path');
/* eslint-disable-next-line import/no-extraneous-dependencies */
const webpack = require('webpack');
/* eslint-disable-next-line import/no-extraneous-dependencies */
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  lintOnSave: false,
  transpileDependencies: ['vuetify'],
  chainWebpack: (config) => {
    // do not cache worker files
    // https://github.com/webpack-contrib/worker-loader/issues/195
    config.module.rule('js').exclude.add(/\.worker\.[jt]s$/);
    // add worker-loader /before/ ts-loader so that worker-loader can
    // properly handle exports.
    // https://v4.webpack.js.org/loaders/worker-loader/#integrating-with-typescript
    config.module
      .rule('web-worker')
      .before('ts')
      .test(/\.worker\.[jt]s$/)
      .exclude.add(/node_modules/)
      .end()
      .use('worker-loader')
      .loader('worker-loader')
      .options({
        inline: 'no-fallback',
      })
      .end();
  },
  configureWebpack: {
    devtool: 'source-map',
    resolve: {
      alias: {
        '@': __dirname,
        '@src': path.join(__dirname, 'src'),
        // Use lite colormap
        '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps.json':
          '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/LiteColorMaps.json',
      },
    },
    plugins: [
      // disable webvr
      new webpack.NormalModuleReplacementPlugin(
        /^webvr-polyfill$/,
        (resource) => {
          /* eslint-disable-next-line no-param-reassign */
          resource.request = '@/src/vtk/webvr-empty.js';
        }
      ),
      new CopyWebpackPlugin([
        {
          from: path.join(__dirname, 'node_modules', 'itk', 'WebWorkers'),
          to: path.join(__dirname, 'dist', 'itk', 'WebWorkers'),
        },
        {
          from: path.join(__dirname, 'node_modules', 'itk', 'ImageIOs'),
          to: path.join(__dirname, 'dist', 'itk', 'ImageIOs'),
        },
        {
          from: path.join(
            __dirname,
            'src',
            'io',
            'itk-dicom',
            'web-build',
            'dicom*'
          ),
          to: path.join(__dirname, 'dist', 'itk', 'Pipelines'),
          flatten: true,
        },
      ]),
    ],
  },
};
