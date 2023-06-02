# Toolbar

## Layout

Use the layout button to choose between window arrangements. As in all things, if you have a particular layout that you would like to see added, please make a feature request on our ["issue tracker"](https://github.com/Kitware/VolView/issues).

![Layout](../gallery/07-volview-layout-notes.jpg)

## 2D View left mouse button

Window / Level, Pan, Zoom, or Crosshairs: Select these options to control the function of the left mouse button in the 2D windows.

![Window-Level, Pan, Zoom, Crosshairs](../gallery/10-volview-wl-pan-zoom-notes.jpg)

## 2D Annotations

### Paint

When the paint tool is selected, you can paint in any 2D window. Click on the paint tool a second time to bring up a menu of colors and adjust the brush size.

### Ruler

When the ruler tool selected, the left mouse button is used to place and adjust ruler end-markers. Right clicking on a end-marker displays a pop-up menu for deleting that ruler. Switch to the "Annotations" tab to see a list of annotations made to currently loaded data. Select the location icon next to a listed ruler to jump to its slice. Select the trashcan to delete that ruler.

Ruler annotations can be tagged with a label. Use the popup menu or the `q` or `w` keys to select the active label.

### Rectangle

When the rectangle tool selected, the left mouse button is used to place and adjust rectangle control points. Right click a rectangle end-marker to delete it. The "Annotations" tab lists all rectangles and provides jump-to, color editing, and delete controls.

Rectangle annotations can be tagged with a label. Use the popup menu or the `q` or `w` keys to select the active label.

![2D Annotations](../gallery/11-volview-paint-notes.jpg)

### Label Configuration

If VolView loads a JSON file matching the schemas below, labels are added to the 2D annotation tools.
Example configuration JSON:

```json
{
  "rulerLabels": {
    "big": { "color": "#ff0000" },
    "small": { "color": "white" }
  },
  "rectangleLabels": {
    "innocuous": { "color": "white", "fillColor": "#00ff0030" },
    "lesion": { "color": "#ff0000", "fillColor": "transparent" },
    "tumor": { "color": "green", "fillColor": "transparent" }
  }
}
```

Label sections could be null to disable labels for a tool.

```json
{
  "rulerLabels": null,
  "rectangleLabels": {
    "innocuous": {
      "color": "white",
      "fillColor": "#00ff0030"
    },
    "lesion": {
      "color": "#ff0000",
      "fillColor": "transparent"
    }
  }
}
```

Tools will fallback to `labels` section if the tool has no specific labels property,
ie `rectangleLabels` or `rulerLabels`.

```json
{
  "labels": {
    "artifact": { "color": "gray" },
    "needs-review": { "color": "#FFBF00" }
  }
}
```

## 3D Crop

Select this tool to adjust the extent of data shown in the 3D rendering. In the 3D window you can pick and move the corner, edge, and side markers to make adjustments. In the 2D windows, grab and move the edges of the bounding box overlaid on the data.

![Crop](../gallery/13-volview-crop.jpg)

[**_Watch the video!_**](https://youtu.be/Bj4ijh_VLUQ)
