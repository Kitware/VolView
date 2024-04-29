/*=========================================================================
 *
 *  Copyright NumFOCUS
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0.txt
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 *
 *=========================================================================*/
#include "itkBinShrinkImageFilter.h"
#include "itkVectorImage.h"
#include "itkResampleImageFilter.h"
#include "itkLinearInterpolateImageFunction.h"
#include "itkLabelImageGenericInterpolateImageFunction.h"
#include "itkImageRegionSplitterSlowDimension.h"
#include "itkExtractImageFilter.h"
#include "itkRGBPixel.h"
#include "itkRGBAPixel.h"
#include "itkVectorImage.h"
#include "itkOffset.h"
#include "itkVector.h"
#include "itkPoint.h"
#include "itkCovariantVector.h"
#include "itkDiffusionTensor3D.h"
#include <complex>
#include "itkFixedArray.h"
#include "itkArray.h"
#include "itkMatrix.h"
#include "itkVariableLengthVector.h"
#include "itkVariableSizeMatrix.h"
#include <fstream>
#include "itkPipeline.h"
#include "itkInputImage.h"
#include "itkOutputImage.h"
#include "itkOutputTextStream.h"
#include "itkSupportInputImageTypes.h"

template <typename TImage>
int Resample(itk::wasm::Pipeline &pipeline, itk::wasm::InputImage<TImage> &inputImage)
{
  using ImageType = TImage;

  pipeline.get_option("InputImage")->required();

  using OutputImageType = itk::wasm::OutputImage<ImageType>;
  OutputImageType outputImage;
  pipeline.add_option("OutputImage", outputImage, "Output image")->required();

  bool label = false;
  pipeline.add_flag("-l,--label", label, "Interpolate for label image")->default_val(false);

  std::vector<unsigned int> outSize;
  pipeline.add_option("-z,--size", outSize, "New image size for each direction")->expected(2, 3)->delimiter(',');

  std::vector<double> outSpacing;
  pipeline.add_option("-p,--spacing", outSpacing, "New image spacing for each direction")->expected(2, 3)->delimiter(',');

  std::vector<double> outOrigin;
  pipeline.add_option("-o,--origin", outOrigin, "New image origin for each direction")->expected(2, 3)->delimiter(',');

  std::vector<double> outDirection;
  pipeline.add_option("-d,--direction", outDirection, "New image direction")->expected(4, 9)->delimiter(',');

  // split args
  unsigned int maxTotalSplits = 1;
  pipeline.add_option("-m,--max-total-splits", maxTotalSplits, "Maximum total splits when processed in parallel");

  unsigned int split = 0;
  pipeline.add_option("-s,--split", split, "Current processed split");

  itk::wasm::OutputTextStream numberOfSplitsStream;
  auto numberOfSplitsStreamOption = pipeline.add_option("--number-of-splits", numberOfSplitsStream, "Number of splits");

  ITK_WASM_PARSE(pipeline);

  auto inImage = inputImage.Get();

  using ResampleFilterType = itk::ResampleImageFilter<ImageType, ImageType>;
  auto resampleFilter = ResampleFilterType::New();
  if (label)
  {
    using InterpolatorType = itk::LabelImageGenericInterpolateImageFunction<ImageType, itk::LinearInterpolateImageFunction>;
    resampleFilter->SetInterpolator(InterpolatorType::New());
  }

  resampleFilter->SetInput(inImage);

  typename ImageType::SizeType outputSize;
  typename ImageType::SpacingType outputSpacing;
  typename ImageType::PointType outputOrigin;
  const int dims = outputSize.size();
  for (int i = 0; i < dims; ++i)
  {
    outputSize[i] = outSize[i];
    outputSpacing[i] = outSpacing[i];
    outputOrigin[i] = outOrigin[i];
  }
  resampleFilter->SetSize(outputSize);
  resampleFilter->SetOutputSpacing(outputSpacing);
  resampleFilter->SetOutputOrigin(outputOrigin);

  typename ImageType::DirectionType outputDirection;
  for (int row = 0; row < dims; ++row)
  {
    for (int col = 0; col < dims; ++col)
    {
      outputDirection(row, col) = outDirection[row * dims + col];
    }
  }

  resampleFilter->SetOutputDirection(outputDirection);

  // Split handling
  using ROIFilterType = itk::ExtractImageFilter<ImageType, ImageType>;
  resampleFilter->UpdateOutputInformation();
  using RegionType = typename ImageType::RegionType;
  const RegionType largestRegion(resampleFilter->GetOutput()->GetLargestPossibleRegion());

  using SplitterType = itk::ImageRegionSplitterSlowDimension;
  auto splitter = SplitterType::New();
  const unsigned int numberOfSplits = splitter->GetNumberOfSplits(largestRegion, maxTotalSplits);

  if (split >= numberOfSplits)
  {
    std::cerr << "Error: requested split: " << split << " is outside the number of splits: " << numberOfSplits << std::endl;
    return EXIT_FAILURE;
  }

  if (!numberOfSplitsStreamOption->empty())
  {
    numberOfSplitsStream.Get() << numberOfSplits;
  }

  RegionType requestedRegion(largestRegion);
  splitter->GetSplit(split, numberOfSplits, requestedRegion);
  auto roiFilter = ROIFilterType::New();
  roiFilter->SetExtractionRegion(requestedRegion);
  roiFilter->SetInput(resampleFilter->GetOutput());

  try
  {
    roiFilter->Update();
  }
  catch (std::exception &error)
  {
    std::cerr << "Error: " << error.what() << std::endl;
    return EXIT_FAILURE;
  }

  outputImage.Set(roiFilter->GetOutput());

  return EXIT_SUCCESS;
}

template <typename TImage>
class PipelineFunctor
{
public:
  int operator()(itk::wasm::Pipeline &pipeline)
  {
    using ImageType = TImage;

    using InputImageType = itk::wasm::InputImage<ImageType>;
    InputImageType inputImage;
    pipeline.add_option("InputImage", inputImage, "Input image");

    ITK_WASM_PRE_PARSE(pipeline);

    return Resample<ImageType>(pipeline, inputImage);
  }
};

int main(int argc, char *argv[])
{
  itk::wasm::Pipeline pipeline("Resample", "Resample a image", argc, argv);

  return itk::wasm::SupportInputImageTypes<PipelineFunctor,
                                           uint8_t,
                                           int8_t,
                                           uint16_t,
                                           int16_t,
                                           uint32_t,
                                           int32_t,
                                           uint64_t,
                                           int64_t,
                                           float,
                                           double>::Dimensions<2U, 3U>("InputImage", pipeline);
}
