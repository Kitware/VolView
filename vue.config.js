const path = require('path');
/* eslint-disable-next-line import/no-extraneous-dependencies */
const webpack = require('webpack');
/* eslint-disable-next-line import/no-extraneous-dependencies */
const CopyWebpackPlugin = require('copy-webpack-plugin');

const ITK_WASM_INCLUDE = [
  'itkNrrd',
  'itkJPEG',
  'itkPNG',
  'itkMeta',
  'itkNifti',
  'itkJSON',
  'itkVTK',
  'itkBMP',
];

module.exports = {
  lintOnSave: false,
  transpileDependencies: ['vuetify'],
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
      new CopyWebpackPlugin({
        patterns: [
          {
            from: './node_modules/itk/WebWorkers',
            to: 'itk/WebWorkers/[name][ext]',
          },
          {
            from: './node_modules/itk/ImageIOs',
            to: 'itk/ImageIOs/[name][ext]',
            filter: (resourcePath) => {
              return ITK_WASM_INCLUDE.some((prefix) =>
                path.basename(resourcePath).startsWith(prefix)
              );
            },
          },
          {
            from: './src/io/itk-dicom/web-build/dicom*',
            to: 'itk/Pipelines/[name][ext]',
          },
        ],
      }),
    ],
  },
};
