/**
 * Timesheet Extension - Event Handlers
 */

function setupEventListeners() {
    document.getElementById('syncBtn').addEventListener('click', syncLayers);
    document.getElementById('clearBtn').addEventListener('click', clearSelection);
    document.getElementById('removeAllBtn').addEventListener('click', removeAllKeyframes);
    document.getElementById('exportBtn').addEventListener('click', exportData);
    document.getElementById('importBtn').addEventListener('click', importData);
    var importCamBtn = document.getElementById('importCamXdtsBtn');
    if (importCamBtn) importCamBtn.addEventListener('click', importCameraFromXdts);
    var newCompBtn = document.getElementById('newCompFromSelBtn');
    if (newCompBtn) newCompBtn.addEventListener('click', newCompFromSelection);
    document.getElementById('frameInterval').addEventListener('change', rebuildTable);
    document.getElementById('keyframeType').addEventListener('change', function () {
        updateStatus('Type: ' + this.value);
    });
    document.getElementById('headerMode').addEventListener('change', rebuildTable);

    // Custom Spinner Logic
    var spinnerUp = document.querySelector('.spinner-up');
    var spinnerDown = document.querySelector('.spinner-down');
    var intervalInput = document.getElementById('frameInterval');

    if (spinnerUp && intervalInput) {
        spinnerUp.addEventListener('click', function () {
            var currentVal = parseInt(intervalInput.value) || 6;
            var max = parseInt(intervalInput.max) || 24;
            if (currentVal < max) {
                intervalInput.value = currentVal + 1;
                rebuildTable();
            }
        });
    }

    if (spinnerDown && intervalInput) {
        spinnerDown.addEventListener('click', function () {
            var currentVal = parseInt(intervalInput.value) || 6;
            var min = parseInt(intervalInput.min) || 1;
            if (currentVal > min) {
                intervalInput.value = currentVal - 1;
                rebuildTable();
            }
        });
    }

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
    document.addEventListener('mouseup', function (e) {
        // If clicked in controls (buttons/inputs), do not steal focus back to cell
        if (e.target.closest('#controls')) return;

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
                        if (currentData[item.col]) {
                            delete currentData[item.col][r];
                        }
                        deleteKeyframe(compInfo.layers[item.col].index, item.layerName, r - 1);
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

        // If single cell is selected, focus it so user can type
        if (selectedCells.size === 1 && !isMoving) {
            var key = Array.from(selectedCells)[0];
            var parts = key.split('-');
            var cell = document.querySelector('[data-row="' + parts[0] + '"][data-col="' + parts[1] + '"]');
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
        suppressBlurApply = true;
        moveSelectedKeyframes(-1);
        suppressBlurApply = false;
        return;
    }

    // Alt + Down: Move selected keyframes down one frame
    if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        suppressBlurApply = true;
        moveSelectedKeyframes(1);
        suppressBlurApply = false;
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
        suppressBlurApply = true;
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
        suppressBlurApply = false;
        return;
    }

    // Alt + Down: Move keyframe(s) down
    if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        suppressBlurApply = true;
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
        suppressBlurApply = false;
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

function importCameraFromXdts() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xdts';
    input.onchange = function (e) {
        var file = e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (e2) {
            try {
                var raw = e2.target.result;
                var jsonStart = raw.indexOf('{');
                if (jsonStart === -1) { updateStatus('Invalid XDTS: no JSON content'); return; }
                var xdts = JSON.parse(raw.substring(jsonStart));
                var timeline = xdts.timeTables && xdts.timeTables[0];
                if (!timeline) { updateStatus('Invalid XDTS: no timeline'); return; }

                var camField = null;
                (timeline.fields || []).forEach(function (f) {
                    if (camField) return;
                    var frames = f.tracks && f.tracks[0] ? f.tracks[0].frames : [];
                    var hasMulti = frames.some(function (fr) {
                        return fr.data && fr.data[0] && fr.data[0].values && fr.data[0].values.length > 1;
                    });
                    if (hasMulti) camField = f;
                });
                if (!camField) { updateStatus('No camera field found'); return; }

                var track = camField.tracks[0];
                var frames = track.frames || [];
                if (!frames.length) {
                    var fieldSummary = [];
                    (timeline.fields || []).forEach(function (f) {
                        var t = f.tracks && f.tracks[0];
                        var fc = t && t.frames ? t.frames.length : 0;
                        fieldSummary.push('f' + f.fieldId + '=' + fc + 'frames');
                    });
                    updateStatus('Camera field ' + camField.fieldId + ' empty. Fields: ' + fieldSummary.join(', '));
                    return;
                }
                var keyframes = [];
                var lastFrame = null;
                frames.forEach(function (fr) {
                    if (!fr.data || !fr.data[0] || !fr.data[0].values) return;
                    var v = fr.data[0].values;
                    if (v[0] === 'SYMBOL_NULL_CELL') return;
                    lastFrame = { f: fr.frame + 1, x: parseFloat(v[1]), y: parseFloat(v[2]), s: parseFloat(v[3]), r: parseFloat(v[4]) };
                    if (v[0] !== 'SYMBOL_HYPHEN') {
                        keyframes.push({ f: fr.frame + 1, x: parseFloat(v[1]), y: parseFloat(v[2]), s: parseFloat(v[3]), r: parseFloat(v[4]) });
                    }
                });
                if (lastFrame && keyframes.length && (lastFrame.f !== keyframes[keyframes.length - 1].f)) {
                    keyframes.push(lastFrame);
                }

                if (!keyframes.length) { updateStatus('No camera keyframes found'); return; }

                var w = parseInt(document.getElementById('camWidth').value) || 1920;
                var h = parseInt(document.getElementById('camHeight').value) || 1080;

                var scriptCall = 'createCameraSolid(' + w + ',' + h + ',\'' + JSON.stringify(keyframes) + '\')';
                csInterface.evalScript(scriptCall, function () {
                    updateStatus('Camera: ' + keyframes.length + 'K imported');
                });
            } catch (err) {
                updateStatus('XDTS parse error: ' + err.message);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function newCompFromSelection() {
    var w = parseInt(document.getElementById('camWidth').value) || 1920;
    var h = parseInt(document.getElementById('camHeight').value) || 1080;
    updateStatus('Creating comp from selection...');
    csInterface.evalScript('createCompFromSelection(' + w + ',' + h + ')', function (res) {
        if (res === 'true') {
            updateStatus('Camera comp created (' + w + 'x' + h + ')');
        } else {
            updateStatus('Comp failed: ' + res);
        }
    });
}
