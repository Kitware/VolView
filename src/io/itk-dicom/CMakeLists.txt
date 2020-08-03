cmake_minimum_required(VERSION 3.10)

project(dicom)

include(ExternalProject)

set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(io_components ITKImageIO)
if(EMSCRIPTEN)
  set(io_components BridgeJavaScript)
endif()
find_package(ITK REQUIRED
  COMPONENTS ${io_components}
    ITKSmoothing
    # for rescale image intensity
    ITKImageIntensity
    # for GDCMSeriesFileNames.h
    ITKIOGDCM
  )
include(${ITK_USE_FILE})

set(dicom_SRCS dicom.cpp charset.cpp)
if(EMSCRIPTEN)
  include(ITKBridgeJavaScript)

  # setup libiconv
  set(ICONV_DIR ${CMAKE_CURRENT_SOURCE_DIR}/libiconv)
  set(ICONV_BIN ${CMAKE_CURRENT_BINARY_DIR}/libiconv)
  ExternalProject_Add(libiconv
    SOURCE_DIR ${ICONV_DIR}
    URL "https://ftp.gnu.org/pub/gnu/libiconv/libiconv-1.16.tar.gz"
    URL_HASH SHA256=e6a1b1b589654277ee790cce3734f07876ac4ccfaecbee8afa0b649cf529cc04
    CONFIGURE_COMMAND emconfigure ${ICONV_DIR}/configure --srcdir=${ICONV_DIR} --prefix=${ICONV_BIN}
    BUILD_COMMAND emmake make
  )

  add_definitions(-DWEB_BUILD)
  web_add_executable(dicom ${dicom_SRCS})

  add_dependencies(dicom libiconv)
  include_directories(${ICONV_BIN}/include)
  target_link_libraries(dicom ${ICONV_BIN}/lib/libiconv.so)
else()
  add_executable(dicom ${dicom_SRCS})
endif()

target_link_libraries(dicom ${ITK_LIBRARIES})

