# Configuration JSON File

By loading a JSON file, you can set VolView's configuration:

- Starting view layout (grid size, view types, or hierarchical layouts)
- Disabled view types
- Labels for tools
- Visibility of Sample Data section
- Keyboard shortcuts

## Starting view layout

VolView supports three ways to configure the initial view layout:

### 1. Simple Grid (gridSize)

The `gridSize` key sets the initial layout grid as `[width, height]`. For example, `[2, 2]` creates a 2x2 grid of views.

```json
{
  "layout": {
    "gridSize": [2, 2]
  }
}
```

### 2. Grid with View Types (2D String Array)

Use a 2D array of view type strings to specify both the grid layout and which views appear in each position:

```json
{
  "layout": [
    ["axial", "sagittal"],
    ["coronal", "volume"]
  ]
}
```

Available view type strings: `"axial"`, `"coronal"`, `"sagittal"`, `"volume"`, `"oblique"`

### 3. Nested Hierarchical Layout

For complex layouts, use a nested structure with full control over view placement and properties:

```json
{
  "layout": {
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
```

Direction values:
- `"row"` - items arranged horizontally
- `"column"` - items stacked vertically

You can also specify full view objects with custom options:

```json
{
  "layout": {
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
```

View object properties:
- 2D views: `type: "2D"`, `orientation: "Axial" | "Coronal" | "Sagittal"`, `name` (optional)
- 3D views: `type: "3D"`, `viewDirection` (optional), `viewUp` (optional), `name` (optional)
- Oblique views: `type: "Oblique"`, `name` (optional)

## Disabled View Types

Use `disabledViewTypes` to prevent certain view types from being available in the view type switcher:

```json
{
  "disabledViewTypes": ["3D", "Oblique"]
}
```

This removes the specified view types from the dropdown menu and replaces them in the default layout with allowed types. Valid values: `"2D"`, `"3D"`, `"Oblique"`

## Labels for tools

Each tool type (Rectangle, Polygon, etc.) can have tool specific labels. To share labels
across tools, define the `defaultLabels` key and don't provide labels for a tool that
should use the default labels.

```json
{
  "labels": {
    "defaultLabels": {
      "lesion": { "color": "#ff0000" },
      "tumor": { "color": "green", "strokeWidth": 3 }
    }
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

## Automatic Segment Groups by File Name

When loading files, VolView can automatically convert images to segment groups
if they follow a naming convention. For example, an image with name like `foo.segmentation.bar`
will be converted to a segment group for a base image named like `foo.baz`.
The `segmentation` extension is defined by the `io.segmentGroupExtension` key, which takes a
string. Files `foo.[segmentGroupExtension].bar` will be automatilly converted to segment groups for a base image named `foo.baz`. The default is `''` and will disable the feature.

This will define `myFile.seg.nrrd` as a segment group for a `myFile.nii` base file.

```json
{
  "io": {
    "segmentGroupExtension": "seg"
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
  "labels": {
    "defaultLabels": {
      "lesion": { "color": "#ff0000" },
      "tumor": { "color": "green", "strokeWidth": 3 }
    }
  },
  "layout": {
    "gridSize": [1, 1]
  }
}
```

## All options:

```json
{
  "labels": {
    "defaultLabels": {
      "lesion": { "color": "#ff0000" },
      "tumor": { "color": "green", "strokeWidth": 3 },
      "innocuous": { "color": "white" }
    },
    "rulerLabels": {
      "big": { "color": "#ff0000" },
      "small": { "color": "white" }
    },
    "rectangleLabels": {
      "red": { "color": "#ff0000", "fillColor": "transparent" },
      "green": { "color": "green", "fillColor": "transparent" },
      "white-yellow-fill": {
        "color": "white",
        "fillColor": "#00ff0030"
      }
    },
    "polygonLabels": {
      "poly1": { "color": "#ff0000" },
      "poly2Label": { "color": "green" }
    }
  },
  "layout": {
    "direction": "row",
    "items": [
      "volume",
      {
        "direction": "column",
        "items": ["axial", "coronal", "sagittal"]
      }
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
    "segmentGroupSaveFormat": "nrrd"
  }
}
```
