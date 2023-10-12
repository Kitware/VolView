# Loading Data

The most straightfoward way to load files into VolView is to drag-and-drop them onto the central window when viewing the "Data" tab. You can also click within the central window to open a file browser and select the files or folders the "Open" button on the top-right toolbar. To complement different use-cases, there are a few other ways to open files.

## File formats

VolView can load multiple DICOM files, folders containing multiple DICOM files, or zipped files containing multiple DICOM files. It also supports loading Nifti, NRRD, MHA, and 20+ other file formats thanks to the extensive I/O capabilities of ITK and itk.wasm, but care must be taken when loading non-DICOM data as the orientation of the data in those files cannot be assured.

## Sample Data

VolView includes links to a variety of sample data. Clicking on those thumbnails in the Data tab will download that data from Kitware data.kitware.com website into your local machine.

## DICOMWeb

VolView lists and downloads DICOM files served by a DICOMWeb service. The host address of the DICOMWeb service is configurable by:

- VolView settings menu
- `dicomweb` URL parameter. Example: `https://volview.kitware.app/?dicomweb=https://dicomweb-server.com`
- At VolView build time with the `VITE_DICOM_WEB_URL` environment variable.

The DICOMWeb address can point to a specific series in a study, and VolView will
automatically load the whole series. Example URL:

```
https://volview.kitware.app/?dicomweb=https://dicomweb-server.com/studies/unique-study-id-here/series/unique-series-id-here
```

## Loading Remote Data via URLs

VolView supports loading remote datasets at application start through URL parameters. An example of this integration in action can be viewed here: [VolView with sample data](https://volview.kitware.app/?names=[prostate-mri.zip,neck.mha]&urls=[https://data.kitware.com/api/v1/item/63527c7311dab8142820a338/download,https://data.kitware.com/api/v1/item/620db4b84acac99f42e75420/download])

The URL is constructed with two parts, as shown below. The required parameter is the `urls` parameter, which specifies a list of URLs to download. An optional `names` parameter specifies the filename to go along with the file. If VolView cannot infer the file type, the filename's extension is used as a fallback. Loading multiple URLs is achieved by separating them with a comma.

```
https://volview.kitware.app/?names=[prostate-mri.zip,neck.mha]&urls=[https://data.kitware.com/api/v1/item/63527c7311dab8142820a338/download,https://data.kitware.com/api/v1/item/620db4b84acac99f42e75420/download]
```

### Google Cloud Storage Bucket and AWS S3 Support

VolView supports both Google Cloud Storage links of the form
`gs://<bucket>/<object>` and Amazon AWS S3 buckets of the form
`s3://<bucket>/<object>`. VolView can either download a single object, or
download everything underneath a given object prefix/folder. As an example,
VolView will download and load every file that exists in the
`gs://my-public-bucket/my-patient-folder/` folder.

As a note of caution, there are no checks on the size of the total download. As
such, be careful when specifying bucket-level prefixes!

This feature currently only supports public buckets that are anonymously
accessible. Authenticated support may be added at a future date. If you have a
strong use-case for it, please request it via [our issue
page](https://github.com/Kitware/VolView/issues)!

### CORS

In order for VolView to download and display your remote datasets, your server must be configured with the correct [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) configuration. CORS is a browser security mechanism that restricts how web applications can access remote resources. Without proper CORS configuration, VolView will be unable to download and display your datasets. Configuring your web server with CORS is beyond the scope of this documentation; please refer to your server's documentation.

### Configuration JSON File

By loading a JSON file, you can set VolView's:

- Starting view layout (Axial Only, 3D Primary, etc).
- Labels for tools
- Visibility of Sample Data section
- Keyboard shortcuts

#### Starting view layout

The `activeLayout` key has options (Axial Only, 3D Primary, etc.) defined in `config.ts`

#### Labels for tools

Each tool type (Rectangle, Polygon, etc.) can have tool specific labels. To share labels
across tools, define the `defaultLabels` key and don't provide labels for a tool that
should use the default labels.

#### Visibility of Sample Data section

Simplify the data browser by hiding the Sample Data expandable section.

#### Keyboard Shortcuts

Configure the keys to activate tools, change selected labels, and more.
All [shortcut actions](https://github.com/Kitware/VolView/blob/main/src/constants.ts#L53) are under the `ACTIONS` variable.

To configure a key for an action, add its action name and the key(s) under the `shortcuts` section. For key combinations, use `+` like `Ctrl+f`.

#### Example JSON:

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

#### All options:

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
  }
  "shortcuts": {
    "polygon": "Ctrl+p",
    "showKeyboardShortcuts": "t"
  }
}
```

## Layer Images

To overlay images in the 2D views, there is a layer button on image thumbnails. A PET image could be layered on top of a CT image. The layered image is resampled to the base image using the image's spatial metadata. If the spatial metadata does not place the images in the same coordinate system, the layer alignment will be incorrect.

To layer images:

1. Load the base image.
1. On the Data tab, click the Add Layer button on the upper layer dataset.
1. Under the Rendering tab, an opacity slider changes the transparency of the upper layer.

![Add Layer](../images/add-layer.jpg)
