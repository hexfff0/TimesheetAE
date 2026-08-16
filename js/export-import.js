/**
 * Timesheet Extension - Export/Import Functions
 */

/**
 * Parse an imported file (.csv or .xdts) into the timesheet import object.
 * Returns { importObj } on success or { error } with a user-facing message.
 * Shared by the Preview and Import paths so format detection is defined once.
 */
function parseImportFile(fileName, content) {
    if (fileName.toLowerCase().endsWith('.csv')) {
        var csv = parseCSVToTimesheet_Import(content, fileName);
        return csv ? { importObj: csv } : { error: 'Invalid CSV format' };
    }
    if (fileName.toLowerCase().endsWith('.xdts')) {
        var xdts = parseXdtsToTimesheetImport(content);
        return xdts ? { importObj: xdts } : { error: 'Invalid XDTS format' };
    }
    return { error: 'Unsupported file format' };
}

function previewData() {
    readLocalFile('.csv,.xdts', function (fileName, content) {
        try {
            var parsed = parseImportFile(fileName, content);
            if (parsed.error) {
                updateStatus(parsed.error);
                return;
            }

            var importObj = parsed.importObj;
            importObj.fileName = fileName;
            previewImportData = importObj;
            buildPreviewTable(importObj);
            document.getElementById('previewModal').classList.add('open');
            updateStatus('Preview loaded: ' + fileName);

        } catch (err) {
            updateStatus('Error: ' + err.message);
        }
    });
}

function buildPreviewTable(data) {
    var headerRow = document.getElementById('previewHeaderRow');
    var tableBody = document.getElementById('previewTableBody');

    document.getElementById('previewFileName').textContent = data.fileName || data.compName || '';

    headerRow.innerHTML = '<th>Frame</th>';
    tableBody.innerHTML = '';

    var numColumns = Object.keys(data.data).length;
    var layerNames = data.layerNames || [];

    // Find max frame from data
    var maxFrame = 0;
    Object.keys(data.data).forEach(function (layerIndex) {
        Object.keys(data.data[layerIndex]).forEach(function (frame) {
            var f = parseInt(frame);
            if (f > maxFrame) maxFrame = f;
        });
    });
    if (maxFrame < (data.duration || 0)) maxFrame = data.duration;

    // Build headers
    for (var col = 0; col < numColumns; col++) {
        var th = document.createElement('th');
        th.textContent = layerNames[col] || columnLabel(col);
        th.title = layerNames[col] || '';
        headerRow.appendChild(th);
    }

    // Build rows
    for (var frame = 1; frame <= maxFrame; frame++) {
        var tr = document.createElement('tr');

        var tdFrame = document.createElement('td');
        tdFrame.classList.add('frame-label');
        tdFrame.textContent = frame;
        tr.appendChild(tdFrame);

        for (var col = 0; col < numColumns; col++) {
            var td = document.createElement('td');
            td.classList.add('data-cell');
            var input = document.createElement('input');
            input.type = 'text';
            input.readOnly = true;
            var layerData = data.data[String(col)];
            if (layerData && layerData[String(frame)] !== undefined) {
                input.value = layerData[String(frame)];
            }
            td.appendChild(input);
            tr.appendChild(td);
        }

        tableBody.appendChild(tr);
    }

    document.getElementById('previewInfo').textContent = 'Frames: ' + maxFrame + ' | Columns: ' + numColumns;
}

function addPreviewKeyframes(colIndex) {
    var data = previewImportData;
    if (!data || !data.data) {
        updateStatus('Error: No preview data');
        return;
    }

    var layerData = data.data[String(colIndex)];
    if (!layerData) {
        updateStatus('Error: No data for column');
        return;
    }

    var fps = data.fps || 24;
    var keyframeType = data.keyframeType || 'hold';
    var passNum = previewPassNumber || 1;

    var keyframes = [];
    var frames = Object.keys(layerData).map(function (f) { return parseInt(f); }).sort(function (a, b) { return a - b; });

    frames.forEach(function (frame) {
        var value = parseFloat(layerData[String(frame)]);
        if (!isNaN(value)) {
            keyframes.push({ frame: frame, value: value });
        }
    });

    if (keyframes.length === 0) {
        updateStatus('Error: No keyframes to add');
        return;
    }

    var firstFrame = keyframes[0].frame;

    updateStatus('Getting selected layers...');

    evalHost('getSelectedLayersInfo', [], function (result) {
        var info;
        try {
            info = JSON.parse(result);
        } catch (e) {
            updateStatus('Error: could not read selection (' + result + ')');
            return;
        }
        if (info.error) {
            updateStatus('Error: ' + info.error);
            return;
        }

        var layers = info.layers;
        if (!layers || layers.length === 0) {
            updateStatus('Error: No layers selected');
            return;
        }

        var firstFramePerLayer = {};
        layers.forEach(function (layer, i) {
            firstFramePerLayer[i] = firstFrame;
        });

        clearLayersForImport(layers, function () {
            var allKeyframes = [];
            keyframes.forEach(function (kf) {
                layers.forEach(function (layer) {
                    allKeyframes.push({ index: layer.index, name: layer.name, frame: kf.frame, value: kf.value });
                });
            });
            addKeyframesBatched(allKeyframes, keyframeType, fps, function () {
                finalizeImport(layers, firstFramePerLayer, fps, data.endMarkers || {}, data.duration || 0, function () {
                    // Original preview behaviour: the clicked column's end marker
                    // applies to every selected layer.
                    return (data.endMarkers || {})[String(colIndex)] || 0;
                }, function () {
                    if (passNum === 1) {
                        previewPassNumber = 2;
                        updateStatus('Pass 1 complete, applying pass 2...');
                        setTimeout(function () {
                            addPreviewKeyframes(colIndex);
                        }, 500);
                    } else {
                        previewPassNumber = null;
                        updateStatus('Added ' + keyframes.length + ' keyframes to ' + layers.length + ' layers (2 passes completed)');
                    }
                });
            });
        });
    });
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

/**
 * Whether the "Re-index" toggle is checked (defaults to off when absent).
 */
function isReindexOn() {
    return document.getElementById('reindexToggle') ? document.getElementById('reindexToggle').checked : false;
}

/**
 * Sort by frame number to ensure timeline order, then re-index values with the
 * range-fill algorithm.
 *
 * Re-index ON (toggle checked):
 *   - The smallest numeric value keeps its original number as its anchor; every
 *     later value anchors just past the last dot cell that preceded its first
 *     frame (i.e. it continues the count exactly where the previous segment's
 *     dots ended). Segments therefore never overlap.
 *   - A "dot" is any non-numeric, non-empty cell (".", "-", "A", "ca", ...). It
 *     emits the previous output value + 1, turning gaps into filled keyframes.
 *   - Empty cells are left untouched (no value is filled in).
 *
 * Examples:
 *   2 . . . 1 . . . 2 . . . 1  ->  5 6 7 8 1 2 3 4 5 6 7 8 1
 *   3 . . 1 .                   ->  3 4 5 1 2
 *
 * Re-index OFF: original values are kept verbatim (identity mapping).
 */
function convertToTimelineOrder(layersData) {
    var convertedData = {};

    // Re-index logic (Toggle check)
    var shouldReindex = isReindexOn();
    if (!shouldReindex) {
        Object.keys(layersData).forEach(function (layerIndex) {
            var layerData = layersData[layerIndex];
            var copy = {};
            Object.keys(layerData).forEach(function (frame) {
                copy[frame] = layerData[frame];
            });
            convertedData[layerIndex] = copy;
        });
        return convertedData;
    }

    // Iterate through columns (layers)
    Object.keys(layersData).forEach(function (layerIndex) {
        var layerData = layersData[layerIndex];

        function isNumeric(value) {
            return !isNaN(parseFloat(value)) && isFinite(value);
        }
        function isCellNumeric(cell) {
            return isNumeric(cell.value);
        }

        // Gather cells in frame order. Only frames that are present in the data
        // are visited; empty frames stay empty in the output (no filling).
        var cells = [];
        Object.keys(layerData).forEach(function (frame) {
            var value = layerData[frame];
            if (value && String(value).trim() !== '') {
                cells.push({ frame: parseInt(frame), value: String(value).trim() });
            }
        });
        cells.sort(function (a, b) { return a.frame - b.frame; });

        // Distinct numeric values, ascending by numeric value
        var numericValues = [];
        cells.forEach(function (cell) {
            if (isCellNumeric(cell) && numericValues.indexOf(cell.value) === -1) {
                numericValues.push(cell.value);
            }
        });
        numericValues.sort(function (a, b) { return parseFloat(a) - parseFloat(b); });

        // Assign anchors in ascending numeric order. The smallest value keeps its
        // original number. Each next value continues just past the highest number
        // emitted so far (max(its own value, prevTop + 1)), so segments never
        // overlap a smaller value's filled dots.
        var anchors = {};
        var prevTop = 0;
        for (var n = 0; n < numericValues.length; n++) {
            var val = numericValues[n];
            var anchorNum = Math.max(parseFloat(val), prevTop + 1);
            anchors[val] = anchorNum;

            // Highest number this value's dots reach: for each occurrence of the
            // value, the dots that follow it (until the next numeric cell) extend
            // the count from the anchor.
            var vTop = anchorNum;
            for (var i = 0; i < cells.length; i++) {
                if (cells[i].value !== val) continue;
                var j = i + 1;
                while (j < cells.length && !isCellNumeric(cells[j])) { j++; }
                var dots = j - i - 1;
                if (anchorNum + dots > vTop) vTop = anchorNum + dots;
            }
            if (vTop > prevTop) prevTop = vTop;
        }

        // Walk left-to-right: a numeric cell emits its anchor (re-anchoring on
        // every occurrence), a dot emits the previous output value + 1.
        var convertedLayerData = {};
        var cur = 0;
        cells.forEach(function (cell) {
            var out = isCellNumeric(cell) ? anchors[cell.value] : (cur + 1);
            convertedLayerData[String(cell.frame)] = String(out);
            cur = out;
        });

        convertedData[layerIndex] = convertedLayerData;
    });

    return convertedData;
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
            return value.indexOf('\ufffd') !== -1 ||
                value.indexOf('\uFFFD') !== -1 ||
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

        // Sort by frame number to ensure timeline order
        var convertedLayersData = convertToTimelineOrder(layersData);

        return {
            version: '1.2',
            compName: filename.replace('.csv', ''),
            fps: 24,
            duration: maxFrame,
            frameInterval: 6,
            keyframeType: 'hold',
            data: convertedLayersData,
            endMarkers: endMarkerPerColumn
        };
    } catch (e) {
        updateStatus('Error: CSV parsing failed');
        console.error('CSV parsing error:', e);
        return null;
    }
}

function applyAllKeyframes_Import() {
    if (!compInfo || !currentData) return;

    var layers = compInfo.layers;
    var endMarkers = importedEndMarkers;
    var maxFrame = importedMaxFrame || Math.ceil(compInfo.duration);
    var fps = compInfo.fps || 24;

    clearLayersForImport(layers, function () {
        var firstFramePerLayer = {};
        var calls = [];
        layers.forEach(function (layer, index) {
            var layerData = currentData[index];
            if (!layerData) return;
            var frames = Object.keys(layerData).map(function (f) { return parseInt(f); }).sort(function (a, b) { return a - b; });
            if (frames.length > 0) {
                firstFramePerLayer[index] = frames[0];
            }
            frames.forEach(function (frame) {
                calls.push({ index: layer.index, name: layer.name, frame: frame, value: layerData[frame] });
            });
        });

        var totalKeyframes = calls.length;
        addKeyframesBatched(calls, keyframeTypeForImport(), fps, function () {
            finalizeImport(layers, firstFramePerLayer, fps, endMarkers, maxFrame, function (index) {
                // Original import behaviour: end markers are keyed by layer index.
                return endMarkers[String(index)] || 0;
            }, function () {
                if (isImportInProgress && importPassNumber === 1) {
                    importPassNumber = 2;
                    setTimeout(function () {
                        applyAllKeyframes_Import();
                    }, 500);
                } else {
                    importedEndMarkers = {};
                    importedMaxFrame = 0;
                    isImportInProgress = false;
                    importPassNumber = 0;
                    updateStatus(totalKeyframes + ' keyframes imported (2 passes completed)');
                }
                syncLayers();
            });
        });
    });
}

function keyframeTypeForImport() {
    var el = document.getElementById('keyframeType');
    return el ? el.value : 'hold';
}

function parseXdtsToTimesheetImport(content) {
    try {
        var jsonStart = content.indexOf('{');
        if (jsonStart > 0) content = content.slice(jsonStart);
        var xdts = JSON.parse(content);
        var timeTable = (xdts.timeTables || [])[0];
        if (!timeTable) return null;
        var duration = timeTable.duration || 72;

        var headers = timeTable.timeTableHeaders || [];
        var fields = timeTable.fields || [];
        var cellField = null;
        var cellNames = [];
        for (var i = 0; i < fields.length; i++) {
            if (fields[i].fieldId === 0) { cellField = fields[i]; break; }
        }
        for (var j = 0; j < headers.length; j++) {
            if (headers[j].fieldId === 0) { cellNames = headers[j].names || []; break; }
        }
        if (!cellField) return null;

        var tracks = cellField.tracks || [];
        var layersData = {};
        var endMarkerPerColumn = {};

        for (var t = 0; t < tracks.length; t++) {
            var track = tracks[t];
            var colKey = String(t);
            layersData[colKey] = {};
            var frames = track.frames || [];

            for (var k = 0; k < frames.length; k++) {
                var fd = frames[k];
                var frame = (Math.round(Number(fd.frame) || 0)) + 1;
                var dataArr = fd.data || [];
                var values = (dataArr[0] && dataArr[0].values) || [];
                var val = String(values[0] || '').trim();
                if (val === 'SYMBOL_NULL_CELL') {
                    endMarkerPerColumn[colKey] = frame;
                    continue;
                }
                // SYMBOL_HYPHEN is a "dot": when re-indexing is on it is turned
                // into a filled keyframe by convertToTimelineOrder, otherwise it
                // translates to a non-numeric placeholder that is skipped.
                if (val === 'SYMBOL_HYPHEN') {
                    layersData[colKey][String(frame)] = val;
                    continue;
                }
                if (/^\d+$/.test(val)) layersData[colKey][String(frame)] = val;
            }
        }

        // Re-index (smallest-first anchors, dots filled) applies here too; when
        // the toggle is off convertToTimelineOrder returns the data untouched.
        var convertedLayersData = convertToTimelineOrder(layersData);

        return {
            data: convertedLayersData,
            endMarkers: endMarkerPerColumn,
            duration: duration,
            frameInterval: 6,
            keyframeType: 'hold',
            layerNames: cellNames
        };
    } catch (e) { return null; }
}

/**
 * Shared import pipeline helpers.
 *
 * All three run a host call per layer and invoke the callback after every
 * layer has completed. The two-pass import (preview + plain import) uses these
 * so the clear → add → cleanup → trim sequence is defined once.
 */

function clearLayersForImport(layers, onDone) {
    var pending = 0;
    layers.forEach(function (layer) {
        pending++;
        evalHost('clearAllTimeRemapKeyframes', [layer.index, layer.name], function () {
            if (--pending === 0) onDone();
        });
    });
    if (pending === 0) onDone();
}

function addKeyframesBatched(calls, keyframeType, fps, onDone) {
    if (!calls.length) { onDone(); return; }
    var remaining = calls.length;
    calls.forEach(function (c) {
        evalHost('addTimeRemapKeyframe_Import', [c.index, c.name, c.frame, c.value, keyframeType, fps], function () {
            if (--remaining === 0) onDone();
        });
    });
}

function removeFirstKeyframes(layers, firstFramePerLayer, fps, onDone) {
    var pending = 0;
    // firstFramePerLayer is keyed by the layer's array index (not name), so
    // duplicate layer names cannot collide and clear the wrong layer.
    layers.forEach(function (layer, index) {
        pending++;
        evalHost('removeFirstKeyframeIfNeeded', [layer.index, layer.name, firstFramePerLayer[index] || 1, fps], function () {
            if (--pending === 0) onDone();
        });
    });
    if (pending === 0) onDone();
}

/**
 * @param {function(number):number} endFrameFor  maps a layer array index to the
 *   end frame to trim to (must preserve each caller's original marker lookup).
 */
function finalizeImport(layers, firstFramePerLayer, fps, endMarkers, maxFrame, endFrameFor, onDone) {
    removeFirstKeyframes(layers, firstFramePerLayer, fps, function () {
        var hasEndMarkers = Object.keys(endMarkers).length > 0;
        if (!hasEndMarkers) { onDone(); return; }
        var pending = 0;
        layers.forEach(function (layer, index) {
            pending++;
            evalHost('trimLayerDuration', [layer.index, layer.name, endFrameFor(index) || 0, maxFrame, fps], function () {
                if (--pending === 0) onDone();
            });
        });
        if (pending === 0) onDone();
    });
}

function importData() {
    syncLayers();

    readLocalFile('.csv,.xdts', function (fileName, content) {
        try {
            var parsed = parseImportFile(fileName, content);
            if (parsed.error) {
                updateStatus(parsed.error);
                return;
            }
            var importObj = parsed.importObj;

            currentData = importObj.data;
            importedEndMarkers = importObj.endMarkers || {};
            importedMaxFrame = importObj.duration || 0;
            isImportInProgress = true;
            importPassNumber = 1;  // Start with pass 1

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
            isImportInProgress = false;
        }
    });
}
