title: What is VolView?
----

VolView is an open source radiological viewer developed for clinical professionals. With VolView, you can gain a deeper understanding of your data through high-quality, interactive visualizations, including cinematic volume renderings. Since VolView runs in your browser, you do not need to install software, and your data stays securely on your machine.

![Welcome](../gallery/VolView-Overview.jpg)

## Features

Major features of VolView include:

1. **Cinematic Volume Rendering**: Create beautiful renderings and gain new insights into your data with only a few clicks.  VolView provides three cinematic volume rendering modes and intuitive controls for each.  We've also provides simple ways to control lighting and multiple presets to get you started.

2. **Drag-and-Drop DICOM**: Drag DICOM images onto VolView, and they will be quickly parsed and presented as thumbnails.  Click on a thumbnail, and the data is quickly loaded and presented as 2D slices and a 3D cinematic volume rendering.

3. **Annotations and Measures**: We have provided a small set of tools for painting, measuring, and cropping, and we are actively working to expand that toolset.  If you have suggestions for new tools or for improving VolView in general, please leave feedback at our [Issue Tracker](https://github.com/KitwareMedical/VolView/issues).

4. **Simple, Scalable, and Secure**: Simply visit a website to install VolView.  Once it is running, all data handling, processing, and visualization occurs on your machine.  Data you load into VolView never leaves your machine.  And VolView is designed to run on any web browser: from the one on your phone to the one running on your most powerful workstations.  It will take advantage of local GPU resources to accelerate its rendering processes, but if none is available, it will still generate the same high quality renderings, albeit a bit slower.

5. **Foundation for the Future**: VolView is meant to serve as a foundation for your future projects and products.  It is open-source and free for commercial and academic use.  You may modify it yourself, or Kitware can help you customize it to support client-server workflows, provide streamlined interfaces and tools, and carry your brand.

VolView is **not FDA approved for any purpose**, but Kitware can work with you to create a custom version of VolView and submit it for FDA approval.  For more information, contact [kitware@kitware.com](mailto:kitware@kitware.com).

## History

VolView version 1.1 was released on Sept. 21, 1999 to provide clinical professionals with an intuitive interface to industry-leading volume rendering capabilities. Built using [VTK](https://vtk.org), it was extremely innovative at the time. It provided interactive volume renderings that did not require dedicated systems purchased for big-name medical device manufacturers. It supported Windows 95/98/NT, Sun, Silicon Graphics and Linux environments, and it provided custom level-of-detail and composite rendering techniques. That version of VolView thrived for over a decade, with the last release in June of 2011. In 2011, open source radiological viewers had become commonplace (many also built using VTK), and we pivoted our attention to 3D Slicer as an advance, community-support, extensible platform for research and clinical application development.

We have released VolView 4.0 in 2022 to again advance the radiological image visualization field.  Built using the javascript version of VTK (i.e., [vtk.js](https://kitware.github.io/vtk-js/index.html)), VolView 4.0 runs in web browsers and provides cinematic volume rendering capabilities that are only broadly available in dedicated systems sold by big-name medical device manufacturers.  We look forward to continuing to use the VolView platform for medical image visualization innovation, with plans to support WebXR for holographic and AR/VR devices as well as companion libraries for advance image analysis (e.g., [itk.wasm](https://github.com/InsightSoftwareConsortium/itk-wasm)) and AI algorithms (e.g., via [MONAI](https://monai.io)).

## Roadmap

Details and progress on our roadmap are tracked in the VolView issue tracker on Github: https://github.com/Kitware/VolView/issues

Our next major release is planned for March, 2023, and it will support:
* DICOM Web 
* DICOM SEG, RT, and SR reading and writing 
* ITK for image processing
* Deep learning inference for image analysis

## Citation

If you find VolView to be useful for your work, please cite our paper on cinematic rendering:

[Xu J, Thevenon G, Chabat T, McCormick M, Li F, Birdsong T, Martin K, Lee Y, and Aylward S, "Interactive, in-browser cinematic volume rendering of medical images", Computer Methods in Computer Methods in Biomechanics and Biomedical Engineering: Imaging & Visualization](https://www.tandfonline.com/doi/full/10.1080/21681163.2022.2145239)

To refer to VolView's source code, please provide a link to https://github.com/Kitware/VolView and cite [DOI:10.5281/zendo.7328066](https://zenodo.org/badge/latestdoi/248073292)

## Acknowledgements

This work was funded, in part, by the NIH via NIBIB and NIGMS R01EB021396, NIBIB R01EB014955, NCI R01CA220681, and NINDS R42NS086295.

## Related Work

Learn about our related works at the following links:
* Glance: General purpose scientific visualization in web browsers
    * https://kitware.github.io/glance/index.html
* 3D Slicer: Desktop (C++ and Python), extensible radiological viewer
    * https://slicer.org
* trame: Python framework for quickly creating web application involving server-side rendering and computation.
    * https://kitware.github.io/trame/index.html
* itk.wasm: Web-assembly version of ITK for in-browser image segmentation and registration, with outstanding DICOM support.
    * https://github.com/InsightSoftwareConsortium/itk-wasm
* vtk.js: A pure javascript library for advanced, interactive, scientific visualization in web browsers.
    * https://kitware.github.io/vtk-js/index.html
