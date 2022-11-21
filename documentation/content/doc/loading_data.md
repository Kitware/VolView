title: Loading Data
----

The most straightfoward way to load files into VolView is to drag-and-drop them onto the central window when viewing the "Data" tab.   You can also click within the central window to open a file browser and select the files or folders the "Open" button on the top-right toolbar. To complement different use-cases, there are a few other ways to open files.

## File formats

VolView can load multiple DICOM files, folders containing multiple DICOM files, or zipped files containing multiple DICOM files.   It also supports loading Nifti, NRRD, MHA, and 20+ other file formats thanks to the extensive I/O capabilities of ITK and itk.wasm, but care must be taken when loading non-DICOM data as the orientation of the data in those files cannot be assured.

## Sample Data

VolView includes links to a variety of sample data.  Clicking on those thumbnails in the Data tab will download that data from Kitware data.kitware.com website into your local machine.

## DICOM Web

DICOMWeb support is being added to VolView.  It will allow data from compliant DICOMWeb servers to be browsed, searched, and downloaded into VolView with only a few clicks.
