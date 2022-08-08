cmake_minimum_required(VERSION 3.10)

project(dicom)

include(FetchContent)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(dicom_SRCS dicom.cpp)

if(EMSCRIPTEN)
  add_definitions(-DWEB_BUILD)
endif()

############################################
# setup ITK
############################################

set(io_components ITKImageIO)
find_package(ITK REQUIRED
  COMPONENTS ${io_components}
    ITKSmoothing
    # for rescale image intensity
    ITKImageIntensity
    # for GDCMSeriesFileNames.h
    ITKIOGDCM
    ITKGDCM
    # spatial objects
    ITKMesh
    ITKSpatialObjects
    ITKIOSpatialObjects
    WebAssemblyInterface
  )

include(${ITK_USE_FILE})

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
# parent project
############################################

add_executable(dicom ${dicom_SRCS})
target_link_libraries(dicom PRIVATE ${ITK_LIBRARIES} nlohmann_json::nlohmann_json)

if(NOT EMSCRIPTEN)
  target_link_libraries(dicom PRIVATE stdc++fs)
endif()
