/**
 * Timesheet Extension - Global State
 */

var csInterface = new CSInterface();
var selectedCells = new Set();
var currentData = {};
var compInfo = null;
var isDragging = false;
var dragStartCell = null;
var selectionAnchor = null;
var suppressBlurApply = false;

// Two-pass import state (tri-state semantics are load-bearing: the first pass
// sets pass number to 1, the 500 ms second pass to 2, then clears to 0).
var isImportInProgress = false;
var importPassNumber = 0;
var importedEndMarkers = {};
var importedMaxFrame = 0;
var previewImportData = null;
var previewPassNumber = null; // null = no preview pass running, 1/2 = first/second
var clickedMultiSelectCell = null;

/**
 * Call a host function with argument names safely serialized.
 *
 * The panel talks to ExtendScript by string-building a call expression. Every
 * argument is serialized with JSON.stringify so layer names containing quotes
 * cannot break the expression (a latent bug in the previous raw concatenation).
 * Frame-index conventions are untouched: whatever number the caller passes is
 * serialized verbatim.
 *
 * @param {string} fn    host function name (e.g. "addTimeRemapKeyframe")
 * @param {Array}  args  array of call arguments (numbers, strings, objects)
 * @param {Function} [callback]  called with the host's string result
 */
function evalHost(fn, args, callback) {
    var parts = [];
    for (var i = 0; i < args.length; i++) {
        parts.push(JSON.stringify(args[i]));
    }
    csInterface.evalScript(fn + '(' + parts.join(',') + ')', callback);
}

/**
 * Build the standard status line describing the synced table:
 * "N layers • X fps • Y frames". Used by sync + keyframe-load paths.
 */
function cellStatusBarText() {
    return compInfo.layers.length + ' layers • ' +
        compInfo.fps + ' fps • ' + Math.round(compInfo.duration) + ' frames';
}

/**
 * Look up a data cell by its row/frame and column/layer index. The cells are
 * keyed with data-row / data-col attributes; this is the single place the
 * selector is built so the ~15 call sites that used to hand-roll it now share
 * one implementation.
 */
function getCell(row, col) {
    return document.querySelector('[data-row="' + row + '"][data-col="' + col + '"]');
}

/**
 * True when `el` is the text input of a data cell (i.e. the focused editor),
 * as opposed to focus sitting anywhere else in the panel. Used by keyboard
 * handlers to decide whether a key means "edit value" or "command".
 */
function isCellInput(el) {
    return !!(el && el.tagName === 'INPUT' &&
        el.parentElement && el.parentElement.classList.contains('data-cell'));
}

/**
 * Split a cell key ("row-col") into its numeric parts. Most callers were
 * hand-rolling key.split('-') + parseInt pairs; this is the single shared place.
 */
function parseCellKey(key) {
    var parts = key.split('-');
    return { row: parseInt(parts[0]), col: parseInt(parts[1]) };
}

/**
 * Write a keyframe value into currentData and push it to After Effects via the
 * host. The input element is left untouched — callers that need the DOM updated
 * set input.value before/after calling this.
 */
function setCellValue(col, row, layerIndex, layerName, value) {
    currentData[col][row] = value;
    addKeyframe(layerIndex, layerName, row - 1, value);
}

/**
 * Remove a keyframe value from currentData and After Effects (input untouched).
 */
function clearCellValue(col, row, layerIndex, layerName) {
    delete currentData[col][row];
    deleteKeyframe(layerIndex, layerName, row - 1);
}

/**
 * Show a file-open dialog (hidden input) and hand the picked file's name and
 * decoded text to onContent. The three import paths (preview, import, camera)
 * previously each copy-pasted this input+FileReader preamble.
 */
function readLocalFile(accept, onContent) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = function (e) {
        var file = e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (event) {
            onContent(file.name, event.target.result);
        };
        reader.readAsText(file);
    };
    input.click();
}

/** A/B/C... column header label for the given 0-based column index. */
function columnLabel(index) {
    return String.fromCharCode(65 + index); // A, B, C...
}

/** Reset currentData to empty per-layer dictionaries (fresh-table state). */
function resetCurrentData() {
    currentData = {};
    if (compInfo && compInfo.layers) {
        compInfo.layers.forEach(function (layer, i) {
            currentData[i] = {};
        });
    }
}