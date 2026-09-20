# State Files

VolView state files save your scene configuration: annotations, camera positions, colormaps, layouts, and more. There are two formats:

## Zip State Files (`*.volview.zip`)

Save by clicking the "Disk" icon in the toolbar. This embeds your image data that was loaded from local files alongside the application state. Useful for sharing annotations with collaborators.

## Sparse Manifest Files (`*.volview.json`)

JSON files that reference remote data via URIs instead of embedding it. Useful for:

- Linking to data hosted on servers
- Sharing annotations without duplicating large datasets
- Integrating with external systems (AI pipelines, access control, etc.)

### Current manifest (version 7.0.0)

A segmentation owns one image's segment masks; labelmaps encode those masks for
storage or interchange. The top-level `segments` list holds the identities the
masks paint (name, color, visibility), each mask names the segment it carries
voxels for, and `order` lists the masks of that segmentation.

A mask saved into a zip names its own archive entry with `path`. A sparse
manifest instead points at a whole label volume: `segmentationArtifacts` names
that volume, its `dataSourceId` says where the bytes come from, and each mask
whose `artifactId` points at it is filled from the `sourceValue` it declares.
Extents are placeholders until the volume is read.

```json
{
  "version": "7.0.0",
  "dataSources": [
    { "id": 0, "type": "uri", "uri": "https://example.com/scan.zip" },
    { "id": 1, "type": "uri", "uri": "https://example.com/segmentation.nii.gz" }
  ],
  "segments": [
    {
      "id": "segment-tumor",
      "name": "Tumor",
      "color": [255, 0, 0, 255],
      "visible": true,
      "locked": false
    }
  ],
  "segmentations": [
    {
      "id": "segmentation-0",
      "name": "Tumor Segmentation",
      "parentImage": "0",
      "masks": [
        {
          "id": "mask-tumor",
          "segmentId": "segment-tumor",
          "representations": {
            "labelmap": {
              "artifactId": "labelmap-1",
              "sourceValue": 1,
              "extent": [0, -1, 0, -1, 0, -1]
            }
          }
        }
      ],
      "order": ["mask-tumor"]
    }
  ],
  "segmentationArtifacts": [
    {
      "id": "labelmap-1",
      "parentImage": "0",
      "name": "Tumor Segmentation",
      "dataSourceId": 1
    }
  ],
  "selectedSegment": "segment-tumor"
}
```

### Legacy 6.2.0 manifest (the pre-7.0.0 form, still read on import)

The historical `segmentGroups` field is migrated into the current segmentation
model on load, and the per-tool `labels` records become segments the tools
reference by id. Nothing writes this form any more.

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
