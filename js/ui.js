/**
 * Timesheet Extension - UI Functions
 */

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
                    // Focus the input so user can type immediately
                    var input = cell.querySelector('input');
                    if (input) {
                        input.focus();
                        setTimeout(function () { input.select(); }, 0);
                    }
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

function updateStatus(message) {
    document.getElementById('status').textContent = message;
}

function clearDropPreview() {
    document.querySelectorAll('.data-cell.drop-target').forEach(function (cell) { cell.classList.remove('drop-target'); });
}
