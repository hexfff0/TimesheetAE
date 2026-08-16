/**
 * Timesheet Extension - Event Handlers
 */

function setupEventListeners() {
    document.getElementById('syncBtn').addEventListener('click', syncLayers);
    document.getElementById('clearBtn').addEventListener('click', clearSelection);
    document.getElementById('removeAllBtn').addEventListener('click', removeAllKeyframes);
    document.getElementById('previewBtn').addEventListener('click', previewData);
    document.getElementById('importBtn').addEventListener('click', importData);
    document.getElementById('frameInterval').addEventListener('change', rebuildTable);
    document.getElementById('keyframeType').addEventListener('change', function () {
        updateStatus('Type: ' + this.value);
    });
    document.getElementById('headerMode').addEventListener('change', rebuildTable);
    document.getElementById('previewHeaderRow').addEventListener('click', function (e) {
        if (e.target.tagName !== 'TH' || e.target === this.firstElementChild) return;
        var colIndex = Array.from(this.children).indexOf(e.target) - 1;
        if (colIndex < 0) return;
        addPreviewKeyframes(colIndex);
    });

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

    // Drag-move of selected cells (mousemove/mouseup live in move.js)
    setupMoveHandlers();

    // Camera import + Camera Link modal (live in camera.js)
    setupCameraHandlers();

    // Manual update check - bypasses the periodic cooldown.
    var checkUpdateBtn = document.getElementById('checkUpdateBtn');
    if (checkUpdateBtn) {
        checkUpdateBtn.addEventListener('click', function () {
            checkForUpdates(true);
        });
    }
}

// Shift+Arrow extension when the focused input is a cell: blur first so the
// shift-arrow is consumed as a command (not text selection), then extend.
function extendWithBlur(direction, row, col) {
    var active = document.activeElement;
    if (isCellInput(active)) {
        suppressBlurApply = true;
        active.blur();
        setTimeout(function () {
            suppressBlurApply = false;
            extendSelectionVertical(direction, row, col);
        }, 0);
    } else {
        extendSelectionVertical(direction, row, col);
    }
}

// Alt+Arrow keyframe move shared by handleKeyDown's up/down blocks: a multi-
// selection moves the whole block, a single focused cell moves just that cell.
function moveSelection(direction) {
    suppressBlurApply = true;
    if (selectedCells.size > 1) {
        moveSelectedKeyframes(direction);
    } else {
        var active = document.activeElement;
        if (isCellInput(active)) {
            moveSingleCell(active, direction);
        }
    }
    suppressBlurApply = false;
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

    // Shift + Up/Down: Extend selection
    if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        extendWithBlur(e.key === 'ArrowUp' ? -1 : 1, row, col);
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
    // Arrow Up/Down for multi-select (no focus): navigate from the top/bottom cell
    if (!e.altKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && selectedCells.size > 1) {
        // Only if not focused in an input
        if (!isCellInput(document.activeElement)) {
            e.preventDefault();
            var sorted = Array.from(selectedCells).sort(function (a, b) {
                return parseCellKey(a).row - parseCellKey(b).row;
            });
            var edgeKey = sorted[e.key === 'ArrowUp' ? 0 : sorted.length - 1];
            var keyParts = parseCellKey(edgeKey);
            clearSelection();
            navigateCell(keyParts.row, keyParts.col);
            return;
        }
    }

    // Alt + Up/Down: Move keyframe(s) up or down
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        moveSelection(e.key === 'ArrowUp' ? -1 : 1);
        return;
    }

    // Fill selected cells with same value
    if ((e.key >= '0' && e.key <= '9') && selectedCells.size > 1) {
        e.preventDefault();
        var activeElement = document.activeElement;
        if (isCellInput(activeElement)) {
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
        // If a single cell is focused, let the key edit its value normally
        if (!isCellInput(active) || selectedCells.size > 1) {
            e.preventDefault();
            if (isCellInput(active) && selectedCells.size > 1) {
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

// Preview modal close on X button
document.getElementById('previewModalClose').addEventListener('click', function () {
    document.getElementById('previewModal').classList.remove('open');
    previewImportData = null;
});

// Preview modal close on overlay click
document.getElementById('previewModal').addEventListener('click', function (e) {
    if (e.target === this) {
        this.classList.remove('open');
        previewImportData = null;
    }
});
