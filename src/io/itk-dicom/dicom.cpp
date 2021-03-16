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
// Building with the itk.js docker container has a more recent gcc version
#include <filesystem>
namespace fs = std::filesystem;
#else
// Building locally with gcc 7.5.0 means I need -lstdc++fs and
// experimental/filesystem
#include <experimental/filesystem>
namespace fs = std::experimental::filesystem;
#endif

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

#include "gdcmImageHelper.h"
#include "gdcmReader.h"

#include "charset.hpp"
#include "readTRE.hpp"

using json = nlohmann::json;
using ImageType = itk::Image<float, 3>;
using ReaderType = itk::ImageFileReader<ImageType>;
using SeriesReaderType = itk::ImageSeriesReader<ImageType>;
using FileNamesContainer = std::vector<std::string>;
using DictionaryType = itk::MetaDataDictionary;
using DicomIO = itk::GDCMImageIO;
using MetaDataStringType = itk::MetaDataObject<std::string>;
using TagList = std::vector<std::string>;
// volumeID -> filenames[]
using VolumeMapType = std::unordered_map<std::string, std::vector<std::string>>;
// VolumeID[]
using VolumeIDList = std::vector<std::string>;

static int rc = 0;
static const double EPSILON = 10e-5;
static VolumeMapType VolumeMap;

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

void replaceChars(std::string &str, char search, char replaceChar) {
  int pos;
  std::string replace(1, replaceChar);
  while ((pos = str.find(search)) != std::string::npos) {
    str.replace(pos, 1, replace);
  }
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

// doesn't actually do any length checks, or overflow checks, or anything
// really.
template <int N>
double dotProduct(const std::vector<double> &vec1,
                  const std::vector<double> &vec2) {
  double result = 0;
  for (int i = 0; i < N; i++) {
    result += vec1.at(i) * vec2.at(i);
  }
  return result;
}

std::vector<double> ReadImageOrientationValue(const std::string &filename) {
  gdcm::Reader reader;
  reader.SetFileName(filename.c_str());
  if (!reader.Read()) {
    throw std::runtime_error("gdcm: failed to read file");
  }
  const gdcm::File &file = reader.GetFile();
  // This helper method asserts that the vector has length 6.
  return gdcm::ImageHelper::GetDirectionCosinesValue(file);
}

bool areCosinesAlmostEqual(std::vector<double> cosines1,
                           std::vector<double> cosines2,
                           double epsilon = EPSILON) {
  for (int i = 0; i <= 1; i++) {
    std::vector<double> vec1{cosines1.at(i), cosines1.at(i + 1),
                             cosines1.at(i + 2)};
    std::vector<double> vec2{cosines2.at(i), cosines2.at(i + 1),
                             cosines2.at(i + 2)};
    double dot = dotProduct<3>(vec1, vec2);
    if (dot < (1 - EPSILON)) {
      return false;
    }
  }
  return true;
}

VolumeMapType SeparateOnImageOrientation(const VolumeMapType &volumeMap) {
  VolumeMapType newVolumeMap;
  // Vector< Pair< cosines, volumeID >>
  std::vector<std::pair<std::vector<double>, std::string>> cosinesToID;

  // append unique ID part to the volume ID, based on cosines
  // The format replaces non-alphanumeric chars to be semi-consistent with DICOM UID spec,
  //   and to make debugging easier when looking at the full volume IDs.
  // Format: COSINE || "S" || COSINE || "S" || ...
  //   COSINE: A decimal number -DD.DDDD gets reformatted into NDDSDDDD
  auto encodeCosinesAsIDPart = [](const std::vector<double> &cosines) {
    std::string concatenated;
    for (auto it = cosines.begin(); it != cosines.end(); ++it) {
      concatenated += std::to_string(*it);
      if (it != cosines.end() - 1) {
        concatenated += 'S';
      }
    }

    replaceChars(concatenated, '-', 'N');
    replaceChars(concatenated, '.', 'D');

    return concatenated;
  };


  for (const auto &[volumeID, names] : volumeMap) {
    for (const auto &filename : names) {
      std::vector<double> curCosines = ReadImageOrientationValue(filename);

      bool inserted = false;
      for (const auto &entry : cosinesToID) {
        if (areCosinesAlmostEqual(curCosines, entry.first)) {
          newVolumeMap[entry.second].push_back(filename);
          inserted = true;
          break;
        }
      }

      if (!inserted) {
        const auto encodedIDPart = encodeCosinesAsIDPart(curCosines);
        auto newID = volumeID + '.' + encodedIDPart;
        newVolumeMap[newID].push_back(filename);
        cosinesToID.push_back(std::make_pair(curCosines, newID));
      }
    }
  }

  return newVolumeMap;
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

  // Obtain the initial separation of imported files into distinct volumes.
  auto &gdcmSeriesUIDs = seriesFileNames->GetSeriesUIDs();

  // The initial series UIDs are used as the basis for our volume IDs.
  VolumeMapType curVolumeMap;
  for (auto seriesUID : gdcmSeriesUIDs) {
    curVolumeMap[seriesUID] =
        seriesFileNames->GetFileNames(seriesUID.c_str());
  }

  // further restrict on orientation
  curVolumeMap = SeparateOnImageOrientation(curVolumeMap);

  VolumeIDList allVolumeIDs;
  for (const auto &entry : curVolumeMap) {
    const std::string &volumeID = entry.first;
    const FileNamesContainer &fileNames = entry.second;

    // move files to volume dir
    // assume there will be no filename conflicts within a volume
    makedir(volumeID);
    for (auto filename : fileNames) {
      auto dst = volumeID + "/" + filename.substr(tmpdir.size() + 1);
      movefile(filename, dst);
    }

    allVolumeIDs.push_back(volumeID);
  }
  return json(allVolumeIDs);
}

/**
 * buildVolumeList exists to support multiple import() calls prior to building a
 * volume.
 *
 * This solves the issues
 */
int buildVolumeList(const std::string &volumeID) {
  if (dirExists(volumeID)) {
    typedef itk::GDCMSeriesFileNames SeriesFileNames;
    SeriesFileNames::Pointer seriesFileNames = SeriesFileNames::New();
    seriesFileNames->SetDirectory(volumeID);
    seriesFileNames->SetUseSeriesDetails(true);
    seriesFileNames->SetGlobalWarningDisplay(false);
    seriesFileNames->AddSeriesRestriction("0008|0021");
    seriesFileNames->SetRecursive(false);
    seriesFileNames->SetLoadPrivateTags(false);

    VolumeIDList uids = seriesFileNames->GetSeriesUIDs();

    if (uids.size() != 1) {
      throw std::runtime_error("why are there more than 1 series/volume in this dir");
    }

    VolumeMap[volumeID] = seriesFileNames->GetFileNames(uids[0].c_str());
    auto &map = VolumeMap[volumeID];
    for (auto &filename : map) {
      // trim off dir + "/"
      filename = filename.substr(volumeID.size() + 1);
    }
    return map.size();
  }
  std::cerr << "Could not build volume " << volumeID << std::endl;
  return 0;
}

const json readTags(const std::string &volumeID, unsigned long slice,
                    const TagList &tags) {
  json tagJson;

  if (VolumeMap.find(volumeID) != VolumeMap.end()) {
    FileNamesContainer fileList = VolumeMap.at(volumeID);

    if (slice >= 0 && slice < fileList.size()) {
      auto filename = fileList.at(slice);

      typename DicomIO::Pointer dicomIO = DicomIO::New();
      dicomIO->LoadPrivateTagsOff();
      typename ReaderType::Pointer reader = ReaderType::New();
      reader->UseStreamingOn();
      reader->SetImageIO(dicomIO);

      auto fullFilename = volumeID + "/" + filename;
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

void getSliceImage(const std::string &volumeID, unsigned long slice,
                   const std::string &outFileName, bool asThumbnail) {
  VolumeMapType::const_iterator found = VolumeMap.find(volumeID);
  if (found != VolumeMap.end()) {
    FileNamesContainer fileList = VolumeMap.at(volumeID);
    std::string filename = volumeID + "/" + fileList.at(slice - 1);

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
    throw std::runtime_error("No thumbnail for volume ID: " + volumeID);
    std::ofstream empty(outFileName);
  }
}

void buildVolume(const std::string &volumeID,
                 const std::string &outFileName) {
  VolumeMapType::const_iterator found = VolumeMap.find(volumeID);
  if (found != VolumeMap.end()) {
    FileNamesContainer fileList = VolumeMap.at(volumeID);
    FileNamesContainer fileNames(fileList);

    for (FileNamesContainer::iterator it = fileNames.begin();
         it != fileNames.end(); ++it) {
      *it = volumeID + "/" + *it;
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

void deleteVolume(const std::string &volumeID) { fs::remove_all(volumeID); }

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
  } else if (action == "buildVolumeList") {
    // dicom buildVolumeList output.json volumeID
    std::string outFileName(argv[2]);
    std::string volumeID(argv[3]);
    json numSlices;
    try {
      numSlices = buildVolumeList(volumeID);
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
    // dicom readTags output.json volumeID, slicenum [...tags]
    std::string outputFilename(argv[2]);
    std::string volumeID(argv[3]);
    unsigned long sliceNum = std::stoul(argv[4]);
    std::vector<std::string> rest(argv + 5, argv + argc);

    json tags;
    try {
      tags = readTags(volumeID, sliceNum, rest);
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
    // dicom getSliceImage outputImage.json volumeID SLICENUM
    std::string outFileName = argv[2];
    std::string volumeID = argv[3];
    unsigned long sliceNum = std::stoul(argv[4]);
    bool asThumbnail = std::string(argv[5]) == "1";

    try {
      getSliceImage(volumeID, sliceNum, outFileName, asThumbnail);
    } catch (const itk::ExceptionObject &e) {
      std::cerr << "ITK error: " << e.what() << '\n';
    } catch (const std::runtime_error &e) {
      std::cerr << "Runtime error: " << e.what() << std::endl;
    }
  } else if (action == "buildVolume" && argc == 4) {
    // dicom buildVolume outputImage.json volumeID
    std::string outFileName = argv[2];
    std::string volumeID = argv[3];

    try {
      buildVolume(volumeID, outFileName);
    } catch (const itk::ExceptionObject &e) {
      std::cerr << "ITK error: " << e.what() << '\n';
    } catch (const std::runtime_error &e) {
      std::cerr << e.what() << std::endl;
    }
  } else if (action == "deleteVolume" && argc == 3) {
    // dicom deleteVolume volumeID
    std::string volumeID(argv[3]);

    try {
      deleteVolume(volumeID);
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
