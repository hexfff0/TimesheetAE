/**
 * Timesheet Extension - Keyframe Functions
 */

function syncLayers() {
    updateStatus('Syncing...');

    evalHost('getSelectedLayersInfo', [], function (result) {
        if (!result || result === 'null' || result === 'undefined') {
            updateStatus('Error: No selection');
            return;
        }

        try {
            var data = JSON.parse(result);

            if (data.error) {
                updateStatus('Error: ' + data.error);
                return;
            }

            compInfo = data;
            resetCurrentData();

            // Load existing keyframes
            loadExistingKeyframes();

        } catch (e) {
            updateStatus('Error: ' + e.message);
        }
    });
}

function loadExistingKeyframes() {
    var layersProcessed = 0;

    // Table + status build exactly once, after every layer has resolved (the
    // "no time remap" layers resolve synchronously, so a single counter covers
    // both branches — previously the all-empty case double-built the table).
    function finishLoad() {
        buildTable();
        updateStatus(cellStatusBarText());
    }

    compInfo.layers.forEach(function (layer, i) {
        if (layer.hasTimeRemap) {
            evalHost('readTimeRemapKeyframes', [layer.index, layer.name], function (result) {
                try {
                    var data = JSON.parse(result);

                    if (!data.error && data.keyframes) {
                        data.keyframes.forEach(function (kf) {
                            // frame from JSX is 0-based, convert to 1-based for UI
                            // value from JSX is already 1-based
                            currentData[i][kf.frame + 1] = kf.value;
                        });
                    }
                } catch (e) {
                    updateStatus('Error: Loading keyframes for ' + layer.name);
                    console.error('Error loading keyframes for ' + layer.name, e);
                }

                layersProcessed++;
                if (layersProcessed === compInfo.layers.length) {
                    finishLoad();
                }
            });
        } else {
            layersProcessed++;
            if (layersProcessed === compInfo.layers.length) {
                finishLoad();
            }
        }
    });
}

function handleCellInput(input) {
    var value = input.value.trim();

    // If multiple cells are selected and the edited cell is one of them
    var currentKey = input.dataset.row + '-' + input.dataset.col;

    if (selectedCells.size > 1 && selectedCells.has(currentKey)) {
        // Loop through and update all selected cells
        selectedCells.forEach(function (key) {
            var keyParts = parseCellKey(key);
            var cell = getCell(keyParts.row, keyParts.col);

            if (cell) {
                var targetInput = cell.querySelector('input');
                var colIdx = cell.dataset.col;
                var layerName = cell.dataset.layerName;
                var layerIndex = compInfo.layers[colIdx].index;

                targetInput.value = value; // Set the same value for all

                // Update data and AE
                if (value === '') {
                    clearCellValue(colIdx, keyParts.row, layerIndex, layerName);
                } else {
                    setCellValue(colIdx, keyParts.row, layerIndex, layerName, value);
                }
            }
        });
        updateStatus(selectedCells.size + ' cells updated');
    } else {
        // Case: Edit single cell
        var row = parseInt(input.dataset.row);
        var col = parseInt(input.dataset.col);
        var layerName = input.parentElement.dataset.layerName;
        var layerIndex = compInfo.layers[col].index;
        if (value === '') {
            clearCellValue(col, row, layerIndex, layerName);
        } else {
            setCellValue(col, row, layerIndex, layerName, value);
        }
    }
}

/**
 * Surface a host result that is not "true" as an error on the status bar. Host
 * errors already carry the "Error: " prefix; add it only when missing.
 */
function reportHostError(result) {
    if (result && result !== 'true') {
        updateStatus(/^Error:/.test(result) ? result : 'Error: ' + result);
    }
}

function addKeyframe(layerIndex, layerName, frame, value) {
    var keyframeType = document.getElementById('keyframeType').value;
    evalHost('addTimeRemapKeyframe', [layerIndex, layerName, frame, value, keyframeType, compInfo.fps], reportHostError);
}

function deleteKeyframe(layerIndex, layerName, frame) {
    evalHost('deleteTimeRemapKeyframe', [layerIndex, layerName, frame], reportHostError);
}

/**
 * Open the in-panel Remove All confirmation modal (styled like the camera-link
 * modal). Confirmation runs the actual reset; cancel/close does nothing.
 */
function removeAllKeyframes() {
    var modal = document.getElementById('removeAllModal');
    if (!modal) return;
    modal.classList.add('open');
    moveFocusIn(modal);
}

/**
 * Perform the actual reset after the user confirms. Kept separate from the
 * modal plumbing so keyboard/click confirmation share one code path. The host
 * does the real removal (disables Time Remap on every selected layer); on
 * success re-sync so the table reflects the cleared layers.
 */
function confirmRemoveAll() {
    closeRemoveAllModal();
    updateStatus('Removing Time Remap...');
    evalHost('removeAllTimeRemap', [], function (result) {
        if (result === 'true') {
            updateStatus('Time Remap reset successfully.');
            syncLayers();
        } else {
            updateStatus(result && /^Error:/.test(result) ? result : 'Error: ' + result);
        }
    });
}

function closeRemoveAllModal() {
    var modal = document.getElementById('removeAllModal');
    if (modal) modal.classList.remove('open');
    returnFocus(getLastFocused());
}

// Move selected keyframes up or down by offset frames
function moveSelectedKeyframes(offset) {
    if (selectedCells.size === 0) {
        updateStatus('No cells selected to move');
        return;
    }

    // Collect all selected cells data
    var cellsToMove = [];
    selectedCells.forEach(function (key) {
        var keyParts = parseCellKey(key);
        var row = keyParts.row;
        var col = keyParts.col;
        var cell = getCell(row, col);

        if (cell) {
            var input = cell.querySelector('input');
            var value = input.value.trim();
            if (value !== '') {
                cellsToMove.push({
                    oldRow: row,
                    newRow: row + offset,
                    col: col,
                    value: value,
                    layerName: cell.dataset.layerName,
                    layerIndex: compInfo.layers[col].index
                });
            }
        }
    });

    if (cellsToMove.length === 0) {
        updateStatus('No keyframes to move');
        return;
    }

    // Check if all new positions are valid
    var allValid = cellsToMove.every(function (item) {
        return item.newRow >= 1 && item.newRow <= Math.ceil(compInfo.duration);
    });

    if (!allValid) {
        updateStatus('Cannot move: out of bounds');
        return;
    }

    // Sort by row to avoid conflicts
    // Moving up: process from top to bottom (ascending)
    // Moving down: process from bottom to top (descending)
    if (offset < 0) {
        cellsToMove.sort(function (a, b) { return a.oldRow - b.oldRow; });
    } else {
        cellsToMove.sort(function (a, b) { return b.oldRow - a.oldRow; });
    }

    // Clear old positions - suppress blur to prevent value overwriting
    suppressBlurApply = true;
    cellsToMove.forEach(function (item) {
        var oldCell = getCell(item.oldRow, item.col);
        if (oldCell) {
            oldCell.querySelector('input').value = '';
            clearCellValue(item.col, item.oldRow, item.layerIndex, item.layerName);
        }
    });
    suppressBlurApply = false; // Reset after clearing old positions

    // Set new positions
    clearSelection();
    cellsToMove.forEach(function (item) {
        var newCell = getCell(item.newRow, item.col);
        if (newCell) {
            newCell.querySelector('input').value = item.value;
            setCellValue(item.col, item.newRow, item.layerIndex, item.layerName, item.value);
            selectCell(newCell);
        }
    });

    updateStatus(cellsToMove.length + ' moved ' + (offset > 0 ? '↓' : '↑'));
}

// Move a single cell (for Alt+Arrow when single cell is focused)
function moveSingleCell(input, offset) {
    var row = parseInt(input.dataset.row);
    var col = parseInt(input.dataset.col);
    var value = input.value.trim();

    if (value === '') {
        updateStatus('No keyframe to move');
        return;
    }

    var newRow = row + offset;
    if (newRow < 1 || newRow > Math.ceil(compInfo.duration)) {
        updateStatus('Cannot move: out of bounds');
        return;
    }

    var cell = input.parentElement;
    var layerName = cell.dataset.layerName;
    var layerIndex = compInfo.layers[col].index;

    // Clear old position
    input.value = '';
    clearCellValue(col, row, layerIndex, layerName);

    // Set new position
    var newCell = getCell(newRow, col);
    if (newCell) {
        var newInput = newCell.querySelector('input');
        newInput.value = value;
        setCellValue(col, newRow, layerIndex, layerName, value);

        // Focus and select new cell
        clearSelection();
        selectCell(newCell);
        setAnchor(newCell);
        newInput.focus();
        newInput.select();
    }

    updateStatus('Moved ' + (offset > 0 ? '↓' : '↑'));
}

// Decrease keyframe value by 1 (delete if value becomes 0)
function decreaseKeyframeValue(input, row, col) {
    var currentValue = parseInt(input.value) || 0;
    var cell = input.parentElement;
    var layerName = cell.dataset.layerName;
    var layerIndex = compInfo.layers[col].index;

    if (currentValue <= 1) {
        // Delete keyframe
        input.value = '';
        clearCellValue(col, row, layerIndex, layerName);
        updateStatus('Deleted');
    } else {
        // Decrease value
        var newValue = currentValue - 1;
        input.value = newValue;
        setCellValue(col, row, layerIndex, layerName, newValue);
        updateStatus('→ ' + newValue);
    }
}

// Increase keyframe value by 1 (create if empty)
function increaseKeyframeValue(input, row, col) {
    var currentValue = parseInt(input.value) || 0;
    var cell = input.parentElement;
    var layerName = cell.dataset.layerName;
    var layerIndex = compInfo.layers[col].index;
    var newValue = currentValue + 1;

    input.value = newValue;
    setCellValue(col, row, layerIndex, layerName, newValue);
    updateStatus('→ ' + newValue);
}

function fillSelectedCells(value) {
    var cells = Array.from(selectedCells);
    cells.forEach(function (key) {
        var keyParts = parseCellKey(key);
        var cell = getCell(keyParts.row, keyParts.col);
        if (cell) {
            var input = cell.querySelector('input');
            input.value = value;
            handleCellInput(input);
        }
    });
    updateStatus(cells.length + ' filled');
}

function deleteSelectedCells() {
    var cells = Array.from(selectedCells);
    cells.forEach(function (key) {
        var keyParts = parseCellKey(key);
        var cell = getCell(keyParts.row, keyParts.col);
        if (cell) {
            var input = cell.querySelector('input');
            input.value = '';
            handleCellInput(input);
        }
    });
    clearSelection()
    updateStatus(cells.length + ' cleared');
}
