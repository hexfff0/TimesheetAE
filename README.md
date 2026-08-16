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
| **Import**     | Import keyframe data from `.csv` or `.xdts`.                                                                     |
| **Preview**    | Preview imported `.csv` or `.xdts` data in a modal table. Click column headers to add keyframes to selected AE layers. |
| **Re-index**   | Ordered by origin value (smallest first keeps its number), fills `.`/non-numeric cells with sequential values, empties stay empty. Off by default; toggle in the Preview modal applies immediately. |

---

### Camera

Tools for importing and synchronizing camera keyframe.

| Feature           | Description                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------- |
| **Import Camera** | Import camera keyframe data from `.xdts`.                                                   |
| **Camera Comp**   | Opens a dialog with two modes: **Comp** (new comp from selection with camera link) and **Link** (add camera expressions to selected layers). |

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

### Preview Keyframe Data

1. Click **Preview** to open a file picker
2. Select a `.csv` or `.xdts` file
3. The data is displayed in a modal table with frame numbers on the left and layer columns on the right
4. Select one or more layers in After Effects
5. Click a column header in the preview table to add Time Remap keyframes to the selected layers

---

## Supported Formats

| Type          | Formats         |
| ------------- | --------------- |
| Keyframe Data | `.csv`, `.xdts` |
| Camera Data   | `.xdts`         |

---

## License

This project is licensed under the **MIT License**.
