# VolView

![A screenshot of a sample VolView session](./docs/assets/VolView-Overview.jpg)

## Try it

Try VolView online: https://volview.kitware.app/

## Introduction

VolView is an open source radiological viewer developed for clinical professionals. With VolView, you can have a deeper visual understanding of your data through interactive, cinematic volume rendering and easily visualize your DICOM data in 3D. Since VolView runs in your browser, you don’t need to install software and your data stays securely on your machine.

Major features of VolView include:

1. Drag-and-drop DICOM: Drag DICOM images onto VolView, and they will be quickly parsed and presented as thumbnails.  Click on a thumbnail, and the data is quickly loaded and presented as 2D slices and a 3D cinematic volume rendering.

2. Cinematic Volume Rendering: Create beautiful renderings and gain new insights into your data with only a few clicks.  VolView provides three cinematic volume rendering modes and intuitive controls for each.  We've also provides simple ways to control lighting and multiple presets to get you started.

3. Annotations and measures: We have provided a small set of tools for painting, measuring, and cropping, and that toolset will be rapidly expanding.  If you have suggestions for new tools or for improving VolView in general, please leave feedback at our [Issue Tracker](https://github.com/Kitware/VolView/issues).

4. Simple, Scalable, and Secure: Simply visit a website to install VolView.  Once it is running, all data handling, processing, and visualization occurs on your machine.  Data you load into VolView never leaves your machine.  And VolView is designed to run on any web browser: from the one on your phone to the one running on your most powerful workstations.  It will take advantage of local GPU resources to accelerate its rendering processes, but if none is available, it will still generate the same high quality renderings, albeit a bit slower.

5. A foundation for the future: VolView is meant to serve as a foundation for your future projects and products.  It is open-source and free for commercial and academic use.  You may modify it yourself, or Kitware can help you customize it to support client-server workflows, provide streamlined interfaces and tools, and carry your brand.

## Documentation

Visit: https://kitware.github.io/VolView to read the documentation.

# Citation

If you find VolView to be useful for your work, please cite our paper on cinematic rendering:

[Jiayi Xu, Gaspard Thevenon, Timothee Chabat, Matthew McCormick, Forrest Li,Tom Birdsong,Ken Martin, Yueh Lee, and Stephen Aylward, "Interactive, in-browser cinematic volume rendering of medical images", MICCAI 2022 AE-CAI Workshop, Singapore, Sept 19, 2022, Journal version accepted for publication in Computer Methods in Computer Methods in Biomechanics and Biomedical Engineering](https://workshops.ap-lab.ca/aecai2022/wp-content/uploads/sites/10/2022/09/Paper48_IICVR_camera_ready_paper.pdf): 

To include a reference to the source code of VolView 4.0, please use this DOI:
[![DOI](https://zenodo.org/badge/248073292.svg)](https://zenodo.org/badge/latestdoi/248073292)

# Customizing VolView

See the [Contributing.md](CONTRIBUTING.md) document.

# Acknowledgements

This work was funded, in part, by the NIH via NIBIB and NIGMS R01EB021396, NIBIB R01EB014955, NCI R01CA220681, and NINDS R42NS086295.
