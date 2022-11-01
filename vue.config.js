const path = require('path');
/* eslint-disable-next-line import/no-extraneous-dependencies */
const webpack = require('webpack');
/* eslint-disable-next-line import/no-extraneous-dependencies */
const CopyWebpackPlugin = require('copy-webpack-plugin');

const ITK_WASM_INCLUDE = [
  'Nrrd',
  'JPEG',
  'PNG',
  'Meta',
  'Nifti',
  'VTK',
  'BMP',
  'GDCM',
  'ReadDICOMTags',
  'ReadImageDICOMFileSeries'
];

const itkConfig = path.resolve(__dirname, 'src', 'io', 'itk', 'itkConfig.js')

module.exports = {
  lintOnSave: false,
  transpileDependencies: ['vuetify'],
  chainWebpack: (config) => {
    config.plugin('html').tap((args) => {
      // eslint-disable-next-line no-param-reassign
      args[0].ga = process.env.VOLVIEW_GA_ID || null;
      return args;
    });
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
        '../itkConfig.js': itkConfig,
        '../../itkConfig.js': itkConfig,
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
      new CopyWebpackPlugin({
        patterns: [
          {
            from: path.join(__dirname, 'node_modules', 'itk-wasm', 'dist', 'web-workers'),
            to: path.join(__dirname, 'dist', 'itk', 'web-workers')
          },
          {
            from: path.join(__dirname, 'node_modules', 'itk-image-io'),
            to: path.join(__dirname, 'dist', 'itk', 'image-io'),
            filter: (resourcePath) => {
              return ITK_WASM_INCLUDE.some((prefix) =>
                path.basename(resourcePath).startsWith(prefix)
              );
            },
          },
          {
            from: path.join(__dirname, 'src', 'io', 'itk-dicom','web-build'),
            to: path.join(__dirname, 'dist', 'itk', 'pipelines', '[name][ext]'),
            filter: (resourcePath) => {
              return path.basename(resourcePath).startsWith('dicom')
            },
          }
        ],
      }),
    ],
  },
};
