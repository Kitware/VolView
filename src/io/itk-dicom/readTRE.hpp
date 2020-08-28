#include <nlohmann/json.hpp>

#include "itkSpatialObjectReader.h"
#include "itkTubeSpatialObject.h"

using json = nlohmann::json;

json readTRE(const std::string &filename);
