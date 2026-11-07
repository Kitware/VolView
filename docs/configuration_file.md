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

Available view type strings: `"axial"`, `"coronal"`, `"sagittal"`, `"volume"`, `"oblique"`, `"enface"`

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
- En face views: `type: "EnFace"`, `name` (optional)

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

This removes the specified view types from the dropdown menu and replaces them in the default layout with allowed types. Valid values: `"2D"`, `"3D"`, `"Oblique"`, `"EnFace"`.

## Segments

Use `segments` to define segments by name. Paint, rectangles, polygons and rulers on
an image share its segments.

```json
{
  "segments": {
    "lesion": { "color": "#ff0000" },
    "tumor": { "color": "green", "strokeWidth": 3, "fillOpacity": 0.5 }
  }
}
```

- `color`: a 3, 4, 6 or 8 digit hex value (4 and 8 include alpha), or a CSS color
  keyword. Invalid colors are reported and ignored.
- `fillOpacity` and `outlineOpacity`: mask fill and outline opacity, from 0 to 1.
  The Display sliders in "Annotations" scale these per image.
- `strokeWidth`: line width for rectangles, polygons and rulers.

All fields are optional. On a new segment, omitted fields use the app defaults.
On an existing segment matched by name, omitted fields preserve its underlying
appearance.

A configuration, whether loaded on its own or with images, applies to every loaded
image by name. A loaded image without segments yet takes the configured segments as
its set. The configured segments also become the starting set for new images with no
earlier image to copy from.

Opening a saved session replaces these starting defaults when the session includes
its own defaults. An explicitly empty list clears them; a session without saved
defaults leaves them unchanged. Loading a configuration afterward sets the starting
defaults again. Each image's saved segment set is restored independently of these
defaults.

Applying a configuration again restores each configured name and appearance. Omitting
`segments` changes nothing. `{}` or `null` removes only unreferenced segments that
the configuration created. Segments matched by name and segments that hold masks
or shapes remain.

### Legacy `labels`

A legacy `labels` section is converted into `segments` at configuration ingestion, with
a deprecation warning. Runtime configuration contains only `segments`. Its
`defaultLabels`, `rulerLabels`, `rectangleLabels` and `polygonLabels` become `segments`
entries shared by the tools on each image. A name that appears in more than one
becomes a single segment: the first record to declare it sets its appearance, reading
`rulerLabels`, `rectangleLabels` and `polygonLabels` in that order and `defaultLabels`
last. `defaultLabels` stood in for the tools that declared no record of their own, so it
is read only when at least one of the three tool records is omitted. A section whose
records are all omitted or `null` leaves segment definitions unchanged. A rectangle
label's `fillColor` is dropped with a warning, since fill color is a property of the rectangle
rather than of the segment. A config carrying both `segments` and `labels` has been
converted already, so `segments` is read, `labels` is ignored, and the warning says so.

Converting a config by hand:

```json
{
  "labels": {
    "defaultLabels": { "lesion": { "color": "#ff0000" } },
    "rulerLabels": { "big": { "color": "#ff0000" } }
  }
}
```

becomes, with the segments in the order VolView reads them:

```json
{
  "segments": {
    "big": { "color": "#ff0000" },
    "lesion": { "color": "#ff0000" }
  }
}
```

## Session Mask File Format

The `segmentationSaveFormat` key specifies the file extension of the mask images
VolView will include in the volview.zip file.

```json
{
  "io": {
    "segmentationSaveFormat": "nii"
  }
}
```

This setting controls mask files inside saved sessions, independently of the
explicit segmentation export dialog.

Working mask file formats:

hdf5, iwi.cbor, mha, nii, nii.gz, nrrd, vtk

## Automatic Layers and Segmentations by File Name

When loading non-DICOM images together from disk, a ZIP archive, or URL parameters, VolView can associate them by filename.

A matching filename must contain the configured extension as a dot-separated part. It must also start with the base image's prefix (everything before the first dot), followed by a dot, dash, or underscore.

For `segmentationExtension: "seg"` and a base image named `patient001.nrrd`:

- `patient001.seg.nii.gz` matches, even though the image formats differ.
- `patient001-tumor.seg.nrrd` and `patient001_tumor.seg.nrrd` both match.
- `patient0012.seg.nrrd` does not match because the base prefix is followed by a digit.

### Segmentations

`segmentationExtension` defaults to `seg`, so matching works without a configuration file. Each matching file adds its labels as segments to the base image's one segmentation. Set this option to `''` to disable matching, or use another value for a different naming convention.

```json
{
  "io": {
    "segmentationExtension": "seg"
  }
}
```

### Layering

`layerExtension` defaults to `''`, which disables matching. Set it to a naming marker such as `layer` to load matching images as layers above the base image:

```json
{
  "io": {
    "layerExtension": "layer"
  }
}
```

Matching layers are sorted alphabetically by filename and added to the stack in that order. Numeric filename parts can control this order: for `patient001.nrrd`, `patient001.layer.1.pet.nii` is added before `patient001.layer.2.ct.mha`.

## Renamed `io` Keys

The keys `io.segmentGroupExtension` and `io.segmentGroupSaveFormat` are still read,
converted to `io.segmentationExtension` and `io.segmentationSaveFormat`, and reported
with a deprecation warning. If both spellings of a key are present, their values must
match or the configuration is rejected.

## Keyboard Shortcuts

Configure the keys to activate tools, change the selected segment, and more.
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
    "segmentationSaveFormat": "nrrd",
    "segmentationExtension": "seg",
    "layerExtension": "layer"
  }
}
```
