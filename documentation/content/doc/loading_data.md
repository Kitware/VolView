title: Loading Data
----

The most straightfoward way to load files into VolView is to drag-and-drop them onto the central window when viewing the "Data" tab.   You can also click within the central window to open a file browser and select the files or folders the "Open" button on the top-right toolbar. To complement different use-cases, there are a few other ways to open files.

## File formats

VolView can load multiple DICOM files, folders containing multiple DICOM files, or zipped files containing multiple DICOM files.   It also supports loading Nifti, NRRD, MHA, and 20+ other file formats thanks to the extensive I/O capabilities of ITK and itk.wasm, but care must be taken when loading non-DICOM data as the orientation of the data in those files cannot be assured.

## Sample Data

VolView includes links to a variety of sample data.  Clicking on those thumbnails in the Data tab will download that data from Kitware data.kitware.com website into your local machine.

## DICOM Web

DICOMWeb support is being added to VolView.  It will allow data from compliant DICOMWeb servers to be browsed, searched, and downloaded into VolView with only a few clicks.

## Loading Remote Data via URLs

VolView supports loading remote datasets at application start through URL parameters. An example of this integration in action can be viewed here: [VolView with sample data](https://volview.netlify.com/?names=[prostate-mri.zip,neck.mha]&urls=[https://data.kitware.com/api/v1/item/63527c7311dab8142820a338/download,https://data.kitware.com/api/v1/item/620db4b84acac99f42e75420/download])

The URL is constructed with two parts, as shown below. The required parameter is the `urls` parameter, which specifies a list of URLs to download. An optional `names` parameter specifies the filename to go along with the file. If VolView cannot infer the file type, the filename's extension is used as a fallback. Loading multiple URLs is achieved by separating them with a comma.

<pre>
https://volview.netlify.com/?<strong>names=[prostate-mri.zip,neck.mha]</strong>&<strong>urls=[https://data.kitware.com/api/v1/item/63527c7311dab8142820a338/download,https://data.kitware.com/api/v1/item/620db4b84acac99f42e75420/download]</strong>
</pre>

### Google Cloud Storage Bucket and AWS S3 Support

VolView supports both Google Cloud Storage links of the form
`gs://<bucket>/<object>` and Amazon AWS S3 buckets of the form
`s3://<bucket>/<object>`.  VolView can either download a single object, or
download everything underneath a given object prefix/folder. As an example,
VolView will download and load every file that exists in the
`gs://my-public-bucket/my-patient-folder/` folder.

As a note of caution, there are no checks on the size of the total download. As
such, be careful when specifying bucket-level prefixes!

This feature currently only supports public buckets that are anonymously
accessible. Authenticated support may be added at a future date.  If you have a
strong use-case for it, please request it via [our issue
page](https://github.com/Kitware/VolView/issues)!

### CORS

In order for VolView to download and display your remote datasets, your server must be configured with the correct [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) configuration. CORS is a browser security mechanism that restricts how web applications can access remote resources. Without proper CORS configuration, VolView will be unable to download and display your datasets. Configuring your web server with CORS is beyond the scope of this documentation; please refer to your server's documentation.