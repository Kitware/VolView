# Toolbar

## Layout

Use the layout button to choose between window arrangements. Each view can display a different dataset. Use the view type switcher dropdown in each view to change between 2D slice, 3D volume, or oblique views. Double-click a view to maximize it.

![Layout](./assets/07-volview-layout-notes.jpg)

## 2D View left mouse button

Window / Level, Pan, Zoom, or Crosshairs: Select these options to control the function of the left mouse button in the 2D windows.

![Window-Level, Pan, Zoom, Crosshairs](./assets/10-volview-wl-pan-zoom-notes.jpg)

## 2D Annotations

The "Annotations" tab lists segments shared by paint, rectangles, polygons and rulers.
Select a segment in the list or use `q` and `w` to cycle through segments. Use "New
segment" to add one, and its color dot or edit button to change its name and appearance.
The selection applies across all four tools and images.

Expand a segment to see its shapes on the current image. Each shape has controls to
jump to its slice or cine frame and to delete it. A segment's Reveal button jumps to
its mask or shapes on the current image; it stays disabled when there is no content.

### Paint

When the paint tool is selected, you can paint in any supported 2D slice window.
Choose the segment in "Annotations" and use the Paint controls below the segment
list to adjust brush size, switch to erasing, or set an intensity threshold.
Painting adds a mask for the selected segment on the image being painted.

Painting over another segment takes those voxels from it. A locked segment keeps
its voxels: painting goes around it. Turn on "Allow Overlap" to paint over other
segments without taking anything from them, so the segments overlap. The same
rules apply when a polygon is rasterized.

### Rectangle

When the rectangle tool is selected, the left mouse button is used to place and adjust rectangle control points.
Right click a rectangle control point to delete the rectangle.
The "Annotations" tab lists all rectangles and provides jump-to and delete controls.

New rectangles use the selected segment from "Annotations".

### Polygon

With the polygon tool selected:

- Place points: left mouse button.
- Remove last placed point: right mouse button.
- Remove all points: `Esc` key.
- Close a polygon after placing 3 points: Click first point, press `Enter` key or double click left mouse.

After closing a polygon:

- Move point: Drag point with left mouse button.
- Add point: Left mouse button on polygon line.
- Delete point: right click point and select Delete Point.
- Delete polygon: right click point or line and select Delete Polygon.

New polygons use the selected segment from "Annotations".

### Ruler

When the ruler tool is selected, the left mouse button places and adjusts ruler
end-markers. Right clicking an end-marker displays a menu for deleting that ruler.
Expand its segment in "Annotations" to see its length, jump to its slice or cine
frame, or delete it.

New rulers use the selected segment from "Annotations".

![2D Annotations](./assets/11-volview-paint-notes.jpg)

### Segment configuration

If VolView loads a JSON file matching the schema below, segments are added to the
registry. Paint, rectangles, polygons and rulers all share `segments`. Appearance
fields are optional. See [segment configuration](./configuration_file.md#segments)
for replacement behavior and how omitted fields use session appearance or defaults.

```json
{
  "segments": {
    "innocuous": { "color": "white" },
    "lesion": { "color": "#ff0000" },
    "tumor": { "color": "green", "strokeWidth": 3 }
  }
}
```

The section can be `null` or `{}` to clear what an earlier config contributed. A segment your
content still references survives as a session segment rather than taking its masks and
shapes with it.

## 3D Crop

Select this tool to adjust the extent of data shown in the 3D rendering. In the 3D window you can pick and move the corner, edge, and side markers to make adjustments. In the 2D windows, grab and move the edges of the bounding box overlaid on the data.

![Crop](./assets/13-volview-crop.jpg)

[**_Watch the video!_**](https://youtu.be/Bj4ijh_VLUQ)
