# Timesheet – After Effects Extension

Import animation timing and camera data from Clip Studio Paint directly into After Effects.

Timesheet is an Adobe After Effects extension designed to streamline animation workflows by automatically converting and importing keyframe and camera data from Clip Studio Paint into After Effects.

---

## Preview

<p align="center">
  <img src="/img/preview.png" alt="Timesheet Extension Preview" width="300">
</p>

---

## Features

### Cell

Tools for managing frame timing and layer synchronization.

| Feature        | Description                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Sync**       | Connect selected After Effects layers with the extension and synchronize editing.                                |
| **Clear**      | Clear the current selection inside the extension.                                                                |
| **Remove All** | Remove all generated Time Remap data from connected layers.                                                      |
| **Export**     | Export Time Remap data to `.csv` or `.json`.                                                                     |
| **Import**     | Import keyframe data from `.csv` or `.xdts`.                                                                     |
| **Re-index**   | Automatically convert non-numeric values in `.csv` or `.xdts` into sequential numeric indexes starting from `1`. |

---

### Camera

Tools for importing and synchronizing camera keyframe.

| Feature           | Description                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------- |
| **Import Camera** | Import camera keyframe data from `.xdts`.                                                   |
| **Camera Comp**   | Create a new composition from the selected layers and synchronize camera data automatically. |

---

## Installation

### Method 1 — Install via ZXP Installer (Recommended)

1. Download `Timesheet.zxp`
2. Open **ZXP Installer**
3. Install the extension

---

### Method 2 — Manual Installation

1. Download `Timesheet.zip`
2. Extract the archive

```text
Extract to "Timesheet/"
```

3. Copy the extracted folder to:

```text
C:\Program Files (x86)\Common Files\Adobe\CEP\extensions
```

---

## How to Use

### Edit Cell Animation

1. Select one or more layers in After Effects
2. Open **Timesheet Extension**
3. Click **Sync**
4. Edit timing directly in the Timesheet table
5. The extension will automatically generate and update **Time Remap** data

---

## Supported Formats

| Type          | Formats         |
| ------------- | --------------- |
| Keyframe Data | `.csv`, `.xdts` |
| Export        | `.csv`, `.json` |
| Camera Data   | `.xdts`         |

---

## License

This project is licensed under the **MIT License**.

---