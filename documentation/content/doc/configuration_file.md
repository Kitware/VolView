# Configuration JSON File

By loading a JSON file, you can set VolView's:

- Starting view layout (Axial Only, 3D Primary, etc).
- Labels for tools
- Visibility of Sample Data section
- Keyboard shortcuts

## Starting view layout

The `activeLayout` key has options (Axial Only, 3D Primary, etc.) defined in `config.ts`

```json
{
  "layout": {
    "activeLayout": "Axial Only"
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

These are the supported file formats:

hdf5, iwi.cbor, mha, nii, nii.gz, nrrd, vtk

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
    "activeLayout": "Axial Only"
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
    "activeLayout": "Axial Only"
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
