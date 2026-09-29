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
omitted one means the app default for a new segment. For an existing session segment,
omitted fields keep the appearance it had before configuration. Replacing a config entry
removes its previous appearance overrides, including color, while keeping the segment id,
visibility and lock state.

```json
{
  "segments": {
    "lesion": { "color": "#ff0000" },
    "tumor": { "color": "green", "strokeWidth": 3, "fillOpacity": 0.5 }
  }
}
```

Fields:

- `color` takes a hex value of 3, 4, 6 or 8 digits such as `#ff0000` (the 4 and 8 digit
  forms carry alpha) or a CSS color keyword such as `green`. Any other value is reported
  as an error and ignored.
- `fillOpacity` and `outlineOpacity`, from 0 to 1, set how strongly the segment's masks
  are filled and outlined. The Display sliders in "Annotations" scale them per image.
- `strokeWidth` sets the line width of the segment's rectangles, polygons and rulers.

Omitting the key leaves the registry alone. An empty record (`{}`) or `null` drops the
config's entries: a segment the config created is deleted unless a mask or shape
references it, and any other segment stays with its last configured appearance.

Entries are keyed by name. A configured segment keeps its id while its key stays the
same, so recoloring it never detaches its masks and shapes. Changing a key moves the
entry to the segment of the new name, adding one if none exists, and drops the old entry
as above. Applying a config again restores each key's name and configured appearance,
undoing a rename made in the app.

Configured segments outlive the images. Removing the last image deletes every other
segment and keeps these.

### Legacy `labels`

A legacy `labels` section is converted into `segments` at configuration ingestion, with
a deprecation warning. Runtime configuration contains only `segments`. Its
`defaultLabels`, `rulerLabels`, `rectangleLabels` and `polygonLabels` all describe the one
registry now, so they read as `segments` entries. A name that appears in more than one
becomes a single segment: the first record to declare it sets its appearance, reading
`rulerLabels`, `rectangleLabels` and `polygonLabels` in that order and `defaultLabels`
last. `defaultLabels` stood in for the tools that declared no record of their own, so it
is read only when at least one of the three tool records is omitted. A section whose
records are all omitted or `null` leaves the registry alone. A rectangle label's
`fillColor` is dropped with a warning, since fill color is a property of the rectangle
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

When loading multiple files, VolView can automatically associate related images based on file naming patterns.
Example: `base.[extension].nrrd` will match `base.nii`.

The extension must appear anywhere in the filename after splitting by dots, and the filename must start with the same prefix as the base image (everything before the first dot). Files matching `base.[extension]...` will be associated with a base image named `base.*`.

**Ordering:** When multiple layers match a base image, they are sorted alphabetically by filename and added to the stack in that order. To control the stacking order explicitly, you could use numeric prefixes in your filenames. Matching segmentation files each add their labels as segments to the base image's one segmentation.

For example, with a base image `patient001.nrrd`:

- Layers (sorted alphabetically): `patient001.layer.1.pet.nii`, `patient001.layer.2.ct.mha`, `patient001.layer.3.overlay.vtk`
- Segmentations: `patient001.seg.1.tumor.nii.gz`, `patient001.seg.2.lesion.mha`

Both features default to `''` which disables them.

### Segmentations

Use `segmentationExtension` to automatically import the labels of matching non-DICOM images as segments.
For example, `myFile.seg.nrrd` adds its labels as segments on `myFile.nii`.
Defaults to `''` which disables matching.

```json
{
  "io": {
    "segmentationExtension": "seg"
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
