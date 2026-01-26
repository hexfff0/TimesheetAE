/**
 * Timesheet Extension - Keyframe Functions
 */

function syncLayers() {
    updateStatus('Syncing...');

    csInterface.evalScript('getSelectedLayersInfo()', function (result) {
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
            currentData = {};

            // Initialize data structure
            compInfo.layers.forEach(function (layer) {
                currentData[layer.name] = {};
            });

            // Load existing keyframes
            loadExistingKeyframes();

        } catch (e) {
            updateStatus('Error: ' + e.message);
        }
    });
}

function loadExistingKeyframes() {
    var layersProcessed = 0;

    compInfo.layers.forEach(function (layer) {
        if (layer.hasTimeRemap) {
            csInterface.evalScript('readTimeRemapKeyframes("' + layer.name + '")', function (result) {
                try {
                    var data = JSON.parse(result);

                    if (!data.error && data.keyframes) {
                        data.keyframes.forEach(function (kf) {
                            // frame from JSX is 0-based, convert to 1-based for UI
                            // value from JSX is already 1-based
                            currentData[layer.name][kf.frame + 1] = kf.value;
                        });
                    }
                } catch (e) {
                    console.error('Error loading keyframes for ' + layer.name, e);
                }

                layersProcessed++;
                if (layersProcessed === compInfo.layers.length) {
                    buildTable();
                    updateStatus(compInfo.layers.length + ' layers • ' +
                        compInfo.fps + ' fps • ' + Math.round(compInfo.duration) + ' frames');
                }
            });
        } else {
            layersProcessed++;
            if (layersProcessed === compInfo.layers.length) {
                buildTable();
                updateStatus(compInfo.layers.length + ' layers • ' +
                    compInfo.fps + ' fps • ' + Math.round(compInfo.duration) + ' frames');
            }
        }
    });

    // Fallback if no time remap layers
    if (compInfo.layers.every(function (l) { return !l.hasTimeRemap; })) {
        buildTable();
        updateStatus(compInfo.layers.length + ' layers • ' +
            compInfo.fps + ' fps • ' + Math.round(compInfo.duration) + ' frames');
    }
}

function handleCellInput(input) {
    var value = input.value.trim();

    // If multiple cells are selected and the edited cell is one of them
    var currentKey = input.dataset.row + '-' + input.dataset.col;

    if (selectedCells.size > 1 && selectedCells.has(currentKey)) {
        // Loop through and update all selected cells
        selectedCells.forEach(function (key) {
            var parts = key.split('-');
            var row = parts[0];
            var col = parts[1];
            var cell = document.querySelector('[data-row="' + row + '"][data-col="' + col + '"]');

            if (cell) {
                var targetInput = cell.querySelector('input');
                var layerName = cell.dataset.layerName;

                targetInput.value = value; // Set the same value for all

                // Update data and AE
                if (value === '') {
                    delete currentData[layerName][row];
                    deleteKeyframe(layerName, row - 1);
                } else {
                    currentData[layerName][row] = value;
                    addKeyframe(layerName, row - 1, value);
                }
            }
        });
        updateStatus(selectedCells.size + ' cells updated');
    } else {
        // Case: Edit single cell
        var row = parseInt(input.dataset.row);
        var layerName = input.parentElement.dataset.layerName;
        if (value === '') {
            delete currentData[layerName][row];
            deleteKeyframe(layerName, row - 1);
        } else {
            currentData[layerName][row] = value;
            addKeyframe(layerName, row - 1, value);
        }
    }
}

function addKeyframe(layerName, frame, value) {
    var keyframeType = document.getElementById('keyframeType').value;

    var scriptCall = 'addTimeRemapKeyframe("' + layerName + '", ' + frame + ', ' +
        value + ', "' + keyframeType + '", ' + compInfo.fps + ')';

    csInterface.evalScript(scriptCall, function (result) {
        if (result && result !== 'true') {
            console.error('Error adding keyframe: ' + result);
            updateStatus('Error: ' + result);
        }
    });
}

function deleteKeyframe(layerName, frame) {
    var scriptCall = 'deleteTimeRemapKeyframe("' + layerName + '", ' + frame + ')';

    csInterface.evalScript(scriptCall, function (result) {
        if (result && result !== 'true') {
            console.error('Error deleting keyframe: ' + result);
        }
    });
}

/**
 * Triggers the removal of all Time Remap keyframes using a professional Native Dialog.
 */
function removeAllKeyframes() {
    // Call the native dialog function in AE
    csInterface.evalScript('ConfirmDialog()', function (result) {
        if (result === "true") {
            // Reset UI and local data on success
            currentData = {};
            if (compInfo && compInfo.layers) {
                compInfo.layers.forEach(l => currentData[l.name] = {});
            }
            rebuildTable();
            updateStatus('Time Remap reset successfully.');
        }
        // If "false" or "cancelled", do nothing (Status remains same or updated)
    });
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
        var parts = key.split('-');
        var row = parseInt(parts[0]);
        var col = parseInt(parts[1]);
        var cell = document.querySelector('[data-row="' + row + '"][data-col="' + col + '"]');

        if (cell) {
            var input = cell.querySelector('input');
            var value = input.value.trim();
            if (value !== '') {
                cellsToMove.push({
                    oldRow: row,
                    newRow: row + offset,
                    col: col,
                    value: value,
                    layerName: cell.dataset.layerName
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

    // Store temp data to avoid overwriting
    var tempData = [];
    cellsToMove.forEach(function (item) {
        tempData.push({
            layerName: item.layerName,
            oldRow: item.oldRow,
            newRow: item.newRow,
            value: item.value,
            col: item.col
        });
    });

    // Clear old positions - suppress blur to prevent value overwriting
    suppressBlurApply = true;
    cellsToMove.forEach(function (item) {
        var oldCell = document.querySelector('[data-row="' + item.oldRow + '"][data-col="' + item.col + '"]');
        if (oldCell) {
            var input = oldCell.querySelector('input');
            input.value = '';
            delete currentData[item.layerName][item.oldRow];
            deleteKeyframe(item.layerName, item.oldRow - 1);
        }
    });
    suppressBlurApply = false; // Reset after clearing old positions

    // Set new positions
    clearSelection();
    cellsToMove.forEach(function (item) {
        var newCell = document.querySelector('[data-row="' + item.newRow + '"][data-col="' + item.col + '"]');
        if (newCell) {
            var input = newCell.querySelector('input');
            input.value = item.value;
            currentData[item.layerName][item.newRow] = item.value;
            addKeyframe(item.layerName, item.newRow - 1, item.value);
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

    // Clear old position
    input.value = '';
    delete currentData[layerName][row];
    deleteKeyframe(layerName, row - 1);

    // Set new position
    var newCell = document.querySelector('[data-row="' + newRow + '"][data-col="' + col + '"]');
    if (newCell) {
        var newInput = newCell.querySelector('input');
        newInput.value = value;
        currentData[layerName][newRow] = value;
        addKeyframe(layerName, newRow - 1, value);

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

    if (currentValue <= 1) {
        // Delete keyframe
        input.value = '';
        delete currentData[layerName][row];
        deleteKeyframe(layerName, row - 1);
        updateStatus('Deleted');
    } else {
        // Decrease value
        var newValue = currentValue - 1;
        input.value = newValue;
        currentData[layerName][row] = newValue;
        addKeyframe(layerName, row - 1, newValue);
        updateStatus('→ ' + newValue);
    }
}

// Increase keyframe value by 1 (create if empty)
function increaseKeyframeValue(input, row, col) {
    var currentValue = parseInt(input.value) || 0;
    var cell = input.parentElement;
    var layerName = cell.dataset.layerName;
    var newValue = currentValue + 1;

    input.value = newValue;
    currentData[layerName][row] = newValue;
    addKeyframe(layerName, row - 1, newValue);
    updateStatus('→ ' + newValue);
}

function fillSelectedCells(value) {
    var cells = Array.from(selectedCells);
    cells.forEach(function (key) {
        var parts = key.split('-');
        var row = parts[0];
        var col = parts[1];
        var cell = document.querySelector('[data-row="' + row + '"][data-col="' + col + '"]');
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
        var parts = key.split('-');
        var row = parts[0];
        var col = parts[1];
        var cell = document.querySelector('[data-row="' + row + '"][data-col="' + col + '"]');
        if (cell) {
            var input = cell.querySelector('input');
            input.value = '';
            handleCellInput(input);
        }
    });
    clearSelection()
    updateStatus(cells.length + ' cleared');
}
