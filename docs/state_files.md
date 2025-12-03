# State Files

VolView state files save your scene configuration: annotations, camera positions, colormaps, layouts, and more. There are two formats:

## Zip State Files (`*.volview.zip`)

Save by clicking the "Disk" icon in the toolbar. This embeds your image data that was loaded from local files alongside the application state. Useful for sharing annotations with collaborators.

## Sparse Manifest Files (`*.volview.json`)

JSON files that reference remote data via URIs instead of embedding it. Useful for:

- Linking to data hosted on servers
- Sharing annotations without duplicating large datasets
- Integrating with external systems (AI pipelines, access control, etc.)

Example manifest:

```json
{
  "version": "6.2.0",
  "dataSources": [
    { "id": 0, "type": "uri", "uri": "https://example.com/scan.zip" },
    { "id": 1, "type": "uri", "uri": "https://example.com/segmentation.nii.gz" }
  ],
  "segmentGroups": [
    {
      "id": "seg-1",
      "dataSourceId": 1,
      "metadata": {
        "name": "Tumor Segmentation",
        "parentImage": "0",
        "segments": {
          "order": [1],
          "byValue": {
            "1": { "value": 1, "name": "Tumor", "color": [255, 0, 0, 255] }
          }
        }
      }
    }
  ],
  "tools": {
    "rectangles": {
      "tools": [
        {
          "imageID": "0",
          "frameOfReference": {
            "planeNormal": [0, 0, 1],
            "planeOrigin": [0, 0, 50]
          },
          "slice": 50,
          "firstPoint": [-20, -20, 50],
          "secondPoint": [20, 20, 50],
          "label": "lesion"
        }
      ],
      "labels": {
        "lesion": { "color": "red" }
      }
    }
  }
}
```

## Loading State Files

- **Drag and drop** onto VolView
- **File browser** via the "Folder" icon below the save button
- **URL parameter**: `?urls=[https://example.com/session.volview.json]`
