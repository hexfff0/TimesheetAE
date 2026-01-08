/**
 * Timesheet Extension - Main JavaScript
 */

var csInterface = new CSInterface();
var selectedCells = new Set();
var currentData = {};
var compInfo = null;
var isDragging = false;
var dragStartCell = null;
var selectionAnchor = null;
var suppressBlurApply = false;
var isMoving = false;
var movingCandidate = false;
var moveMouseStart = { x: 0, y: 0 };
var moveData = []; // [{row, col, relRow, relCol, value, layerName}]
var moveOrigin = { row: 0, col: 0 };
var currentDropTopLeft = null;
// Initialize
document.addEventListener('DOMContentLoaded', function () {
    setupEventListeners();
    updateStatus('Ready');
});

function setupEventListeners() {
    document.getElementById('syncBtn').addEventListener('click', syncLayers);
    document.getElementById('clearBtn').addEventListener('click', clearSelection);
    document.getElementById('removeAllBtn').addEventListener('click', removeAllKeyframes);
    document.getElementById('exportBtn').addEventListener('click', exportData);
    document.getElementById('importBtn').addEventListener('click', importData);
    document.getElementById('frameInterval').addEventListener('change', rebuildTable);
    document.getElementById('keyframeType').addEventListener('change', function () {
        updateStatus('Type: ' + this.value);
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyDown);

    // Mouse move to detect dragging for "move selection"
    document.addEventListener('mousemove', function (e) {

        // Ignore if there's no active candidate or move
        if (!movingCandidate && !isMoving) return;

        // If left button isn't pressed and we're not already moving, ignore
        if (!isMoving && !(e.buttons & 1)) return;

        // If we somehow lost the mouse button while moving, cancel move
        if (isMoving && !(e.buttons & 1)) {
            cancelMoveProcess();
            return;
        }

        // Start move if candidate and moved past threshold
        if (movingCandidate && !isMoving) {
            var dx = Math.abs(e.clientX - moveMouseStart.x);
            var dy = Math.abs(e.clientY - moveMouseStart.y);
            if (dx > 5 || dy > 5) {
                // Begin moving
                isMoving = true;
                // Build moveData (relative offsets and values)
                var rows = [], cols = [];
                Array.from(selectedCells).forEach(function (key) {
                    var parts = key.split('-');
                    rows.push(parseInt(parts[0]));
                    cols.push(parseInt(parts[1]));
                });
                var minRow = Math.min.apply(null, rows);
                var minCol = Math.min.apply(null, cols);
                moveData = [];
                selectedCells.forEach(function (key) {
                    var parts = key.split('-');
                    var r = parseInt(parts[0]);
                    var c = parseInt(parts[1]);
                    var cell = document.querySelector('[data-row="' + r + '"][data-col="' + c + '"]');
                    var val = cell ? cell.querySelector('input').value : '';
                    moveData.push({
                        row: r,
                        col: c,
                        relRow: r - minRow,
                        relCol: c - minCol,
                        value: val,
                        layerName: cell ? cell.dataset.layerName : null
                    });
                });
                moveOrigin.row = minRow;
                moveOrigin.col = minCol;
                // mark sources visually
                document.querySelectorAll('.data-cell.selected').forEach(function (cell) {
                    cell.classList.add('moving-source');
                });
            }
        }

        // While moving, update drop preview
        if (isMoving) {
            // find hovered cell
            var el = document.elementFromPoint(e.clientX, e.clientY);
            var hoverCell = el ? (el.tagName === 'INPUT' ? el.parentElement : el.closest('.data-cell')) : null;
            if (!hoverCell) {
                clearDropPreview();
                currentDropTopLeft = null;
                return;
            }
            var targetRow = parseInt(hoverCell.dataset.row);
            var targetCol = parseInt(hoverCell.dataset.col);

            // if target top-left hasn't changed, do nothing
            if (currentDropTopLeft && currentDropTopLeft.row === targetRow && currentDropTopLeft.col === targetCol) return;

            // apply preview
            clearDropPreview();
            currentDropTopLeft = { row: targetRow, col: targetCol };
            moveData.forEach(function (item) {
                var r = targetRow + item.relRow;
                var c = targetCol + item.relCol;
                var dest = document.querySelector('[data-row="' + r + '"][data-col="' + c + '"]');
                if (dest) dest.classList.add('drop-target');
            });
        }
    });


    // Mouse up event for drag selection
    document.addEventListener('mouseup', function () {
        // If clicked multi-select cell but didn't drag, focus that cell
        if (window.clickedMultiSelectCell && !isMoving && selectedCells.size > 1) {
            var cell = window.clickedMultiSelectCell;
            clearSelection();
            selectCell(cell);
            setAnchor(cell);
            var input = cell.querySelector('input');
            if (input) {
                input.focus();
                setTimeout(function () { input.select(); }, 0);
            }
        }
        window.clickedMultiSelectCell = null;

        // If we were in moving mode, commit or cancel (do a true move, not copy)
        if (isMoving) {
            if (currentDropTopLeft) {
                // Build destination list
                var destItems = [];
                moveData.forEach(function (item) {
                    var r = currentDropTopLeft.row + item.relRow;
                    var c = currentDropTopLeft.col + item.relCol;
                    var dest = document.querySelector('[data-row="' + r + '"][data-col="' + c + '"]');
                    if (dest) {
                        destItems.push({
                            row: r,
                            col: c,
                            value: item.value,
                            layerName: dest.dataset.layerName
                        });
                    }
                });

                // Prevent multi-apply side-effects while we perform the move
                clearSelection();

                // Clear originals based on moveData (more reliable than selectedCells)
                moveData.forEach(function (item) {
                    var r = item.row, c = item.col;
                    var cell = document.querySelector('[data-row="' + r + '"][data-col="' + c + '"]');
                    if (cell) {
                        var input = cell.querySelector('input');
                        if (input.value !== '') {
                            input.value = '';
                            handleCellInput(input);
                        }
                    } else {
                        // Ensure AE state cleared even if DOM cell isn't found
                        if (currentData[item.layerName]) {
                            delete currentData[item.layerName][r];
                        }
                        deleteKeyframe(item.layerName, r - 1);
                    }
                });

                // Write destinations (add keyframes / values)
                destItems.forEach(function (it) {
                    var cell = document.querySelector('[data-row="' + it.row + '"][data-col="' + it.col + '"]');
                    if (cell) {
                        var input = cell.querySelector('input');
                        input.value = it.value;
                        handleCellInput(input);
                    }
                });

                // Update selection to new block
                clearSelection();
                destItems.forEach(function (it) {
                    var cell = document.querySelector('[data-row="' + it.row + '"][data-col="' + it.col + '"]');
                    if (cell) selectCell(cell);
                });
                // set new anchor to top-left of dropped block
                var newAnchorCell = document.querySelector('[data-row="' + currentDropTopLeft.row + '"][data-col="' + currentDropTopLeft.col + '"]');
                if (newAnchorCell) setAnchor(newAnchorCell);

                updateStatus('Moved ' + moveData.length + ' cells');
            } else {
                updateStatus('Move cancelled (no valid drop target)');
            }

            // cleanup move state & visuals
            isMoving = false;
            movingCandidate = false;
            moveData = [];
            currentDropTopLeft = null;
            document.querySelectorAll('.data-cell.moving-source').forEach(function (cell) { cell.classList.remove('moving-source'); });
            clearDropPreview();
        }

        // reset drag selection flags
        isDragging = false;
        dragStartCell = null;

        // Ensure we don't remain a "move candidate" after mouse is released
        movingCandidate = false;
        moveMouseStart = { x: 0, y: 0 };
    });

    // helper to clear preview classes
    function clearDropPreview() {
        document.querySelectorAll('.data-cell.drop-target').forEach(function (cell) { cell.classList.remove('drop-target'); });
    }
}

// centralized cancel/cleanup for moves
function cancelMoveProcess() {
    if (!isMoving && !movingCandidate) return;
    isMoving = false;
    movingCandidate = false;
    moveData = [];
    currentDropTopLeft = null;
    document.querySelectorAll('.data-cell.moving-source').forEach(function (cell) { cell.classList.remove('moving-source'); });
    clearDropPreview();
    updateStatus('Move cancelled');
}

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

function buildTable() {
    if (!compInfo) return;

    var headerRow = document.getElementById('headerRow');
    var tableBody = document.getElementById('tableBody');

    // Clear existing content
    headerRow.innerHTML = '<th style="width: 50px;">Frame</th>';
    tableBody.innerHTML = '';

    // Build headers (A, B, C, ...)
    compInfo.layers.forEach(function (layer, index) {
        var th = document.createElement('th');
        th.textContent = String.fromCharCode(65 + index); // A, B, C...
        th.title = layer.name;
        headerRow.appendChild(th);
    });

    // Add second label column
    var thSecond = document.createElement('th');
    thSecond.style.width = '30px';
    thSecond.textContent = 's';
    headerRow.appendChild(thSecond);

    // Build rows - START FROM 1 instead of 0
    var frameInterval = parseInt(document.getElementById('frameInterval').value) || 6;
    var fps = compInfo.fps;

    for (var frame = 1; frame <= compInfo.duration; frame++) {
        var tr = document.createElement('tr');

        // Add border classes
        if (frame > 1) {
            if (frame % fps === 1) {
                tr.classList.add('second-border');
            }
            if (frame % frameInterval === 1) {
                tr.classList.add('thick-border');
            }
        }

        // Frame number (1-based)
        var tdFrame = document.createElement('td');
        tdFrame.classList.add('frame-label');
        tdFrame.textContent = frame;
        tr.appendChild(tdFrame);

        // Data cells
        compInfo.layers.forEach(function (layer, colIndex) {
            var td = document.createElement('td');
            td.classList.add('data-cell');
            td.dataset.row = frame;
            td.dataset.col = colIndex;
            td.dataset.layerName = layer.name;

            var input = document.createElement('input');
            input.type = 'text';
            input.dataset.row = frame;
            input.dataset.col = colIndex;

            // Check if there's existing data
            if (currentData[layer.name] && currentData[layer.name][frame] !== undefined) {
                input.value = currentData[layer.name][frame];
            }

            // เป็นแบบนี้ (เช็คทั้ง Index และ Name):
            var layerData = currentData[colIndex] || currentData[layer.name];
            if (layerData && layerData[frame] !== undefined) {
                input.value = layerData[frame];
            }

            // FIXED: Proper focus handling
            input.addEventListener('focus', function (e) {
                var cell = e.target.parentElement;
                var key = cell.dataset.row + '-' + cell.dataset.col;

                // If this cell is not in the currently selected group, clear old selection and select this one
                // But if it's already in the selected group (Multi-select), don't clear selection
                if (!selectedCells.has(key)) {
                    clearSelection();
                    selectCell(cell);
                    setAnchor(cell);
                }
                e.target.select();
            });

            // FIXED: Proper input handling
            input.addEventListener('change', function (e) {
                handleCellInput(e.target);
            });

            input.addEventListener('blur', function (e) {
                if (suppressBlurApply) return;
                handleCellInput(e.target);
            });

            input.addEventListener('keydown', function (e) {
                handleCellKeyDown(e);
            });

            td.appendChild(input);
            tr.appendChild(td);

            td.addEventListener('mousedown', function (e) {
                // Only respond to left button
                if (e.button !== 0) return;
                // Prevent blur trigger during selection change
                suppressBlurApply = true;
                setTimeout(function () { suppressBlurApply = false; }, 0);

                // Normalize target to cell (click on input -> parent cell)
                var cell = (e.target.tagName === 'INPUT') ? e.target.parentElement : e.target.closest('.data-cell');
                if (!cell) return;
                var key = cell.dataset.row + '-' + cell.dataset.col;

                // Prepare move candidate if clicked on an already selected cell (no modifier)
                if (!e.shiftKey && !e.ctrlKey && selectedCells.has(key)) {
                    movingCandidate = true;
                    moveMouseStart = { x: e.clientX, y: e.clientY };

                    // If multi-select: allow drag to proceed, but also prepare for focus
                    if (selectedCells.size > 1) {
                        // Set a flag to focus this cell if no drag happens
                        window.clickedMultiSelectCell = cell;
                    }

                    e.preventDefault();
                    return;
                } else {
                    movingCandidate = false;
                    window.clickedMultiSelectCell = null;
                }

                if (e.shiftKey) {
                    // Use anchor if available, otherwise use first selected cell
                    var anchor = selectionAnchor;
                    if (!anchor) {
                        var keys = Array.from(selectedCells);
                        if (keys.length) {
                            var parts = keys[0].split('-');
                            anchor = document.querySelector('[data-row="' + parts[0] + '"][data-col="' + parts[1] + '"]');
                        }
                    }
                    if (anchor) {
                        dragStartCell = anchor;
                        extendSelection(cell);
                    } else {
                        clearSelection();
                        selectCell(cell);
                        setAnchor(cell);
                    }
                } else if (e.ctrlKey || e.metaKey) {
                    toggleCellSelection(cell);
                    // If only one left, make it the anchor
                    if (selectedCells.size === 1) {
                        var onlyKey = Array.from(selectedCells)[0];
                        var parts = onlyKey.split('-');
                        setAnchor(document.querySelector('[data-row="' + parts[0] + '"][data-col="' + parts[1] + '"]'));
                    }
                } else {
                    clearSelection();
                    selectCell(cell);
                    setAnchor(cell);
                }

                // Start dragging selection from this anchor (if not set already)
                if (!dragStartCell) dragStartCell = cell;
                isDragging = true;
                e.preventDefault();
            });


            td.addEventListener('mouseenter', function (e) {
                // Only continue dragging if mouse button is still pressed (e.buttons === 1)
                if (isDragging && e.buttons === 1) {
                    // Extend selection from dragStartCell to current hovered cell
                    extendSelection(this);
                } else if (isDragging && e.buttons === 0) {
                    // Mouse button released during drag
                    isDragging = false;
                    dragStartCell = null;
                }

            });
        });

        // Second label - FIXED
        var tdSecond = document.createElement('td');
        tdSecond.classList.add('second-label');
        // For 24fps: show "1" at frame 24 (which is 1 second after frame 1)
        var secondMark = (frame) / fps;
        if (Number.isInteger(secondMark) && frame > 1) {
            tdSecond.textContent = secondMark;
        }
        tr.appendChild(tdSecond);

        tableBody.appendChild(tr);
    }
}

function rebuildTable() {
    if (compInfo) {
        buildTable();
        updateStatus('Interval updated');
    }
}

function selectCell(cell) {
    cell.classList.add('selected');
    var key = cell.dataset.row + '-' + cell.dataset.col;
    selectedCells.add(key);

    ensureBlurForMultiSelection();
}

function toggleCellSelection(cell) {
    var key = cell.dataset.row + '-' + cell.dataset.col;
    if (selectedCells.has(key)) {
        cell.classList.remove('selected');
        selectedCells.delete(key);
    } else {
        cell.classList.add('selected');
        selectedCells.add(key);
    }

    ensureBlurForMultiSelection();
}

function ensureBlurForMultiSelection() {
    var active = document.activeElement;
    if (selectedCells.size > 1 &&
        active && active.tagName === 'INPUT' &&
        active.parentElement && active.parentElement.classList.contains('data-cell')) {
        active.blur();
    }
}

function extendSelection(endCell) {
    if (!dragStartCell || !endCell) return;

    var startRow = parseInt(dragStartCell.dataset.row);
    var startCol = parseInt(dragStartCell.dataset.col);
    var endRow = parseInt(endCell.dataset.row);
    var endCol = parseInt(endCell.dataset.col);

    var minRow = Math.min(startRow, endRow);
    var maxRow = Math.max(startRow, endRow);
    var minCol = Math.min(startCol, endCol);
    var maxCol = Math.max(startCol, endCol);

    clearSelection();

    for (var r = minRow; r <= maxRow; r++) {
        for (var c = minCol; c <= maxCol; c++) {
            var cell = document.querySelector('[data-row="' + r + '"][data-col="' + c + '"]');
            if (cell && cell.classList.contains('data-cell')) {
                selectCell(cell);
            }
        }
    }
}

function clearSelection() {
    document.querySelectorAll('.data-cell.selected').forEach(function (cell) {
        cell.classList.remove('selected');
    });
    selectedCells.clear();
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
        // กรณีแก้ช่องเดียว (โค้ดเดิมของคุณ)
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

function handleCellKeyDown(e) {
    var input = e.target;
    var row = parseInt(input.dataset.row);
    var col = parseInt(input.dataset.col);
    var cellKey = row + '-' + col;

    // Check if current cell is selected
    var isSelected = selectedCells.has(cellKey);

    // Ctrl/Cmd + Up: Select from current to frame 1
    if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowUp') {
        e.preventDefault();
        selectToTop(row, col);
        return;
    }

    // Ctrl/Cmd + Down: Select from current to last frame
    if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowDown') {
        e.preventDefault();
        selectToBottom(row, col);
        return;
    }

    // Alt + Up: Move selected keyframes up one frame
    if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        moveSelectedKeyframes(-1);
        return;
    }

    // Alt + Down: Move selected keyframes down one frame
    if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        moveSelectedKeyframes(1);
        return;
    }

    // Shift + Up: Extend selection upward
    if (e.shiftKey && e.key === 'ArrowUp') {
        e.preventDefault();
        var active = document.activeElement;
        if (active && active.tagName === 'INPUT' && active.parentElement && active.parentElement.classList.contains('data-cell')) {
            suppressBlurApply = true;
            active.blur();
            setTimeout(function () {
                suppressBlurApply = false;
                extendSelectionVertical(-1, row, col);
            }, 0);
        } else {
            extendSelectionVertical(-1, row, col);
        }
        return;
    }

    // Shift + Down: Extend selection downward
    if (e.shiftKey && e.key === 'ArrowDown') {
        e.preventDefault();
        var active = document.activeElement;
        if (active && active.tagName === 'INPUT' && active.parentElement && active.parentElement.classList.contains('data-cell')) {
            suppressBlurApply = true;
            active.blur();
            setTimeout(function () {
                suppressBlurApply = false;
                extendSelectionVertical(1, row, col);
            }, 0);
        } else {
            extendSelectionVertical(1, row, col);
        }
        return;
    }

    // Left Arrow: Decrease keyframe value by 1 (or delete if value is 1)
    if (e.key === 'ArrowLeft' && input.selectionStart === 0 && input.selectionEnd === 0) {
        e.preventDefault();
        decreaseKeyframeValue(input, row, col);
        return;
    }

    // Right Arrow: Increase keyframe value by 1 (or create if empty)
    if (e.key === 'ArrowRight' && input.selectionStart === input.value.length) {
        e.preventDefault();
        increaseKeyframeValue(input, row, col);
        return;
    }

    // Regular navigation
    switch (e.key) {
        case 'ArrowUp':
            // Navigate up (works when focused, clears selection if any)
            if (isSelected) clearSelection();
            e.preventDefault();
            navigateCell(row - 1, col);
            break;
        case 'ArrowDown':
            // Navigate down (works when focused, clears selection if any)
            if (isSelected) clearSelection();
            e.preventDefault();
            navigateCell(row + 1, col);
            break;
        case 'Enter':
            clearSelection();
            e.preventDefault();
            navigateCell(row + 1, col);
            break;
        case 'Tab':
            // Tab works when focused in input, regardless of selection state
            e.preventDefault();
            if (e.shiftKey) {
                navigateCell(row, col - 1);
            } else {
                navigateCell(row, col + 1);
            }
            break;
    }
}

function navigateCell(row, col) {
    var targetCell = document.querySelector('[data-row="' + row + '"][data-col="' + col + '"]');
    if (targetCell && targetCell.classList.contains('data-cell')) {
        var input = targetCell.querySelector('input');
        if (input) {
            input.focus();
            setTimeout(function () {
                if (document.activeElement === input) {
                    input.select();
                }
            }, 0);
        }
    } else {
        // At boundary - stay at current position and maintain selection
        var currentCell = document.querySelector('[data-row="' + (row + (row < 1 ? 1 : -1)) + '"][data-col="' + col + '"]');
        if (!currentCell) {
            currentCell = document.querySelector('[data-row="' + row + '"][data-col="' + col + '"]');
        }
        if (currentCell) {
            var input = currentCell.querySelector('input');
            if (input && document.activeElement === input) {
                // Already focused - just ensure selection
                setTimeout(function () {
                    if (document.activeElement === input) {
                        input.select();
                    }
                }, 0);
            }
        }
    }
}

// Select from current cell to frame 1 (same column)
function selectToTop(currentRow, currentCol) {
    clearSelection();

    for (var row = 1; row <= currentRow; row++) {
        var cell = document.querySelector('[data-row="' + row + '"][data-col="' + currentCol + '"]');
        if (cell && cell.classList.contains('data-cell')) {
            selectCell(cell);
        }
    }

    updateStatus('Selected to top');
}

// Select from current cell to last frame (same column)
function selectToBottom(currentRow, currentCol) {
    if (!compInfo) return;

    clearSelection();

    for (var row = currentRow; row <= compInfo.duration; row++) {
        var cell = document.querySelector('[data-row="' + row + '"][data-col="' + currentCol + '"]');
        if (cell && cell.classList.contains('data-cell')) {
            selectCell(cell);
        }
    }

    updateStatus('Selected to bottom');
}

// Extend selection vertically (up or down)
function extendSelectionVertical(direction, currentRow, currentCol) {
    var targetRow = currentRow + direction;
    var cell = document.querySelector('[data-row="' + targetRow + '"][data-col="' + currentCol + '"]');

    if (cell && cell.classList.contains('data-cell')) {
        selectCell(cell);
        // Focus on the new cell
        var input = cell.querySelector('input');
        if (input) {
            input.focus();
            input.select();
        }
    }
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

    // Clear old positions
    cellsToMove.forEach(function (item) {
        var oldCell = document.querySelector('[data-row="' + item.oldRow + '"][data-col="' + item.col + '"]');
        if (oldCell) {
            var input = oldCell.querySelector('input');
            input.value = '';
            delete currentData[item.layerName][item.oldRow];
            deleteKeyframe(item.layerName, item.oldRow - 1);
        }
    });

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

function navigateCell(row, col) {
    var targetCell = document.querySelector('[data-row="' + row + '"][data-col="' + col + '"]');
    if (targetCell && targetCell.classList.contains('data-cell')) {
        var input = targetCell.querySelector('input');
        input.focus();
        input.select();
    }
}


function handleKeyDown(e) {
    // Arrow Up/Down for multi-select (no focus): clear and navigate
    if (!e.altKey && !e.shiftKey && e.key === 'ArrowUp' && selectedCells.size > 1) {
        var activeElement = document.activeElement;
        // Only if not focused in an input
        if (!activeElement || activeElement.tagName !== 'INPUT' ||
            !activeElement.parentElement.classList.contains('data-cell')) {
            e.preventDefault();
            var firstKey = Array.from(selectedCells).sort(function (a, b) {
                return parseInt(a.split('-')[0]) - parseInt(b.split('-')[0]);
            })[0];
            var parts = firstKey.split('-');
            clearSelection();
            navigateCell(parseInt(parts[0]), parseInt(parts[1]));
            return;
        }
    }

    if (!e.altKey && !e.shiftKey && e.key === 'ArrowDown' && selectedCells.size > 1) {
        var activeElement = document.activeElement;
        // Only if not focused in an input
        if (!activeElement || activeElement.tagName !== 'INPUT' ||
            !activeElement.parentElement.classList.contains('data-cell')) {
            e.preventDefault();
            var lastKey = Array.from(selectedCells).sort(function (a, b) {
                return parseInt(b.split('-')[0]) - parseInt(a.split('-')[0]);
            })[0];
            var parts = lastKey.split('-');
            clearSelection();
            navigateCell(parseInt(parts[0]), parseInt(parts[1]));
            return;
        }
    }

    // Alt + Up: Move keyframe(s) up
    if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        if (selectedCells.size > 1) {
            // Multi-select mode
            moveSelectedKeyframes(-1);
        } else {
            // Single cell mode - check if focused on input with value
            var active = document.activeElement;
            if (active && active.tagName === 'INPUT' &&
                active.parentElement && active.parentElement.classList.contains('data-cell')) {
                moveSingleCell(active, -1);
            }
        }
        return;
    }

    // Alt + Down: Move keyframe(s) down
    if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        if (selectedCells.size > 1) {
            // Multi-select mode
            moveSelectedKeyframes(1);
        } else {
            // Single cell mode - check if focused on input with value
            var active = document.activeElement;
            if (active && active.tagName === 'INPUT' &&
                active.parentElement && active.parentElement.classList.contains('data-cell')) {
                moveSingleCell(active, 1);
            }
        }
        return;
    }

    // Fill selected cells with same value
    if ((e.key >= '0' && e.key <= '9') && selectedCells.size > 1) {
        e.preventDefault();
        var activeElement = document.activeElement;
        if (activeElement && activeElement.tagName === 'INPUT' &&
            activeElement.parentElement && activeElement.parentElement.classList.contains('data-cell')) {
            // Blur first then fill, so the key press is interpreted as a command rather than typing in input
            suppressBlurApply = true;
            activeElement.blur();
            setTimeout(function () {
                suppressBlurApply = false;
                fillSelectedCells(e.key);
            }, 0);
        } else {
            fillSelectedCells(e.key);
        }
    }

    // Delete selected cells
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedCells.size > 0) {
        var active = document.activeElement;
        // If focus is in input of data-cell and only one cell is selected, let it work normally (to edit value)
        if (!(active && active.tagName === 'INPUT' && active.parentElement && active.parentElement.classList.contains('data-cell') && selectedCells.size === 1)) {
            e.preventDefault();
            if (active && active.tagName === 'INPUT' && active.parentElement && active.parentElement.classList.contains('data-cell') && selectedCells.size > 1) {
                suppressBlurApply = true;
                active.blur();
                setTimeout(function () {
                    suppressBlurApply = false;
                    deleteSelectedCells();
                }, 0);
            } else {
                deleteSelectedCells();
            }
        }
    }
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

function updateStatus(message) {
    document.getElementById('status').textContent = message;
}

function exportData() {
    if (!compInfo) {
        updateStatus('Error: No data to export. Sync layers first.');
        return;
    }

    csInterface.evalScript('showExportTypeDialog()', function (result) {
        if (result === "csv" || result === "json") {
            executeExport(result);
        } else {
            updateStatus('Export Cancelled');
        }
    });
}

function executeExport(type) {
    var extension = type;
    var defaultName = compInfo.compName + "_timesheet." + extension;
    var result = window.cep.fs.showSaveDialogEx("Save " + type.toUpperCase(), "", [extension], defaultName);

    if (result.err === 0 && result.data) {
        var filePath = result.data;
        var fps = compInfo.fps;
        var totalFrames = Math.ceil(compInfo.duration);
        var finalContent = "";

        if (type === 'csv') {
            // --- LOGIC CSV ---
            var rows = [];
            rows.push('"Frame","","",""'); // Header 1
            var header2 = ['""'];
            compInfo.layers.forEach(function (l) { header2.push('"' + l.name + '"'); });
            rows.push(header2.join(','));

            for (var f = 1; f <= totalFrames; f++) {
                var row = ['"' + f + '"'];
                compInfo.layers.forEach(function (layer) {
                    var layerData = currentData[layer.name] || {};
                    var val = "";
                    if (layerData[f] !== undefined) val = layerData[f];
                    else if (f === Math.round(layer.outPoint * fps) + 1) val = "×";
                    row.push('"' + val + '"');
                });
                rows.push(row.join(','));
            }
            finalContent = rows.join('\r\n');
        } else {
            // --- LOGIC JSON ---
            var indexedData = {};
            compInfo.layers.forEach(function (layer, index) {
                var layerData = currentData[layer.name] || {};
                var processed = {};

                // Store keyframe data
                Object.keys(layerData).forEach(function (k) { processed[k] = layerData[k]; });

                // Add end marker ×
                var marker = Math.round(layer.outPoint * fps) + 1;
                if (processed[marker] === undefined) processed[marker] = "×";

                // Use index as key for ordering A, B, C (0, 1, 2)
                indexedData[index] = processed;
            });

            finalContent = JSON.stringify({
                version: '1.2',
                compName: compInfo.compName,
                fps: fps,
                duration: compInfo.duration,
                data: indexedData
            }, null, 2);
        }

        var fs = require('fs');
        fs.writeFile(filePath, finalContent, 'utf8', function (err) {
            if (!err) updateStatus('Exported: ' + type.toUpperCase());
        });
    }
}

function parseCSVLine_Import(line) {
    var result = [];
    var current = '';
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
        var char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    return result;
}

function parseCSVToTimesheet_Import(csvContent, filename) {
    try {
        var lines = csvContent.split(/\r?\n/);
        if (lines.length < 3) return null;

        var headerRow2 = parseCSVLine_Import(lines[1]);
        var numColumns = headerRow2.length - 1;

        var layersData = {};
        for (var col = 0; col < numColumns; col++) {
            layersData[String(col)] = {};
        }

        var maxFrame = 0;
        var endMarkerPerColumn = {};

        function isEndMarker(value) {
            if (!value) return false;
            return value.indexOf('×') !== -1 ||
                value.indexOf('�') !== -1 ||
                value.indexOf('\xd7') !== -1 ||
                value.indexOf('\ufffd') !== -1;
        }

        for (var i = 2; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;

            var row = parseCSVLine_Import(line);
            if (row.length === 0 || !row[0]) continue;

            try {
                var frameVal = parseInt(row[0]);
                if (isNaN(frameVal)) continue;
                var frameIdx = String(frameVal);
                if (frameVal > maxFrame) maxFrame = frameVal;

                for (var col = 0; col < numColumns; col++) {
                    var colIndex = col + 1;
                    if (row.length > colIndex && row[colIndex] && row[colIndex].trim()) {
                        var value = row[colIndex].trim();
                        if (isEndMarker(value)) {
                            if (!endMarkerPerColumn[String(col)]) {
                                endMarkerPerColumn[String(col)] = frameVal;
                            }
                            continue;
                        }
                        layersData[String(col)][frameIdx] = value;
                    }
                }
            } catch (e) {
                continue;
            }
        }

        return {
            version: '1.2',
            compName: filename.replace('.csv', ''),
            fps: 24,
            duration: maxFrame,
            frameInterval: 6,
            keyframeType: 'hold',
            data: layersData,
            endMarkers: endMarkerPerColumn
        };
    } catch (e) {
        console.error('CSV parsing error:', e);
        return null;
    }
}

// Add keyframe for IMPORT (uses addTimeRemapKeyframe_Import in hostscript)
function addKeyframe_Import(layerName, frame, value) {
    var keyframeType = document.getElementById('keyframeType').value;
    var scriptCall = 'addTimeRemapKeyframe_Import("' + layerName + '", ' + frame + ', ' +
        value + ', "' + keyframeType + '", ' + compInfo.fps + ')';
    csInterface.evalScript(scriptCall, function (result) {
        if (result && result !== 'true') {
            console.error('Import keyframe error:', result);
        }
    });
}

function applyAllKeyframes_Import() {
    if (!compInfo || !currentData) return;

    var layersProcessed = 0;
    var totalKeyframes = 0;

    compInfo.layers.forEach(function (layer) {
        csInterface.evalScript('clearAllTimeRemapKeyframes("' + layer.name + '")', function () {
            layersProcessed++;
            if (layersProcessed === compInfo.layers.length) {
                applyNewKeyframes_Import();
            }
        });
    });

    function applyNewKeyframes_Import() {
        totalKeyframes = 0;
        var endMarkers = window.importedEndMarkers_V17 || {};
        var maxFrame = window.importedMaxFrame_V17 || Math.ceil(compInfo.duration);
        var fps = compInfo.fps || 24;
        var hasAnyEndMarker = Object.keys(endMarkers).length > 0;
        var firstFramePerLayer = {};

        compInfo.layers.forEach(function (layer, index) {
            var layerData = currentData[index] || currentData[layer.name];
            if (layerData) {
                var frames = Object.keys(layerData).map(function (f) { return parseInt(f); }).sort(function (a, b) { return a - b; });
                if (frames.length > 0) {
                    firstFramePerLayer[layer.name] = frames[0];
                }
                Object.keys(layerData).forEach(function (frame) {
                    var value = layerData[frame];
                    addKeyframe_Import(layer.name, parseInt(frame), value);
                    totalKeyframes++;
                });
            }
        });

        var layersCleanedUp = 0;
        compInfo.layers.forEach(function (layer) {
            var firstFrame = firstFramePerLayer[layer.name] || 1;
            csInterface.evalScript(
                'removeFirstKeyframeIfNeeded("' + layer.name + '", ' + firstFrame + ', ' + fps + ')',
                function () {
                    layersCleanedUp++;
                    if (layersCleanedUp === compInfo.layers.length) {
                        applyLayerDurations_Import();
                    }
                }
            );
        });

        function applyLayerDurations_Import() {
            var layersTrimmed = 0;
            compInfo.layers.forEach(function (layer, index) {
                var endFrame = endMarkers[String(index)] || 0;
                csInterface.evalScript(
                    'trimLayerDuration("' + layer.name + '", ' + endFrame + ', ' + maxFrame + ', ' + fps + ')',
                    function () {
                        layersTrimmed++;
                        if (layersTrimmed === compInfo.layers.length) {
                            // ALL operations completed
                            if (hasAnyEndMarker) {
                                updateStatus(totalKeyframes + ' keyframes applied with duration trimming');
                            } else {
                                updateStatus(totalKeyframes + ' keyframes applied');
                            }

                            // Trigger second pass if this is first pass
                            if (window.isImportInProgress && window.importPassNumber === 1) {
                                window.importPassNumber = 2;
                                setTimeout(function () {
                                    applyAllKeyframes_Import();
                                }, 500);
                            } else {
                                // Second pass completed - cleanup
                                window.importedEndMarkers_V17 = null;
                                window.importedMaxFrame_V17 = null;
                                window.isImportInProgress = false;
                                window.importPassNumber = 0;
                                updateStatus(totalKeyframes + ' keyframes imported (2 passes completed)');
                            }
                        }
                    }
                );
            });
        }
        syncLayers();
    }
}

// Parse JSON and extract × markers into endMarkers
function parseJSONWithMarkers(importObj) {
    var cleanData = {};
    var endMarkers = importObj.endMarkers || {};

    // Process each layer's data
    Object.keys(importObj.data).forEach(function (layerIndex) {
        var layerData = importObj.data[layerIndex];
        cleanData[layerIndex] = {};

        Object.keys(layerData).forEach(function (frame) {
            var value = layerData[frame];
            var valueStr = String(value); // Convert to string for checking

            // Check if this is an end marker
            if (valueStr === "×" || valueStr === "�" || valueStr.indexOf('×') !== -1 || valueStr.indexOf('�') !== -1) {
                // Store as end marker for this layer
                endMarkers[String(layerIndex)] = parseInt(frame);
            } else {
                // Store as regular keyframe
                cleanData[layerIndex][frame] = value;
            }
        });
    });

    return {
        data: cleanData,
        endMarkers: endMarkers,
        duration: importObj.duration,
        frameInterval: importObj.frameInterval,
        keyframeType: importObj.keyframeType
    };
}

function importData() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.csv';

    syncLayers();

    input.onchange = function (e) {
        var file = e.target.files[0];
        if (!file) return;

        var reader = new FileReader();
        reader.onload = function (event) {
            try {
                var content = event.target.result;
                var importObj;

                if (file.name.toLowerCase().endsWith('.csv')) {
                    importObj = parseCSVToTimesheet_Import(content, file.name);
                    if (!importObj) {
                        updateStatus('Invalid CSV format');
                        return;
                    }
                } else {
                    var rawJSON = JSON.parse(content);
                    if (!rawJSON || !rawJSON.data) {
                        updateStatus('Invalid JSON format');
                        return;
                    }
                    // Parse JSON and extract × markers
                    importObj = parseJSONWithMarkers(rawJSON);
                }

                currentData = importObj.data;
                window.importedEndMarkers_V17 = importObj.endMarkers || {};
                window.importedMaxFrame_V17 = importObj.duration || 0;
                window.isImportInProgress = true;
                window.importPassNumber = 1;  // Start with pass 1

                document.getElementById('frameInterval').value = importObj.frameInterval || 6;

                if (compInfo) {
                    buildTable();

                    // Start pass 1 (pass 2 will be triggered automatically)
                    applyAllKeyframes_Import();
                } else {
                    updateStatus('Loaded. Sync to apply.');
                }

            } catch (err) {
                updateStatus('Error: ' + err.message);
                window.isImportInProgress = false;
            }
        };
        reader.readAsText(file);
    };

    input.click();
}
