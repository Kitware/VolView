#include "itkSpatialObjectReader.h"
#include "itkTubeSpatialObject.h"

#include "json.hpp"

using json = nlohmann::json;

json readTRE(const std::string &filename);
