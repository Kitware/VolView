# State Files

State files save your scene so you can return to your work later or share it with others. They preserve annotations, segmentations, camera positions, colormaps, layouts, and other view settings.

## Saving a Scene

Click the **Save** (disk) icon in the toolbar to download a `*.volview.zip` file. Images loaded from local files are included alongside the saved scene.

## Linked State Files

A `*.volview.json` file references data hosted on a server instead of including it in the file. This lets workflows and external applications open a prepared scene without copying large datasets. Anyone opening the scene needs access to the referenced data.

## Loading a Saved Scene

- Drag and drop a state file onto VolView.
- Click the **Load** (folder) icon in the toolbar and select a state file.
- Open a link that includes a state file in the `urls` parameter, such as `?urls=[https://example.com/session.volview.json]`.
