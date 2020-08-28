cmake_minimum_required(VERSION 3.10)

project(dicom)

include(ExternalProject)
include(FetchContent)

set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(dicom_SRCS dicom.cpp charset.cpp readTRE.cpp)

if(EMSCRIPTEN)
  add_definitions(-DWEB_BUILD)
endif()

############################################
# setup ITK
############################################

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
    # spatial objects
    ITKMesh
    ITKSpatialObjects
    ITKIOSpatialObjects
  )

include(${ITK_USE_FILE})

if(EMSCRIPTEN)
  include(ITKBridgeJavaScript)
endif()

############################################
# setup third party directory
############################################

set(THIRDPARTY_DIR ${CMAKE_BINARY_DIR}/thirdparty)
file(MAKE_DIRECTORY ${THIRDPARTY_DIR})

############################################
# download json.hpp
############################################

set(JSON_DIR ${THIRDPARTY_DIR}/json)
FetchContent_Declare(json
  PREFIX ${JSON_DIR}
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG v3.9.0
  GIT_SHALLOW ON)

FetchContent_GetProperties(json)
if(NOT json_POPULATED)
  FetchContent_Populate(json)
  add_subdirectory(${json_SOURCE_DIR} ${json_BINARY_DIR} EXCLUDE_FROM_ALL)
endif()

############################################
# download libiconv
############################################

set(ICONV libiconv)
set(ICONV_DIR ${THIRDPARTY_DIR}/libiconv)
file(MAKE_DIRECTORY ${ICONV_DIR})

if(EMSCRIPTEN)
  set(ICONV_CONFIGURE_COMMAND emconfigure ${ICONV_DIR}/src/${ICONV}/configure --srcdir=${ICONV_DIR}/src/${ICONV} --prefix=${ICONV_DIR} --enable-static)
  set(ICONV_BUILD_COMMAND emmake make)
else()
  set(ICONV_CONFIGURE_COMMAND ${ICONV_DIR}/src/${ICONV}/configure --srcdir=${ICONV_DIR}/src/${ICONV} --prefix=${ICONV_DIR} --enable-static)
  set(ICONV_BUILD_COMMAND make)
endif()

ExternalProject_Add(${ICONV}
  PREFIX ${ICONV_DIR}
  URL "https://ftp.gnu.org/pub/gnu/libiconv/libiconv-1.16.tar.gz"
  URL_HASH SHA256=e6a1b1b589654277ee790cce3734f07876ac4ccfaecbee8afa0b649cf529cc04
  CONFIGURE_COMMAND ${ICONV_CONFIGURE_COMMAND}
  BUILD_COMMAND ${ICONV_BUILD_COMMAND}
  # needed for ninja generator
  BUILD_BYPRODUCTS ${ICONV_DIR}/lib/${CMAKE_STATIC_LIBRARY_PREFIX}iconv${CMAKE_STATIC_LIBRARY_SUFFIX}
)

file(MAKE_DIRECTORY ${ICONV_DIR}/include)

add_library(iconv STATIC IMPORTED)
set_target_properties(iconv PROPERTIES
  IMPORTED_LOCATION ${ICONV_DIR}/lib/${CMAKE_STATIC_LIBRARY_PREFIX}iconv${CMAKE_STATIC_LIBRARY_SUFFIX}
  INTERFACE_INCLUDE_DIRECTORIES ${ICONV_DIR}/include)

add_dependencies(iconv ${ICONV})

############################################
# parent project
############################################

add_executable(dicom ${dicom_SRCS})
target_include_directories(dicom PRIVATE ${ICONV_DIR}/include)
target_link_libraries(dicom PRIVATE ${ITK_LIBRARIES} iconv nlohmann_json::nlohmann_json)
