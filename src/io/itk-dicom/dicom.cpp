#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <unordered_map>
#include <utility>
#include <unordered_set>
#include <stdexcept>
#include <cstdio>
#include <cerrno>
#include <dirent.h>
#include <sys/types.h>
#include <sys/stat.h>

#include "itkCommonEnums.h"
#include "itkImageIOBase.h"
#include "itkGDCMSeriesFileNames.h"
#include "itkImageSeriesReader.h"
#include "itkGDCMImageIO.h"
#include "itkVectorImage.h"

#include "thirdparty/json.hpp"

using json = nlohmann::json;
using ImageType = itk::VectorImage< float, 3 >;
using ReaderType = itk::ImageFileReader< ImageType >;
using FileNamesContainer = std::vector< std::string >;
using DictionaryType = itk::MetaDataDictionary;
using SOPInstanceUID = std::string;
using ImageInfo = std::pair< SOPInstanceUID, std::string >; // (SOPInstanceUID, filename)
using DicomIO = itk::GDCMImageIO;
using MetaDataStringType = itk::MetaDataObject< std::string >;
// can only index on SOPInstanceUID, since filename isn't full path
using ImageIndex = std::unordered_set< SOPInstanceUID >;
using SeriesIndex = std::unordered_map< std::string, std::vector< std::string > >; // seriesUID -> []filenames

static int rc = 0;
static ImageIndex imageIndex;
static SeriesIndex seriesIndex;

void list_dir( const char *path )
{
  struct dirent *entry;
  DIR *dir = opendir( path );

  if( dir == NULL )
  {
    return;
  }
  while( (entry = readdir( dir )) != NULL )
  {
    std::cerr << entry->d_name << std::endl;
  }
  closedir( dir );
}

std::string unpackMetaAsString( const itk::MetaDataObjectBase::Pointer & metaValue )
{
  using MetaDataStringType = itk::MetaDataObject< std::string >;
  MetaDataStringType::Pointer value =
    dynamic_cast< MetaDataStringType * >( metaValue.GetPointer() );
  return value->GetMetaDataObjectValue();
}

// convenience method for making world-writable dirs
void makedir( const std::string & dirName )
{
  if( -1 == mkdir( dirName.c_str(), 0777 ) )
  {
    if( errno != EEXIST )
    {
      throw std::runtime_error( std::string( "makedir error: " ) + std::strerror( errno ) );
    }
  }
}

// convenience method for moving files
void movefile( const std::string & src, const std::string & dst )
{
  if( 0 != std::rename( src.c_str(), dst.c_str() ) )
  {
    throw std::runtime_error( "Failed to move file: " + src + std::strerror( errno ) );
  }
}

const json import( const FileNamesContainer & files )
{
  // make tmp dir
  std::string tmpdir( "tmp" );
  makedir( tmpdir );

  // move file to tmp dir
  for( const auto file : files )
  {
    auto dst = tmpdir + "/" + file;
    movefile( file, dst );
  }

  typedef itk::GDCMSeriesFileNames SeriesFileNames;
  SeriesFileNames::Pointer seriesFileNames = SeriesFileNames::New();
  // files are all default dumped to cwd
  seriesFileNames->SetDirectory( tmpdir );
  seriesFileNames->SetUseSeriesDetails( true );
  seriesFileNames->SetGlobalWarningDisplay( false );
  seriesFileNames->AddSeriesRestriction( "0008|0021" );
  seriesFileNames->SetRecursive( false );

  using SeriesIdContainer = std::vector<std::string>;
  const SeriesIdContainer & seriesUIDs = seriesFileNames->GetSeriesUIDs();

  json output;

  for( auto seriesUID : seriesUIDs )
  {
    FileNamesContainer fileNames = seriesFileNames->GetFileNames( seriesUID.c_str() );

    json seriesInfo;

    makedir( seriesUID );

    std::vector< std::string > seriesFileList = seriesIndex[ seriesUID ];

    bool first = true;
    for( auto filename : fileNames )
    {
      typename DicomIO::Pointer dicomIO = DicomIO::New();
      dicomIO->LoadPrivateTagsOff();
      typename ReaderType::Pointer reader = ReaderType::New();
      reader->UseStreamingOn();
      reader->SetImageIO( dicomIO );

      // get SOPInstanceUID of dicom object in filename
      // http://qtdcm.gforge.inria.fr/html/QtDcmConvert_8cpp_source.html
      dicomIO->SetFileName( filename );
      // dicomIO->ReadImageInformation();
      reader->SetFileName( filename );
      reader->UpdateOutputInformation();

      DictionaryType tags = reader->GetMetaDataDictionary();

      std::string sopInstanceUID = unpackMetaAsString( tags[ "0008|0018" ] );
      ImageIndex::const_iterator found = imageIndex.find( sopInstanceUID );
      if( found == imageIndex.end() )
      {
        imageIndex.insert( sopInstanceUID );
        std::string newName = std::to_string( seriesFileList.size() );
        std::string fullNewName = tmpdir + "/" + newName;
        seriesFileList.push_back( newName );
        movefile( filename, fullNewName );
      }

      // construct series info
      if( first )
      {
        first = false;
        seriesInfo[ "PatientName" ] = unpackMetaAsString( tags[ "0010|0010" ] );
        seriesInfo[ "PatientID" ] = unpackMetaAsString( tags[ "0010|0020" ] );
        seriesInfo[ "PatientBirthDate" ] = unpackMetaAsString( tags[ "0010|0030" ] );
        seriesInfo[ "PatientSex" ] = unpackMetaAsString( tags[ "0010|0040" ] );
        seriesInfo[ "StudyInstanceUID" ] = unpackMetaAsString( tags[ "0020|000d" ] );
        seriesInfo[ "StudyDate" ] = unpackMetaAsString( tags[ "0008|0020" ] );
        seriesInfo[ "StudyTime" ] = unpackMetaAsString( tags[ "0008|0030" ] );
        seriesInfo[ "StudyID" ] = unpackMetaAsString( tags[ "0020|0010" ] );
        seriesInfo[ "AccessionNumber" ] = unpackMetaAsString( tags[ "0008|0050" ] );
        seriesInfo[ "StudyDescription" ] = unpackMetaAsString( tags[ "0008|1030" ] );
        seriesInfo[ "Modality" ] = unpackMetaAsString( tags[ "0008|0060" ] );
        seriesInfo[ "SeriesInstanceUID" ] = unpackMetaAsString( tags[ "0020|000e" ] );
        seriesInfo[ "SeriesNumber" ] = unpackMetaAsString( tags[ "0020|0011" ] );
        seriesInfo[ "SeriesDescription" ] = unpackMetaAsString( tags[ "0008|103e" ] );
        seriesInfo[ "NumberOfSlices" ] = std::to_string( seriesFileList.size() );
      }
    }

    output[ seriesUID ] = seriesInfo;
  }

  return output;
}

int main( int argc, char * argv[] )
{
  if( argc < 2 )
  {
    std::cerr << "Usage: " << argv[0] << " [import|clear|remove]" << std::endl;
    return 1;
  }

  std::string action(argv[1]);

  // need some IO so emscripten will import FS module
  // otherwise, you'll get an "FS not found" error at runtime
  // https://github.com/emscripten-core/emscripten/issues/854
  std::cerr << "Action: " << action << ", runcount: " << ++rc << ", argc: " << argc << std::endl;

  if( 0 == action.compare( "import" ) && argc > 2 )
  {
    // dicom import output.json <FILES>
    std::string outFileName = argv[2];
    std::vector< std::string > rest( argv + 3, argv + argc );

    json importInfo;
    try
    {
      importInfo = import( rest );
    }
    catch ( const std::runtime_error &e )
    {
      std::cerr << "Runtime error: " << e.what() << std::endl;
    }
    catch ( const itk::ExceptionObject &e )
    {
      std::cerr << "ITK error: " << e.what() << std::endl;
    }

    std::ofstream outfile;
    outfile.open( outFileName );
    outfile << importInfo.dump();
    outfile.close();
  }

  return 0;
}
