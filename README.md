# Timesheet Extension - The Digital Timesheet

**Timesheet** is a specialized Adobe After Effects (CEP) extension that brings the traditional **Digital Timesheet** workflow directly into your animation pipeline. Designed specifically for animators and compositors, it transforms how you manage time remapping, allowing for precise, sheet-based timing control similar to traditional animation exposure sheets (x-sheets).

## Key Features

-   **Spreadsheet Interface**: Visualize your entire shot's timing at a glance.
    -   **Import**: Directly import timeline data exported from **Clip Studio Paint** (or other digital timesheet software).
    -   **Re-index Toggle**: Automatically normalize imported cell values (e.g., cell `1` in CSP becomes frame `1` in AE) to match your After Effects layer usage.
-   **Real-time Sync**:
    -   `Sync Button`: Instantly pull existing layer timing from your composition.
        -   **Note**: You must select all desired layers in the composition *before* syncing.
        -   **Order**: Layers are processed from **bottom to top** (following standard animation stacking/exposure sheet conventions).
    -   `Live Updates`: Changes in the panel reflect immediately on your After Effects layers.
-   **Flexible Controls**:
    -   **Re-index**: Toggle between keeping original values or re-sequencing them (1, 2, 3...) for clean organization.
    -   **Visual Markers**: Custom interval lines (e.g., every 6 frames) to match your workflow's beat.
    -   **Keyframe Models**: Supports both `Hold` (Step) and `Linear` interpolation.

## Installation

1.  **Download**: Clone this repository or download the source code.
2.  **Move to Extensions Folder**:
    -   **Windows**: `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\`
    -   **macOS**: `/Library/Application Support/Adobe/CEP/extensions/`
3.  **Enable Debug Mode** (Required for unsigned extensions):
    -   **Windows**: Open Registry Editor (`regedit`), go to `HKEY_CURRENT_USER\Software\Adobe\CSXS.11` (or your version), add string `PlayerDebugMode` = `1`.
    -   **macOS**: Open Terminal: `defaults write com.adobe.CSXS.11 PlayerDebugMode 1` (check your CSXS version).
4.  **Restart After Effects**: Find it under `Window > Extensions > Timesheet`.

## Usage Workflow

1.  **Prep in AE**: Import your image sequences or layers.
2.  **Sync**: Select your layers in the composition (order: Bottom -> Top) and click **Sync** to load them.
3.  **Import Timing**:
    -   Export your timeline as CSV from **Clip Studio Paint**.
    -   In Timesheet, click **Import**.
    -   *Tip:* Use the **Re-index** toggle to ensure your imported numbers match your AE layer sequence (1, 2, 3...).
4.  **Fine Tune**: Tweak timing directly in the grid using your keyboard (Arrows, Tab, Enter).

## Requirements

-   Adobe After Effects (CC 2018+).
-   Workflows compatible with Time Remapping.

## License

This project is open source.
