/**
 * Timesheet Extension - Export/Import Functions
 */

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
                    else if (f === Math.round(layer.outPoint * fps) + 1) val = "�";
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

                // Add end marker �
                var marker = Math.round(layer.outPoint * fps) + 1;
                if (processed[marker] === undefined) processed[marker] = "�";

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
            return value.indexOf('�') !== -1 ||
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

// Parse JSON and extract � markers into endMarkers
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
            if (valueStr === "�" || valueStr === "�" || valueStr.indexOf('�') !== -1 || valueStr.indexOf('�') !== -1) {
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
                    // Parse JSON and extract � markers
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