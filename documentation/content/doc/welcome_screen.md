title: Welcome Screen
----

<style>
table {
  width: 100%;
}
</style>

![](img:../gallery/01-volview-welcome-notes.jpg)

* **Tabs** organize the high-level functions.
    * **Data** provides information on the Patient data and non-DICOM data that have been loaded. It also provides access to sample data.  The currently display image data is highlighted in blue.
    * **Annotations** lists the ruler and other measures that have been made on the currently loaded data.
    * **Rendering** provides the controls for the 3D cinematic volume rendering.

* **Sample Data** presents a variety of DICOM data that can be used to quickly explore the capabilities of VolView.  When you select a sample dataset, that data is downloaded from [http://data.kitware.com/](https://data.kitware.com/#collection/586fef9f8d777f05f44a5c86/folder/634713cf11dab81428208e1e).

* **Load / Save State** icons are used to restore or create a local file that captures the current configuration of the application and its data.  This includes the layout, annotations, cinematic rendering settings, and all other options specified.  The local file is in json format, so it provides a basis for integrating VolView with other applications and workflows.

* **Notifications and Settings** provide information and error messages and allow you to toggle between a dark or light theme. The number of recently posted notifications will appear on top of the notification icon.

* **Central Window** is used to receive DICOM data via drag-and-drop (receives files, folders, or zip files), or you can click within this window to bring up a file browser.
