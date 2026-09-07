# Configuration JSON File

By loading a JSON file, you can set VolView's configuration:

- View layouts (grid size, view types, or hierarchical layouts)
- Disabled view types
- Segments
- Visibility of Sample Data section
- Keyboard shortcuts

## Loading Configuration Files

Include configuration files in the `urls` URL parameter. VolView recognizes
configuration JSON by its contents and applies it before displaying imported
data:

```
https://volview.kitware.com/?urls=[https://example.com/data.nrrd,https://example.com/config.json]
```

## View Layouts

Define one or more named layouts using the `layouts` key. VolView will use the first layout as the default. Each named layout will be in the layout selector menu. Layout are specified in three formats:

### 1. Grid with View Types (2D String Array)

Use a 2D array of view type strings to specify both the grid layout and which views appear in each position:

```json
{
  "layouts": {
    "Four Up": [
      ["axial", "coronal"],
      ["sagittal", "volume"]
    ]
  }
}
```

Available view type strings: `"axial"`, `"coronal"`, `"sagittal"`, `"volume"`, `"oblique"`

### 2. Simple Grid (gridSize)

Use `gridSize` to set the layout grid as `[width, height]`. For example, `[2, 2]` creates a 2x2 grid of views:

```json
{
  "layouts": {
    "Four by Four": {
      "gridSize": [2, 2]
    }
  }
}
```

### 3. Nested Hierarchical Layout

For complex layouts, use a nested structure with full control over view placement and properties:

```json
{
  "layouts": {
    "Volume Primary": {
      "direction": "row",
      "items": [
        "volume",
        {
          "direction": "column",
          "items": ["axial", "coronal", "sagittal"]
        }
      ]
    }
  }
}
```

Direction values:

- `"row"` - items arranged horizontally
- `"column"` - items stacked vertically

You can also specify full view objects with custom options:

```json
{
  "layouts": {
    "Custom 3D Orientation": {
      "direction": "column",
      "items": [
        {
          "type": "3D",
          "name": "Top View",
          "viewDirection": "Superior",
          "viewUp": "Anterior"
        },
        {
          "direction": "row",
          "items": [
            { "type": "2D", "orientation": "Axial" },
            { "type": "2D", "orientation": "Coronal" }
          ]
        }
      ]
    }
  }
}
```

View object properties:

- 2D views: `type: "2D"`, `orientation: "Axial" | "Coronal" | "Sagittal"`, `name` (optional)
- 3D views: `type: "3D"`, `viewDirection` (optional), `viewUp` (optional), `name` (optional)
- Oblique views: `type: "Oblique"`, `name` (optional)

### Multiple Layouts Example

You can define multiple named layouts that users can switch between:

```json
{
  "layouts": {
    "Four up": [
      ["axial", "coronal"],
      ["sagittal", "volume"]
    ],
    "Volume focus": {
      "direction": "row",
      "items": [
        "volume",
        {
          "direction": "column",
          "items": ["axial", "coronal", "sagittal"]
        }
      ]
    }
  }
}
```

## Disabled View Types

Use `disabledViewTypes` to prevent certain view types from being available in the view type switcher:

```json
{
  "disabledViewTypes": ["3D", "Oblique"]
}
```

This removes the specified view types from the dropdown menu and replaces them in the default layout with allowed types. Valid values: `"2D"`, `"3D"`, `"Oblique"`

## Segments

Paint, rectangles, polygons and rulers share one registry of segments, configured under
`segments`. Each entry is keyed by name, and every appearance field is optional: an
omitted one means the app default.

```json
{
  "segments": {
    "lesion": { "color": "#ff0000" },
    "tumor": { "color": "green", "strokeWidth": 3, "fillOpacity": 0.5 }
  }
}
```

Fields: `color`, `fillOpacity`, `outlineOpacity`, `strokeWidth`.

Omitting the key leaves the registry alone. An empty record (`{}`) or `null` clears what an
earlier config contributed, keeping any segment your content still references. A configured
segment keeps its id across config changes, so renaming or recoloring one never detaches
the masks and shapes that reference it.

### Pre-7.0 `labels`

A pre-7.0 `labels` section still loads. Its `defaultLabels`, `rulerLabels`,
`rectangleLabels` and `polygonLabels` all describe the one registry now, so they read as
`segments` entries. A name that appears in more than one becomes a single segment: the
first record to declare it sets its appearance, reading `rulerLabels`, `rectangleLabels`
and `polygonLabels` in that order and `defaultLabels` last, since it stood in only for the
tools that declared no record of their own. A rectangle label's `fillColor` is dropped,
since fill color is a property of the rectangle rather than of the segment. A config
carrying both `segments` and `labels` has been converted already, so `segments` is read
and `labels` is ignored.

Converting a config by hand:

```json
{
  "labels": {
    "defaultLabels": { "lesion": { "color": "#ff0000" } },
    "rulerLabels": { "big": { "color": "#ff0000" } }
  }
}
```

becomes

```json
{
  "segments": {
    "lesion": { "color": "#ff0000" },
    "big": { "color": "#ff0000" }
  }
}
```

## Segment Group File Format

The `segmentGroupSaveFormat` key specifies the file extension of the segment group images
VolView will include in the volview.zip file.

```json
{
  "io": {
    "segmentGroupSaveFormat": "nii"
  }
}
```

Working segment group file formats:

hdf5, iwi.cbor, mha, nii, nii.gz, nrrd, vtk

## Automatic Layers and Segment Groups by File Name

When loading multiple files, VolView can automatically associate related images based on file naming patterns.
Example: `base.[extension].nrrd` will match `base.nii`.

The extension must appear anywhere in the filename after splitting by dots, and the filename must start with the same prefix as the base image (everything before the first dot). Files matching `base.[extension]...` will be associated with a base image named `base.*`.

**Ordering:** When multiple layers/segment groups match a base image, they are sorted alphabetically by filename and added to the stack in that order. To control the stacking order explicitly, you could use numeric prefixes in your filenames.

For example, with a base image `patient001.nrrd`:

- Layers (sorted alphabetically): `patient001.layer.1.pet.nii`, `patient001.layer.2.ct.mha`, `patient001.layer.3.overlay.vtk`
- Segment groups: `patient001.seg.1.tumor.nii.gz`, `patient001.seg.2.lesion.mha`

Both features default to `''` which disables them.

### Segment Groups

Use `segmentGroupExtension` to automatically convert matching non-DICOM images to segment groups.
For example, `myFile.seg.nrrd` becomes a segment group for `myFile.nii`.
Defaults to `''` which disables matching.

```json
{
  "io": {
    "segmentGroupExtension": "seg"
  }
}
```

### Layering

Use `layerExtension` to automatically layer matching non-DICOM images on top of the base image. For example, `myImage.layer.nii` is layered on top of `myImage.nii`.
Defaults to `''` which disables matching.

```json
{
  "io": {
    "layerExtension": "layer"
  }
}
```

## Keyboard Shortcuts

Configure the keys to activate tools, change selected labels, and more.
All [shortcut actions](https://github.com/Kitware/VolView/blob/main/src/constants.ts#L53) are under the `ACTIONS` variable.

To configure a key for an action, add its action name and the key(s) under the `shortcuts` section. For key combinations, use `+` like `Ctrl+f`.

```json
{
  "shortcuts": {
    "polygon": "Ctrl+p",
    "showKeyboardShortcuts": "t"
  }
}
```

## Example JSON:

```json
{
  "segments": {
    "lesion": { "color": "#ff0000" },
    "tumor": { "color": "green", "strokeWidth": 3 }
  },
  "layouts": {
    "single-view": {
      "gridSize": [1, 1]
    }
  }
}
```

## All options:

```json
{
  "segments": {
    "lesion": { "color": "#ff0000" },
    "tumor": { "color": "green", "strokeWidth": 3, "fillOpacity": 0.5 },
    "innocuous": { "color": "white", "outlineOpacity": 0.8 }
  },
  "layouts": {
    "Volume primary": {
      "direction": "row",
      "items": [
        "volume",
        {
          "direction": "column",
          "items": ["axial", "coronal", "sagittal"]
        }
      ]
    },
    "Four up": [
      ["axial", "coronal"],
      ["sagittal", "volume"]
    ]
  },
  "disabledViewTypes": ["Oblique"],
  "dataBrowser": {
    "hideSampleData": false
  },
  "shortcuts": {
    "polygon": "Ctrl+p",
    "showKeyboardShortcuts": "t"
  },
  "io": {
    "segmentGroupSaveFormat": "nrrd",
    "segmentGroupExtension": "seg",
    "layerExtension": "layer"
  }
}
```
