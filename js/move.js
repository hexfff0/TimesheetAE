/**
 * Timesheet Extension - Drag-Move Logic
 *
 * Drag-selecting and drag-moving of cells. Extracted from events.js so the
 * move state machine (candidate → moving → drop preview → commit/cancel) has
 * one home. setupMoveHandlers() is called from setupEventListeners().
 */

// Move-state machine globals (were declared in state.js).
var isMoving = false;
var movingCandidate = false;
var moveMouseStart = { x: 0, y: 0 };
var moveData = []; // [{row, col, relRow, relCol, value, layerName}]
var currentDropTopLeft = null;

/**
 * Wire the document-level mousemove/mouseup handlers that drive drag-to-move.
 * Drag start itself is initiated from the per-cell mousedown handler in ui.js
 * (which sets movingCandidate + moveMouseStart).
 */
function setupMoveHandlers() {
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
                    var keyParts = parseCellKey(key);
                    rows.push(keyParts.row);
                    cols.push(keyParts.col);
                });
                var minRow = Math.min.apply(null, rows);
                var minCol = Math.min.apply(null, cols);
                moveData = [];
                selectedCells.forEach(function (key) {
                    var keyParts = parseCellKey(key);
                    var r = keyParts.row;
                    var c = keyParts.col;
                    var cell = getCell(r, c);
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
                var dest = getCell(r, c);
                if (dest) dest.classList.add('drop-target');
            });
        }
    });


    // Mouse up event for drag selection
    document.addEventListener('mouseup', function (e) {
        // If clicked in controls (buttons/inputs), do not steal focus back to cell
        if (e.target.closest('#controls')) return;

        // If clicked multi-select cell but didn't drag, focus that cell
        if (clickedMultiSelectCell && !isMoving && selectedCells.size > 1) {
            var cell = clickedMultiSelectCell;
            clearSelection();
            selectCell(cell);
            setAnchor(cell);
            var input = cell.querySelector('input');
            if (input) {
                input.focus();
                setTimeout(function () { input.select(); }, 0);
            }
        }
        clickedMultiSelectCell = null;

        // If we were in moving mode, commit or cancel (do a true move, not copy)
        if (isMoving) {
            if (currentDropTopLeft) {
                // Build destination list
                var destItems = [];
                moveData.forEach(function (item) {
                    var r = currentDropTopLeft.row + item.relRow;
                    var c = currentDropTopLeft.col + item.relCol;
                    var dest = getCell(r, c);
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
                    var cell = getCell(r, c);
                    if (cell) {
                        var input = cell.querySelector('input');
                        if (input.value !== '') {
                            input.value = '';
                            handleCellInput(input);
                        }
                    } else {
                        // Ensure AE state cleared even if DOM cell isn't found
                        if (currentData[item.col]) {
                            delete currentData[item.col][r];
                        }
                        deleteKeyframe(compInfo.layers[item.col].index, item.layerName, r - 1);
                    }
                });

                // Write destinations (add keyframes / values)
                destItems.forEach(function (it) {
                    var cell = getCell(it.row, it.col);
                    if (cell) {
                        var input = cell.querySelector('input');
                        input.value = it.value;
                        handleCellInput(input);
                    }
                });

                // Update selection to new block
                clearSelection();
                destItems.forEach(function (it) {
                    var cell = getCell(it.row, it.col);
                    if (cell) selectCell(cell);
                });
                // set new anchor to top-left of dropped block
                var newAnchorCell = getCell(currentDropTopLeft.row, currentDropTopLeft.col);
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

        // If single cell is selected, focus it so user can type
        if (selectedCells.size === 1 && !isMoving) {
            var key = Array.from(selectedCells)[0];
            var keyParts = parseCellKey(key);
            var cell = getCell(keyParts.row, keyParts.col);
            if (cell) {
                var input = cell.querySelector('input');
                if (input && document.activeElement !== input) {
                    input.focus();
                    setTimeout(function () { input.select(); }, 0);
                }
            }
        }
    });
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