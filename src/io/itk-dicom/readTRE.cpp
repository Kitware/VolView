#include <iostream>

#include "json.hpp"

#include "readTRE.hpp"

using ReaderType = itk::SpatialObjectReader<3, float>;
using SpatialObjectType = itk::SpatialObject<3>;
using TubeType = itk::TubeSpatialObject<3>;
using TubePointType = TubeType::TubePointType;

json serializeTree(const SpatialObjectType::Pointer &so) {
  json data;

  data["Id"] = so->GetId();

  const TubeType::Pointer tube = dynamic_cast<TubeType *>(so.GetPointer());
  if (tube != nullptr) {
    json pointList = json::array();

    TubeType::TubePointListType points = tube->GetPoints();
    for (auto it = points.begin(); it != points.end(); ++it) {
      json pointData;
      auto point = *it;
      auto posWorldSpace = point.GetPositionInWorldSpace();
      auto posObjSpace = point.GetPositionInObjectSpace();

      pointData["Id"] = point.GetId();
      pointData["RadiusInWorldSpace"] = point.GetRadiusInWorldSpace();
      // pointData["RadiusInObjectSpace"] = point.GetRadiusInObjectSpace();
      pointData["PositionInWorldSpace"] =
          json::array({posWorldSpace[0], posWorldSpace[1], posWorldSpace[2]});
      // pointData["PositionInObjectSpace"] = json::array({
      //   posObjSpace[0],
      //   posObjSpace[1],
      //   posObjSpace[2]
      // });
      pointData["Color"] = json::array({
          point.GetRed(),
          point.GetGreen(),
          point.GetBlue(),
          point.GetAlpha(),
      });

      pointList.push_back(pointData);
    }

    data["Points"] = pointList;
  }

  json childrenData = json::array();
  auto children = so->GetChildren();
  for (auto it = children->begin(); it != children->end(); ++it) {
    childrenData.push_back(serializeTree(*it));
  }
  delete children;

  data["Children"] = childrenData;

  return data;
}

json readTRE(const std::string &filename) {
  ReaderType::Pointer reader = ReaderType::New();
  reader->SetFileName(filename);
  reader->Update();

  auto group = reader->GetGroup();
  return serializeTree(group);
}
