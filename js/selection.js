/**
 * Timesheet Extension - Selection Functions
 */

function setAnchor(cell) {
    selectionAnchor = cell;
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
