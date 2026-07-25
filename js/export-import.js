/**
 * Timesheet Extension - Export/Import Functions
 */

function previewData() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.xdts';

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
                } else if (file.name.toLowerCase().endsWith('.xdts')) {
                    importObj = parseXdtsToTimesheetImport(content);
                    if (!importObj) {
                        updateStatus('Invalid XDTS format');
                        return;
                    }
                } else {
                    updateStatus('Unsupported file format');
                    return;
                }

                importObj.fileName = file.name;
                window.previewImportData = importObj;
                buildPreviewTable(importObj);
                document.getElementById('previewModal').classList.add('open');
                updateStatus('Preview loaded: ' + file.name);

            } catch (err) {
                updateStatus('Error: ' + err.message);
            }
        };
        reader.readAsText(file);
    };

    input.click();
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
        th.textContent = layerNames[col] || String.fromCharCode(65 + col);
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
    var data = window.previewImportData;
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
    var passNum = window.previewPassNumber || 1;

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

    csInterface.evalScript('getSelectedLayersInfo()', function (result) {
        try {
            var info = JSON.parse(result);
            if (info.error) {
                updateStatus('Error: ' + info.error);
                return;
            }

            var layers = info.layers;
            if (!layers || layers.length === 0) {
                updateStatus('Error: No layers selected');
                return;
            }

            var layersCleared = 0;

            layers.forEach(function (layer) {
                csInterface.evalScript('clearAllTimeRemapKeyframes(' + layer.index + ',"' + layer.name + '")', function () {
                    layersCleared++;
                    if (layersCleared === layers.length) {
                        addAllKeyframes();
                    }
                });
            });

            function addAllKeyframes() {
                var totalToAdd = layers.length * keyframes.length;
                var keyframesAdded = 0;

                layers.forEach(function (layer) {
                    keyframes.forEach(function (kf) {
                        var scriptCall = 'addTimeRemapKeyframe_Import(' + layer.index + ',"' + layer.name + '", ' + kf.frame + ', ' + kf.value + ', "' + keyframeType + '", ' + fps + ')';
                        csInterface.evalScript(scriptCall, function () {
                            keyframesAdded++;
                            if (keyframesAdded === totalToAdd) {
                                cleanupFirstKeyframes();
                            }
                        });
                    });
                });
            }

            function cleanupFirstKeyframes() {
                var layersCleaned = 0;
                layers.forEach(function (layer) {
                    csInterface.evalScript(
                        'removeFirstKeyframeIfNeeded(' + layer.index + ',"' + layer.name + '", ' + firstFrame + ', ' + fps + ')',
                        function () {
                            layersCleaned++;
                            if (layersCleaned === layers.length) {
                                trimLayerDurations();
                            }
                        }
                    );
                });
            }

            function trimLayerDurations() {
                var endMarkers = data.endMarkers || {};
                var hasEndMarkers = Object.keys(endMarkers).length > 0;
                var layersTrimmed = 0;

                if (!hasEndMarkers) {
                    onAllComplete();
                    return;
                }

                layers.forEach(function (layer) {
                    var endFrame = endMarkers[String(colIndex)] || 0;
                    var maxFrame = data.duration || 0;
                    csInterface.evalScript(
                        'trimLayerDuration(' + layer.index + ',"' + layer.name + '", ' + endFrame + ', ' + maxFrame + ', ' + fps + ')',
                        function () {
                            layersTrimmed++;
                            if (layersTrimmed === layers.length) {
                                onAllComplete();
                            }
                        }
                    );
                });
            }

            function onAllComplete() {
                if (passNum === 1) {
                    window.previewPassNumber = 2;
                    updateStatus('Pass 1 complete, applying pass 2...');
                    setTimeout(function () {
                        addPreviewKeyframes(colIndex);
                    }, 500);
                } else {
                    window.previewPassNumber = null;
                    updateStatus('Added ' + keyframes.length + ' keyframes to ' + layers.length + ' layers (2 passes completed)');
                }
            }

        } catch (e) {
            updateStatus('Error: ' + e.message);
        }
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
     * Sort by frame number to ensure timeline order
     * Re-index values to be sequential (1, 2, 3...)
 */
function convertToTimelineOrder(layersData) {
    var convertedData = {};

    // Iterate through columns (layers)
    Object.keys(layersData).forEach(function (layerIndex) {
        var layerData = layersData[layerIndex];
        var convertedLayerData = {};

        // Create array of [frame, value] pairs
        var frameValuePairs = [];
        Object.keys(layerData).forEach(function (frame) {
            var value = layerData[frame];
            if (value && value.trim()) {
                frameValuePairs.push({
                    frame: parseInt(frame),
                    value: value
                });
            }
        });

        // Sort by frame number
        frameValuePairs.sort(function (a, b) {
            return a.frame - b.frame;
        });

        // Initialize values mapping (For Re-indexing logic)
        var valueMapping = {};

        // Re-index logic (Toggle check)
        var shouldReindex = document.getElementById('reindexToggle') ? document.getElementById('reindexToggle').checked : true;

        var nextNumber = 1;

        frameValuePairs.forEach(function (pair) {
            var originalValue = pair.value;

            if (shouldReindex) {
                // Original Behavior: Re-index 1, 2, 3...
                if (!valueMapping[originalValue]) {
                    valueMapping[originalValue] = String(nextNumber);
                    nextNumber++;
                }
            } else {
                // Old Behavior: Keep original value
                valueMapping[originalValue] = originalValue;
            }
        });

        // Apply mapped values
        frameValuePairs.forEach(function (pair) {
            var newValue = valueMapping[pair.value];
            convertedLayerData[String(pair.frame)] = newValue;
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
        console.error('CSV parsing error:', e);
        return null;
    }
}

// Add keyframe for IMPORT (uses addTimeRemapKeyframe_Import in hostscript)
function addKeyframe_Import(layerIndex, layerName, frame, value) {
    var keyframeType = document.getElementById('keyframeType').value;
    var scriptCall = 'addTimeRemapKeyframe_Import(' + layerIndex + ',"' + layerName + '", ' + frame + ', ' +
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

    compInfo.layers.forEach(function (layer, i) {
        csInterface.evalScript('clearAllTimeRemapKeyframes(' + layer.index + ',"' + layer.name + '")', function () {
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
            var layerData = currentData[index];
            if (layerData) {
                var frames = Object.keys(layerData).map(function (f) { return parseInt(f); }).sort(function (a, b) { return a - b; });
                if (frames.length > 0) {
                    firstFramePerLayer[layer.name] = frames[0];
                }
                Object.keys(layerData).forEach(function (frame) {
                    var value = layerData[frame];
                    addKeyframe_Import(layer.index, layer.name, parseInt(frame), value);
                    totalKeyframes++;
                });
            }
        });

        var layersCleanedUp = 0;
        compInfo.layers.forEach(function (layer) {
            var firstFrame = firstFramePerLayer[layer.name] || 1;
            csInterface.evalScript(
                'removeFirstKeyframeIfNeeded(' + layer.index + ',"' + layer.name + '", ' + firstFrame + ', ' + fps + ')',
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
                    'trimLayerDuration(' + layer.index + ',"' + layer.name + '", ' + endFrame + ', ' + maxFrame + ', ' + fps + ')',
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
                if (val === 'SYMBOL_HYPHEN') continue;
                if (/^\d+$/.test(val)) layersData[colKey][String(frame)] = val;
            }
        }

        return {
            data: layersData,
            endMarkers: endMarkerPerColumn,
            duration: duration,
            frameInterval: 6,
            keyframeType: 'hold',
            layerNames: cellNames
        };
    } catch (e) { return null; }
}

function parseJSONWithMarkers(importObj) {
    var cleanData = {};
    var endMarkers = importObj.endMarkers || {};

    Object.keys(importObj.data).forEach(function (layerIndex) {
        var layerData = importObj.data[layerIndex];
        cleanData[layerIndex] = {};

        Object.keys(layerData).forEach(function (frame) {
            var value = layerData[frame];
            var valueStr = String(value);

            if (valueStr === "\ufffd" || valueStr === "\uFFFD" || valueStr.indexOf('\ufffd') !== -1 || valueStr.indexOf('\uFFFD') !== -1) {
                endMarkers[String(layerIndex)] = parseInt(frame);
            } else {
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
    input.accept = '.json,.csv,.xdts';

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
                } else if (file.name.toLowerCase().endsWith('.xdts')) {
                    importObj = parseXdtsToTimesheetImport(content);
                    if (!importObj) {
                        updateStatus('Invalid XDTS format');
                        return;
                    }
                } else {
                    var rawJSON = JSON.parse(content);
                    if (!rawJSON || !rawJSON.data) {
                        updateStatus('Invalid JSON format');
                        return;
                    }
                    // Parse JSON and extract end markers
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
