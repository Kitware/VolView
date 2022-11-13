title: Supported file formats
----

ParaView Glance comes loaded with ITK.js image data readers as well as VTK.js image and geometry readers. When used online, depending on the file that gets loaded, if it is a format provided by ITK, the appropriate reader module will be downloaded and cached locally for any subsequent usage. But because of that dynamic mechanism, the readers provided by ITK are not yet available with the standalone single file HTML version that you can run from your desktop.

The following set of tables list the supported format and which library is defining the reader.

<style>
table {
  width: 100%;
}
</style>

## Glance

| Extension | Description          | Format specificity                                                  |
| --------- | -------------------- | ------------------------------------------------------------------- |
| *.glance  | Glance Scene         | Binary encoding of a scene for Glance.                              |
| *.obz     | Zip of OBJ/MTL/Images| Gathering of OBJ/MTL files along with their image texture files.    |
| *.zip     | Zip of various files | Bundle of files to load inside that are contains in a zip file.     |

## VTK.js

| Extension | Description          | Format specificity                                                  |
| --------- | -------------------- | ------------------------------------------------------------------- |
| *.vtp     | VTK Polydata         | ASCII or binary or appended with or without compression (ZLib only) |
| *.vti     | VTK ImageData        | ASCII or binary or appended with or without compression (ZLib only) |
| *.stl     | Stereol lithography  | ASCII or binary                                                     |
| *.obj     | Wavefront            | Geometry without the material file.                                 |
| *.pdb     | Protein Data Bank    | Molecule representation                                             |
| *.glyph   | **Custom/Internal**  | Custom format to define vtk.js source setting and Glyph positioning |
| *.skybox  | **Custom/Internal**  | Zip bundle of a set of textures for an infinit cube box             |

## ITK.js

The only structure that currently can be loaded by ITK.js are vtkImageData.
This means that the `Legacy VTK (*.vtk)` format won't work for vtkPolyData, vtkUnstructuredGrid...

| Extension                     | Module         |
| ----------------------------- | -------------- |
| *.bmp                         | itkBMPImage    |
| *.dcm                         | itkDCMTKImage  |
| *.gipl, gipl.gz               | itkGiplImage   |
| *.hdf5                        | itkHDF5Image   |
| *.jpg, *.jpeg                 | itkJPEGImage   |
| *.json                        | itkJSONImage   |
| *.lsm                         | itkLSMImage    |
| *.mnc, *.mnc.gz,*.mnc2        | itkMINCImage   |
| *.mgh, *.mgz, *.mgh.gz        | itkMGHImage    |
| *.mha, *.mhd                  | itkMetaImage   |
| *.mrc                         | itkMRCImage    |
| *.nia, *.nii, *.hdr, *.nii.gz | itkNiftiImage  |
| *.nrrd, *.nhdr                | itkNrrdImage   |
| *.png                         | itkPNGImage    |
| *.pic                         | itkBioRadImage |
| *.tif, *.tiff                 | itkTIFFImage   |
| *.vtk                         | itkVTKImage    |
