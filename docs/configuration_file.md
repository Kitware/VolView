# Configuration JSON File

By loading a JSON file, you can set VolView's configuration:

- Starting view layout grid size
- Labels for tools
- Visibility of Sample Data section
- Keyboard shortcuts

## Starting view layout

The `gridSize` key sets the initial layout grid as `[width, height]`. For example, `[2, 2]` creates a 2x2 grid of views.

```json
{
  "layout": {
    "gridSize": [2, 2]
  }
}
```

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

## Visibility of Sample Data section

Simplify the data browser by hiding the Sample Data expandable section.

```json
{
  "dataBrowser": {
    "hideSampleData": false
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
    "gridSize": [2, 2]
  },
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
