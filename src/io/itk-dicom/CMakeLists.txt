cmake_minimum_required(VERSION 3.10)

project(dicom)

set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(io_components ITKImageIO)
if(EMSCRIPTEN)
  set(io_components BridgeJavaScript)
endif()
find_package(ITK REQUIRED
  COMPONENTS ${io_components}
    ITKSmoothing
    # for GDCMSeriesFileNames.h
    ITKIOGDCM
  )
include(${ITK_USE_FILE})

set(dicom_SRCS dicom.cpp)
if(EMSCRIPTEN)
  include(ITKBridgeJavaScript)
  web_add_executable(dicom ${dicom_SRCS})

else()
  add_executable(dicom ${dicom_SRCS})
endif()

target_link_libraries(dicom ${ITK_LIBRARIES})

