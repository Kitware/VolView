title: What is Glance?
----

Glance is a light-weight, open-source, web application developed at Kitware for visualizing volumetric images, molecular structures, geometric objects, and point clouds.

![Welcome](../gallery/01-glance-welcome.jpg)

As part of the ParaView platform, it is intended to allow users to quickly __glance__ at their small to medium size data.  Ultimately, Glance is intended to help you:

1. quickly view your data on your computer.  It launches quickly and supports a wide variety of data formats so that you can quickly look at the most recent results from a new algorithm you are developing or visually confirm the contents of a data file on your drive.

2. review items-of-interest on [Girder]. Imagine that you have reviewed a large collection of data on Girder, and you have narrowed your search to two interesting items that you want to explore more closely.  Via an optional Girder module, Glance can be associated with appropriate types of data items and launched to download and view items of interest with minimal interaction (a single click per item), minimal delay (requiring only the time to transfer the data to your machine), and no need to explicitly install an application or run a dedicated server (Glance is a stand-alone, JavaScript+WebAssembly application).

3. develop new applications involving VTK.js and ITK.js. Glance has been architected to be a highly customizable platform.  It can be used as a basis for creating stand-alone web-based applications, desktop applications via Electron, and web-based systems that involve services from [ParaViewWeb] and/or [Resonant].


[Girder]: http://resonant.kitware.com
[ParaViewWeb]: https://www.paraview.org/web
[Resonant]: http://resonant.kitware.com/
