cmake_minimum_required(VERSION 3.10)

project(dicom)

include(ExternalProject)

set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(dicom_SRCS dicom.cpp charset.cpp)

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

set(THIRDPARTY_DIR ${CMAKE_BINARY_DIR}/thirdparty)
file(MAKE_DIRECTORY ${THIRDPARTY_DIR})

# download json.hpp
set(JSON_DIR ${THIRDPARTY_DIR}/json)
file(MAKE_DIRECTORY ${JSON_DIR})
set(JSON_URL "https://raw.githubusercontent.com/nlohmann/json/e110667d210698b5df3341244bfb4c454ac392f1/single_include/nlohmann/json.hpp")
file(DOWNLOAD ${JSON_URL} ${JSON_DIR}/json.hpp
  # ver 3.9.0
  EXPECTED_HASH SHA256=d8089d52d285ef2c5368eb39ae665b39ea464206b1ca674a88a915c0245ff4f0
)

include_directories(${JSON_DIR})

# setup libiconv
if(EMSCRIPTEN)
  set(ICONV_DIR ${THIRDPARTY_DIR}/libiconv-web)
  set(ICONV_BIN ${CMAKE_CURRENT_BINARY_DIR}/libiconv-web)
  set(ICONV_CONFIGURE_COMMAND emconfigure ${ICONV_DIR}/configure --srcdir=${ICONV_DIR} --prefix=${ICONV_BIN})
  set(ICONV_BUILD_COMMAND emmake make)
else()
  set(ICONV_DIR ${THIRDPARTY_DIR}/libiconv)
  set(ICONV_BIN ${CMAKE_CURRENT_BINARY_DIR}/libiconv)
  set(ICONV_CONFIGURE_COMMAND ${ICONV_DIR}/configure --srcdir=${ICONV_DIR} --prefix=${ICONV_BIN})
  set(ICONV_BUILD_COMMAND make)
endif()

ExternalProject_Add(libiconv
  SOURCE_DIR ${ICONV_DIR}
  URL "https://ftp.gnu.org/pub/gnu/libiconv/libiconv-1.16.tar.gz"
  URL_HASH SHA256=e6a1b1b589654277ee790cce3734f07876ac4ccfaecbee8afa0b649cf529cc04
  CONFIGURE_COMMAND ${ICONV_CONFIGURE_COMMAND}
  BUILD_COMMAND ${ICONV_BUILD_COMMAND}
)

include_directories(${ICONV_BIN}/include)
link_directories(${ICONV_BIN}/lib)

if(EMSCRIPTEN)
  include(ITKBridgeJavaScript)
  add_definitions(-DWEB_BUILD)
  web_add_executable(dicom ${dicom_SRCS})
else()
  add_executable(dicom ${dicom_SRCS})
endif()

add_dependencies(dicom libiconv)
target_link_libraries(dicom ${ITK_LIBRARIES} iconv)
