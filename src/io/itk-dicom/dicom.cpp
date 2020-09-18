#include <cerrno>
#include <cstdio>
#include <dirent.h>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <sys/stat.h>
#include <sys/types.h>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#ifdef WEB_BUILD
#include <emscripten.h>
#endif

#include <nlohmann/json.hpp>

#include "itkCastImageFilter.h"
#include "itkCommonEnums.h"
#include "itkGDCMImageIO.h"
#include "itkGDCMSeriesFileNames.h"
#include "itkImage.h"
#include "itkImageFileReader.h"
#include "itkImageFileWriter.h"
#include "itkImageIOBase.h"
#include "itkImageSeriesReader.h"
#include "itkRescaleIntensityImageFilter.h"
#include "itkVectorImage.h"

#include "charset.hpp"
#include "readTRE.hpp"

using json = nlohmann::json;
using VectorImageType = itk::VectorImage<float, 3>;
using ImageType = itk::Image<float, 3>;
using ReaderType = itk::ImageFileReader<ImageType>;
using SeriesReaderType = itk::ImageSeriesReader<ImageType>;
using FileNamesContainer = std::vector<std::string>;
using DictionaryType = itk::MetaDataDictionary;
using SOPInstanceUID = std::string;
using ImageInfo =
    std::pair<SOPInstanceUID, std::string>; // (SOPInstanceUID, filename)
using DicomIO = itk::GDCMImageIO;
using MetaDataStringType = itk::MetaDataObject<std::string>;
// can only index on SOPInstanceUID, since filename isn't full path
using ImageIndex = std::unordered_set<SOPInstanceUID>;
using SeriesIndexType =
    std::unordered_map<std::string,
                       std::vector<std::string>>; // seriesUID -> []filenames
using TagList = std::vector<std::string>;

static int rc = 0;
static ImageIndex imageIndex;
static std::unordered_set<SOPInstanceUID> SOPUIDIndex;
static SeriesIndexType SeriesIndex;

#ifdef WEB_BUILD
extern "C" const char *EMSCRIPTEN_KEEPALIVE unpack_error_what(intptr_t ptr) {
  auto error = reinterpret_cast<std::runtime_error *>(ptr);
  return error->what();
}
#endif

void list_dir(const char *path) {
  struct dirent *entry;
  DIR *dir = opendir(path);

  if (dir == NULL) {
    return;
  }
  while ((entry = readdir(dir)) != NULL) {
    std::cerr << entry->d_name << std::endl;
  }
  closedir(dir);
}

bool dirExists(std::string path) {
  struct stat buf;
  return 0 == stat(path.c_str(), &buf);
}

std::string
unpackMetaAsString(const itk::MetaDataObjectBase::Pointer &metaValue) {
  using MetaDataStringType = itk::MetaDataObject<std::string>;
  MetaDataStringType::Pointer value =
      dynamic_cast<MetaDataStringType *>(metaValue.GetPointer());
  if (value != nullptr) {
    return value->GetMetaDataObjectValue();
  }
  return {};
}

// convenience method for making world-writable dirs
void makedir(const std::string &dirName) {
  if (-1 == mkdir(dirName.c_str(), 0777)) {
    if (errno != EEXIST) {
      throw std::runtime_error(std::string("makedir error: ") +
                               std::strerror(errno));
    }
  }
}

// convenience method for moving files
void movefile(const std::string &src, const std::string &dst) {
  if (0 != std::rename(src.c_str(), dst.c_str())) {
    throw std::runtime_error("Failed to move file: " + src + " to " + dst +
                             ": " + std::strerror(errno));
  }
}

const json import(FileNamesContainer &files) {
  // make tmp dir
  std::string tmpdir("tmp");
  makedir(tmpdir);

  // move all files to tmp
  for (auto file : files) {
    auto dst = tmpdir + "/" + file;
    movefile(file, dst);
  }

  // parse out series
  typedef itk::GDCMSeriesFileNames SeriesFileNames;
  SeriesFileNames::Pointer seriesFileNames = SeriesFileNames::New();
  // files are all default dumped to cwd
  seriesFileNames->SetDirectory(tmpdir);
  seriesFileNames->SetUseSeriesDetails(true);
  seriesFileNames->SetGlobalWarningDisplay(false);
  seriesFileNames->AddSeriesRestriction("0008|0021");
  seriesFileNames->SetRecursive(false);
  // Does this affect series organization?
  seriesFileNames->SetLoadPrivateTags(false);

  using SeriesIdContainer = std::vector<std::string>;
  const SeriesIdContainer &gdcmSeriesUIDs = seriesFileNames->GetSeriesUIDs();

  for (auto gdcmSeriesUID : gdcmSeriesUIDs) {
    FileNamesContainer fileNames =
        seriesFileNames->GetFileNames(gdcmSeriesUID.c_str());

    // move files to series dir
    // assume there will be no filename conflicts within a series
    makedir(gdcmSeriesUID);
    for (auto filename : fileNames) {
      auto dst = gdcmSeriesUID + "/" + filename.substr(tmpdir.size() + 1);
      movefile(filename, dst);
    }
  }
  return json(gdcmSeriesUIDs);
}

int buildSeries(const std::string &gdcmSeriesUID) {
  if (dirExists(gdcmSeriesUID)) {
    typedef itk::GDCMSeriesFileNames SeriesFileNames;
    SeriesFileNames::Pointer seriesFileNames = SeriesFileNames::New();
    seriesFileNames->SetDirectory(gdcmSeriesUID);
    seriesFileNames->SetUseSeriesDetails(true);
    seriesFileNames->SetGlobalWarningDisplay(false);
    seriesFileNames->AddSeriesRestriction("0008|0021");
    seriesFileNames->SetRecursive(false);
    seriesFileNames->SetLoadPrivateTags(false);

    using SeriesIdContainer = std::vector<std::string>;
    SeriesIdContainer uids = seriesFileNames->GetSeriesUIDs();

    if (uids.size() != 1) {
      throw std::runtime_error("why are there more than 1 series in this dir");
    }
    // TODO need to figure out why uids[0] sometimes is not equal to
    // gdcmSeriesUID.
    if (uids[0] != gdcmSeriesUID) {
      std::cerr << "Found UID " << uids[0] << " instead of " << gdcmSeriesUID
                << std::endl;
    }

    SeriesIndex[gdcmSeriesUID] = seriesFileNames->GetFileNames(uids[0].c_str());
    auto &index = SeriesIndex[gdcmSeriesUID];
    for (auto &filename : index) {
      // trim off dir + "/"
      filename = filename.substr(gdcmSeriesUID.size() + 1);
    }
    return index.size();
  }
  std::cerr << "Could not build series " << gdcmSeriesUID << std::endl;
  return 0;
}

const json readTags(const std::string &gdcmSeriesUID, unsigned long slice,
                    const TagList &tags) {
  json tagJson;

  if (SeriesIndex.find(gdcmSeriesUID) != SeriesIndex.end()) {
    FileNamesContainer seriesFileList = SeriesIndex.at(gdcmSeriesUID);

    if (slice >= 0 && slice < seriesFileList.size()) {
      auto filename = seriesFileList.at(slice);

      typename DicomIO::Pointer dicomIO = DicomIO::New();
      dicomIO->LoadPrivateTagsOff();
      typename ReaderType::Pointer reader = ReaderType::New();
      reader->UseStreamingOn();
      reader->SetImageIO(dicomIO);

      auto fullFilename = gdcmSeriesUID + "/" + filename;
      dicomIO->SetFileName(fullFilename);
      reader->SetFileName(fullFilename);
      reader->UpdateOutputInformation();

      DictionaryType tagsDict = reader->GetMetaDataDictionary();

      std::string specificCharacterSet =
          unpackMetaAsString(tagsDict["0008|0005"]);
      CharStringToUTF8Converter conv(specificCharacterSet);

      for (auto it = tags.begin(); it != tags.end(); ++it) {
        auto tag = *it;
        bool doConvert = false;
        if (tag[0] == '@') {
          doConvert = true;
          tag = tag.substr(1);
        }

        auto value = unpackMetaAsString(tagsDict[tag]);
        if (doConvert) {
          value = conv.convertCharStringToUTF8(value);
        }

        tagJson[tag] = value;
      }
    }
  }

  return tagJson;
}

void getSliceImage(const std::string &seriesUID, unsigned long slice,
                   const std::string &outFileName, bool asThumbnail) {
  SeriesIndexType::const_iterator found = SeriesIndex.find(seriesUID);
  if (found != SeriesIndex.end()) {
    FileNamesContainer seriesFileList = SeriesIndex.at(seriesUID);
    std::string filename = seriesUID + "/" + seriesFileList.at(slice - 1);

    typename DicomIO::Pointer dicomIO = DicomIO::New();
    dicomIO->LoadPrivateTagsOff();
    typename ReaderType::Pointer reader = ReaderType::New();
    reader->SetFileName(filename);

    // cast images to unsigned char for easier thumbnailing to canvas ImageData
    // if asThumbnail is specified.
    if (asThumbnail) {
      using InputImageType = ImageType;
      using OutputPixelType = unsigned char;
      using OutputImageType = itk::Image<OutputPixelType, 3>;
      using RescaleFilter =
          itk::RescaleIntensityImageFilter<InputImageType, InputImageType>;
      using CastImageFilter =
          itk::CastImageFilter<InputImageType, OutputImageType>;

      auto rescaleFilter = RescaleFilter::New();
      rescaleFilter->SetInput(reader->GetOutput());
      rescaleFilter->SetOutputMinimum(0);
      rescaleFilter->SetOutputMaximum(
          itk::NumericTraits<OutputPixelType>::max());

      auto castFilter = CastImageFilter::New();
      castFilter->SetInput(rescaleFilter->GetOutput());

      using WriterType = itk::ImageFileWriter<OutputImageType>;
      auto writer = WriterType::New();
      writer->SetInput(castFilter->GetOutput());
      writer->SetFileName(outFileName);
      writer->Update();
    } else {
      using WriterType = itk::ImageFileWriter<ImageType>;
      auto writer = WriterType::New();
      writer->SetInput(reader->GetOutput());
      writer->SetFileName(outFileName);
      writer->Update();
    }
  } else {
    throw std::runtime_error("No thumbnail for series UID: " + seriesUID);
    std::ofstream empty(outFileName);
  }
}

void buildSeriesVolume(const std::string &seriesUID,
                       const std::string &outFileName) {
  SeriesIndexType::const_iterator found = SeriesIndex.find(seriesUID);
  if (found != SeriesIndex.end()) {
    FileNamesContainer seriesFileList = SeriesIndex.at(seriesUID);
    FileNamesContainer fileNames(seriesFileList);

    for (FileNamesContainer::iterator it = fileNames.begin();
         it != fileNames.end(); ++it) {
      *it = seriesUID + "/" + *it;
    }

    DicomIO::Pointer dicomIO = DicomIO::New();
    dicomIO->LoadPrivateTagsOff();
    SeriesReaderType::Pointer reader = SeriesReaderType::New();
    // this should be ordered from import
    reader->SetFileNames(fileNames);
    // reader->ForceOrthogonalDirectionOn();
    // hopefully this makes things faster?
    reader->MetaDataDictionaryArrayUpdateOff();
    reader->UseStreamingOn();

    using WriterType = itk::ImageFileWriter<ImageType>;
    auto writer = WriterType::New();
    writer->SetInput(reader->GetOutput());
    writer->SetFileName(outFileName);
    writer->Update();
  }
}

int main(int argc, char *argv[]) {
  if (argc < 2) {
    std::cerr << "Usage: " << argv[0] << " [import|clear|remove]" << std::endl;
    return 1;
  }

  std::string action(argv[1]);

  // need some IO so emscripten will import FS module
  // otherwise, you'll get an "FS not found" error at runtime
  // https://github.com/emscripten-core/emscripten/issues/854
  std::cerr << "Action: " << action << ", runcount: " << ++rc
            << ", argc: " << argc << std::endl;

  if (action == "import" && argc > 2) {
    // dicom import output.json <FILES>
    std::string outFileName = argv[2];
    std::vector<std::string> rest(argv + 3, argv + argc);

    json importInfo;
    try {
      importInfo = import(rest);
    } catch (const std::runtime_error &e) {
      std::cerr << "Runtime error: " << e.what() << std::endl;
    } catch (const itk::ExceptionObject &e) {
      std::cerr << "ITK error: " << e.what() << std::endl;
    }

    std::ofstream outfile;
    outfile.open(outFileName);
    outfile << importInfo.dump(-1, true, ' ', json::error_handler_t::ignore);
    outfile.close();
  } else if (action == "buildSeries") {
    // dicom buildSeries output.json gdcmSeriesUID
    std::string outFileName(argv[2]);
    std::string gdcmSeriesUID(argv[3]);
    json numSlices;
    try {
      numSlices = buildSeries(gdcmSeriesUID);
    } catch (const itk::ExceptionObject &e) {
      std::cerr << "ITK error: " << e.what() << std::endl;
    } catch (const std::runtime_error &e) {
      std::cerr << "Runtime error: " << e.what() << std::endl;
    }

    std::ofstream outfile;
    outfile.open(outFileName);
    outfile << numSlices.dump(-1, true, ' ', json::error_handler_t::ignore);
    outfile.close();
  } else if (action == "readTags" && argc > 4) {
    // dicom readTags output.json seriesUID, slicenum [...tags]
    std::string outputFilename(argv[2]);
    std::string seriesUID(argv[3]);
    unsigned long sliceNum = std::stoul(argv[4]);
    std::vector<std::string> rest(argv + 5, argv + argc);

    json tags;
    try {
      tags = readTags(seriesUID, sliceNum, rest);
    } catch (const itk::ExceptionObject &e) {
      std::cerr << "ITK error: " << e.what() << std::endl;
    } catch (const std::runtime_error &e) {
      std::cerr << "Runtime error: " << e.what() << std::endl;
    }

    std::ofstream outfile;
    outfile.open(outputFilename);
    outfile << tags.dump(-1, true, ' ', json::error_handler_t::ignore);
    outfile.close();
  } else if (action == "getSliceImage" && argc == 6) {
    // dicom getSliceImage outputImage.json SERIES_UID SLICENUM
    std::string outFileName = argv[2];
    std::string seriesUID = argv[3];
    unsigned long sliceNum = std::stoul(argv[4]);
    bool asThumbnail = std::string(argv[5]) == "1";

    try {
      getSliceImage(seriesUID, sliceNum, outFileName, asThumbnail);
    } catch (const itk::ExceptionObject &e) {
      std::cerr << "ITK error: " << e.what() << '\n';
    } catch (const std::runtime_error &e) {
      std::cerr << "Runtime error: " << e.what() << std::endl;
    }
  } else if (action == "buildSeriesVolume" && argc == 4) {
    // dicom buildSeriesVolume outputImage.json SERIES_UID
    std::string outFileName = argv[2];
    std::string seriesUID = argv[3];

    try {
      buildSeriesVolume(seriesUID, outFileName);
    } catch (const std::runtime_error &e) {
      std::cerr << e.what() << std::endl;
    }
  } else if (action == "readTRE" && argc == 4) {
    // dicom readTRE points.json TRE_FILE
    std::string outFilename = argv[2];
    std::string filename = argv[3];
    json tre = readTRE(filename);

    std::ofstream outfile;
    outfile.open(outFilename);
    outfile << tre.dump();
    outfile.close();
  }

  return 0;
}
