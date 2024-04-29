cmake_minimum_required(VERSION 3.16)
project(Resample)

set(CMAKE_CXX_STANDARD 17)

find_package(ITK REQUIRED
  COMPONENTS
    WebAssemblyInterface
    ITKImageGrid
    ITKImageFunction
    GenericLabelInterpolator
  )
include(${ITK_USE_FILE})

add_executable(resample resample.cxx)
target_link_libraries(resample PUBLIC ${ITK_LIBRARIES})

