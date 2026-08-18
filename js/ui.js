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
    // #status is now a flex row holding the message span and the bottom-right
    // version label; writing to the whole container would erase the label.
    // Fall back to #status for any cached HTML without the span.
    var textEl = document.getElementById('statusText') || document.getElementById('status');
    if (textEl) textEl.textContent = message;
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
        var trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'custom-select-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        // The native select is display:none, so label[for] cannot name the
        // trigger; carry the visible label text over as its accessible name.
        if (select.id) {
            var associatedLabel = document.querySelector('label[for="' + select.id + '"]');
            if (associatedLabel) {
                var labelText = associatedLabel.textContent.trim();
                if (labelText) trigger.setAttribute('aria-label', labelText);
            }
        }
        var selectedOption = select.options[select.selectedIndex];
        trigger.innerHTML = '<span>' + selectedOption.text + '</span>' +
            '<div class="custom-arrow" aria-hidden="true">' +
            '<svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg></div>';
        customSelect.appendChild(trigger);

        // Create Options Container
        var optionsDiv = document.createElement('div');
        optionsDiv.className = 'custom-options';
        optionsDiv.setAttribute('role', 'listbox');
        customSelect.appendChild(optionsDiv);

        var optionEls = [];

        // Rebuild the option list (label links to the trigger).
        function renderOptions() {
            optionsDiv.innerHTML = '';
            optionEls = [];
            var nodes = select.options;
            for (var k = 0; k < nodes.length; k++) {
                var option = nodes[k];
                var customOption = document.createElement('div');
                customOption.className = 'custom-option';
                customOption.setAttribute('role', 'option');
                customOption.id = 'opt-' + (select.id || select.name || 'sel') + '-' + k;
                customOption.setAttribute('aria-selected', k === select.selectedIndex ? 'true' : 'false');
                customOption.textContent = option.text;
                customOption.dataset.value = option.value;
                customOption.dataset.index = k;
                if (k === select.selectedIndex) {
                    customOption.classList.add('selected');
                }
                optionsDiv.appendChild(customOption);
                optionEls.push(customOption);
            }
        }
        renderOptions();

        // Active cursor: the option visually highlighted while the listbox is
        // open (roving). The committed value is tracked separately so moving
        // the cursor with arrows never commits — commit only on Enter/Space.
        var activeIndex = select.selectedIndex;

        function setActiveOption(index) {
            index = (index + optionEls.length) % optionEls.length;
            activeIndex = index;
            optionEls.forEach(function (el, i) {
                el.classList.toggle('active', i === index);
            });
            var active = optionEls[index];
            if (active && active.scrollIntoView) {
                active.scrollIntoView({ block: 'nearest' });
            }
        }

        // Persist the currently active option as the selected value.
        function commitActive() {
            var optEl = optionEls[activeIndex];
            if (!optEl) return;
            selectOption(activeIndex);
            closeListbox();
            var event = new Event('change');
            select.dispatchEvent(event);
            trigger.focus();
        }

        // Reflect a committed choice in the trigger + select + selected states.
        function selectOption(index) {
            var optEl = optionEls[index];
            if (!optEl) return;
            select.value = optEl.dataset.value;
            trigger.querySelector('span').textContent = optEl.textContent;
            optionEls.forEach(function (el) {
                el.classList.toggle('selected', el === optEl);
                el.setAttribute('aria-selected', el === optEl ? 'true' : 'false');
            });
            activeIndex = index;
        }

        function openListbox() {
            // Close all other dropdowns
            document.querySelectorAll('.custom-select').forEach(function (el) {
                if (el !== customSelect) el.classList.remove('open');
                var trig = el.querySelector('.custom-select-trigger');
                if (trig) trig.setAttribute('aria-expanded', 'false');
            });
            // Open on the current active option, not a reset to the selected one.
            customSelect.classList.add('open');
            toggleExpanded(true);
            setActiveOption(activeIndex);
        }

        function toggleExpanded(open) {
            trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        }

        function closeListbox() {
            customSelect.classList.remove('open');
            toggleExpanded(false);
        }

        // Mouse interaction
        optionEls.forEach(function (customOption) {
            customOption.addEventListener('mousedown', function (e) {
                // Keep focus on the trigger so the listbox closes predictably.
                e.preventDefault();
            });
            customOption.addEventListener('click', function (e) {
                selectOption(parseInt(this.dataset.index));
                commitActive();
                e.stopPropagation();
            });
        });

        trigger.addEventListener('click', function (e) {
            if (customSelect.classList.contains('open')) {
                closeListbox();
            } else {
                openListbox();
            }
            e.stopPropagation();
        });

        // Keyboard interaction (ARIA combobox / listbox pattern)
        trigger.addEventListener('keydown', function (e) {
            var open = customSelect.classList.contains('open');
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                e.preventDefault();
                if (!open) openListbox();
                else setActiveOption(activeIndex + 1);
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                e.preventDefault();
                if (!open) openListbox();
                else setActiveOption(activeIndex - 1);
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (!open) openListbox();
                else commitActive();
            } else if (e.key === 'Escape') {
                if (open) {
                    e.preventDefault();
                    closeListbox();
                    trigger.focus();
                }
            } else if (e.key === 'Home') {
                e.preventDefault();
                setActiveOption(0);
            } else if (e.key === 'End') {
                e.preventDefault();
                setActiveOption(optionEls.length - 1);
            }
        });
    });

    // Close when clicking outside
    document.addEventListener('click', function (e) {
        if (!e.target.closest('.custom-select-wrapper')) {
            document.querySelectorAll('.custom-select').forEach(function (el) {
                el.classList.remove('open');
                var trig = el.querySelector('.custom-select-trigger');
                if (trig) trig.setAttribute('aria-expanded', 'false');
            });
        }
    });
}
