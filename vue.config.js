const path = require('path');
/* eslint-disable-next-line import/no-extraneous-dependencies */
const webpack = require('webpack');
/* eslint-disable-next-line import/no-extraneous-dependencies */
const CopyWebpackPlugin = require('copy-webpack-plugin');

const vtkChainWebpack = require('vtk.js/Utilities/config/chainWebpack');

module.exports = {
  lintOnSave: false,
  transpileDependencies: [
    'vuetify',
  ],
  chainWebpack: (config) => {
    vtkChainWebpack(config);
  },
  configureWebpack: {
    resolve: {
      alias: {
        '@': __dirname,
      },
    },
    plugins: [
      new webpack.NormalModuleReplacementPlugin(/^webvr-polyfill$/, ((resource) => {
        /* eslint-disable-next-line no-param-reassign */
        resource.request = '@/src/vtk/webvr-empty.js';
      })),
      new CopyWebpackPlugin([
        {
          from: path.join(__dirname, 'node_modules', 'itk', 'WebWorkers'),
          to: path.join(__dirname, 'dist', 'itk', 'WebWorkers'),
        },
        {
          from: path.join(__dirname, 'node_modules', 'itk', 'ImageIOs'),
          to: path.join(__dirname, 'dist', 'itk', 'ImageIOs'),
        },
      ]),
    ],
  },
};
