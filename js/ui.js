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

    // Build headers
    var headerMode = document.getElementById('headerMode').value;
    compInfo.layers.forEach(function (layer, index) {
        var th = document.createElement('th');
        if (headerMode === 'layer') {
            th.textContent = layer.name;
            th.style.minWidth = '60px'; // Give a bit more room for names
        } else {
            th.textContent = columnLabel(index); // A, B, C...
        }
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
            td.dataset.aeLayerIndex = layer.index;

            var input = document.createElement('input');
            input.type = 'text';
            input.dataset.row = frame;
            input.dataset.col = colIndex;

            // Check if there's existing data
            var layerData = currentData[colIndex];
            if (layerData && layerData[frame] !== undefined) {
                input.value = layerData[frame];
            }

            // Cell behavior (focus/change/blur/keydown on the input, mousedown
            // and drag-extend on the td) is handled once, delegated on
            // #tableBody in setupTableHandlers() below — attaching per-cell
            // listeners here would rebuild N handlers on every buildTable().
            td.appendChild(input);
            tr.appendChild(td);
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

/**
 * Attach the table's cell behavior once, delegated on #tableBody. Previously
 * each of the ~frame×layer cells attached 5 listeners in buildTable(); this
 * keeps that wiring identical but only sets it up a single time. Called from
 * main.js on DOMContentLoaded (before the first buildTable).
 */
function setupTableHandlers() {
    var tableBody = document.getElementById('tableBody');

    // FIXED: Proper focus handling
    tableBody.addEventListener('focusin', function (e) {
        var input = e.target;
        if (input.tagName !== 'INPUT') return;
        var cell = input.parentElement;
        var key = cell.dataset.row + '-' + cell.dataset.col;

        // If this cell is not in the currently selected group, clear old selection and select this one
        // But if it's already in the selected group (Multi-select), don't clear selection
        if (!selectedCells.has(key)) {
            clearSelection();
            selectCell(cell);
            setAnchor(cell);
        }
        input.select();
    });

    // FIXED: Proper input handling
    tableBody.addEventListener('change', function (e) {
        if (e.target.tagName !== 'INPUT') return;
        handleCellInput(e.target);
    });

    tableBody.addEventListener('blur', function (e) {
        if (e.target.tagName !== 'INPUT') return;
        if (suppressBlurApply) return;
        handleCellInput(e.target);
    }, true); // capture: input blur fires before focus moves elsewhere

    tableBody.addEventListener('keydown', function (e) {
        if (e.target.tagName !== 'INPUT') return;
        handleCellKeyDown(e);
    });

    tableBody.addEventListener('mousedown', function (e) {
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
                clickedMultiSelectCell = cell;
            }

            e.preventDefault();
            return;
        } else {
            movingCandidate = false;
            clickedMultiSelectCell = null;
        }

        if (e.shiftKey) {
            // Use anchor if available, otherwise use first selected cell
            var anchor = selectionAnchor;
            if (!anchor) {
                var keys = Array.from(selectedCells);
                if (keys.length) {
                    var keyParts = parseCellKey(keys[0]);
                    anchor = getCell(keyParts.row, keyParts.col);
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
                var onlyParts = parseCellKey(onlyKey);
                setAnchor(getCell(onlyParts.row, onlyParts.col));
            }
        } else {
            clearSelection();
            selectCell(cell);
            setAnchor(cell);
            // Don't focus here - will focus on mouseup if not dragging
            // This prevents blur from copying values during drag selection
        }

        // Start dragging selection from this anchor (if not set already)
        if (!dragStartCell) dragStartCell = cell;
        isDragging = true;
        e.preventDefault();
    });

    // mouseenter does not bubble, so drag-extend must listen to the bubbling
    // mouseover instead (fires once per cell boundary crossed).
    tableBody.addEventListener('mouseover', function (e) {
        var cell = (e.target.tagName === 'INPUT') ? e.target.parentElement : e.target.closest('.data-cell');
        if (!cell) return;
        // Only continue dragging if mouse button is still pressed (e.buttons === 1)
        if (isDragging && e.buttons === 1) {
            // Extend selection from dragStartCell to current hovered cell
            extendSelection(cell);
        } else if (isDragging && e.buttons === 0) {
            // Mouse button released during drag
            isDragging = false;
            dragStartCell = null;
        }
    });
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

function setupCustomDropdowns() {
    var selects = document.querySelectorAll('select');
    selects.forEach(function (select) {
        // Skip if already processed
        if (select.parentNode.classList.contains('custom-select-wrapper')) return;

        // Create Wrapper
        var wrapper = document.createElement('div');
        wrapper.className = 'custom-select-wrapper';
        select.parentNode.insertBefore(wrapper, select);
        wrapper.appendChild(select);

        // Create Custom Select Container
        var customSelect = document.createElement('div');
        customSelect.className = 'custom-select';
        wrapper.appendChild(customSelect);

        // Create Trigger
        var trigger = document.createElement('div');
        trigger.className = 'custom-select-trigger';
        // HTML in trigger for arrow
        var selectedOption = select.options[select.selectedIndex];
        trigger.innerHTML = '<span>' + selectedOption.text + '</span>' +
            '<div class="custom-arrow">' +
            '<svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg></div>';
        customSelect.appendChild(trigger);

        // Create Options Container
        var optionsDiv = document.createElement('div');
        optionsDiv.className = 'custom-options';
        customSelect.appendChild(optionsDiv);

        // Populate Options
        Array.from(select.options).forEach(function (option) {
            var customOption = document.createElement('div');
            customOption.className = 'custom-option';
            customOption.textContent = option.text;
            customOption.dataset.value = option.value;
            if (option.selected) {
                customOption.classList.add('selected');
            }

            customOption.addEventListener('click', function (e) {
                // Update original select
                select.value = this.dataset.value;

                // Update trigger text
                trigger.querySelector('span').textContent = this.textContent;

                // Handle visual selection state
                optionsDiv.querySelectorAll('.custom-option').forEach(function (opt) {
                    opt.classList.remove('selected');
                });
                this.classList.add('selected');

                // Close dropdown
                customSelect.classList.remove('open');

                // Trigger change event on original select so app logic runs
                var event = new Event('change');
                select.dispatchEvent(event);

                e.stopPropagation();
            });

            optionsDiv.appendChild(customOption);
        });

        // Toggle Open/Close
        trigger.addEventListener('click', function (e) {
            // Close all other dropdowns
            document.querySelectorAll('.custom-select').forEach(function (el) {
                if (el !== customSelect) el.classList.remove('open');
            });
            customSelect.classList.toggle('open');
            e.stopPropagation();
        });
    });

    // Close when clicking outside
    document.addEventListener('click', function (e) {
        if (!e.target.closest('.custom-select-wrapper')) {
            document.querySelectorAll('.custom-select').forEach(function (el) {
                el.classList.remove('open');
            });
        }
    });
}
