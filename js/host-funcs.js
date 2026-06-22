var HOST_FUNCS = `
if(typeof JSON==='undefined')JSON={};if(typeof JSON.parse==='undefined')JSON.parse=function(s){return eval('('+s+')')};if(typeof JSON.stringify==='undefined')JSON.stringify=function(o){if(o===null||o===undefined)return'null';if(typeof o==='string')return'"'+o.replace(/"/g,'\\"')+'"';if(typeof o==='number'||typeof o==='boolean')return o.toString();if(o instanceof Array){var a=[];for(var i=0;i<o.length;i++)a.push(JSON.stringify(o[i]));return'['+a.join(',')+']'}var p=[];for(var k in o){if(o.hasOwnProperty(k)){var v=o[k];if(typeof v!=='function'&&typeof v!=='undefined')p.push('"'+k+'":'+JSON.stringify(v))}}return'{'+p.join(',')+'}'};
/**
 * Timesheet Extension - Host Script
 */

// Get information about selected layers
function getSelectedLayersInfo() {
    try {
        var comp = app.project.activeItem;

        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ error: "No active composition" });
        }

        var selectedLayers = comp.selectedLayers;

        if (selectedLayers.length === 0) {
            return JSON.stringify({ error: "No layers selected" });
        }

        // Sort layers by index (bottom to top)
        var sortedLayers = [];
        for (var i = 0; i < selectedLayers.length; i++) {
            sortedLayers.push(selectedLayers[i]);
        }

        sortedLayers.sort(function (a, b) {
            return b.index - a.index; // Reverse sort (bottom first)
        });

        var layersInfo = [];
        for (var i = 0; i < sortedLayers.length; i++) {
            var layer = sortedLayers[i];
            layersInfo.push({
                name: layer.name,
                index: layer.index,
                inPoint: layer.inPoint,
                outPoint: layer.outPoint,
                hasTimeRemap: layer.timeRemapEnabled
            });
        }

        var result = {
            compName: comp.name,
            fps: comp.frameRate,
            duration: comp.duration * comp.frameRate, // Total frames
            layers: layersInfo
        };

        return JSON.stringify(result);

    } catch (e) {
        return JSON.stringify({ error: e.toString() });
    }
}

// Add or update time remap keyframe
function addTimeRemapKeyframe(layerName, frame, value, keyframeType, compFps) {
    try {
        app.beginUndoGroup("Add Time Remap Keyframe");

        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return "Error: No active composition";
        }

        // Find layer by name
        var layer = null;
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).name === layerName) {
                layer = comp.layer(i);
                break;
            }
        }

        if (!layer) {
            return "Error: Layer not found - " + layerName;
        }

        // Enable time remapping if not already enabled
        var justEnabled = false;
        if (!layer.timeRemapEnabled) {
            layer.timeRemapEnabled = true;
            justEnabled = true;
        }

        var timeRemapProp = layer.property("ADBE Time Remapping");

        if (!timeRemapProp) {
            return "Error: Cannot access time remap property";
        }

        // ONLY when first enabling: Keep the first keyframe, remove the second
        // AE creates 2 keyframes when enabling time remap (start and end)
        // We keep the first one to prevent auto-disable
        if (justEnabled && timeRemapProp.numKeys >= 2) {
            for (var k = timeRemapProp.numKeys; k >= 2; k--) {
                timeRemapProp.removeKey(k);
            }

            // Set first keyframe to Hold interpolation
            if (keyframeType === "hold") {
                timeRemapProp.setInterpolationTypeAtKey(1,
                    KeyframeInterpolationType.LINEAR,
                    KeyframeInterpolationType.HOLD);
            }
        }

        // Convert frame to time in comp timeline
        var compTime = frame / compFps;

        // Get source layer info to handle FPS conversion
        var sourceItem = layer.source;
        var sourceFps = compFps; // Default to comp fps

        if (sourceItem && sourceItem instanceof FootageItem) {
            sourceFps = sourceItem.mainSource.conformFrameRate || compFps;
        } else if (sourceItem && sourceItem instanceof CompItem) {
            sourceFps = sourceItem.frameRate;
        }

        // Convert value (source frame number) to time in source timeline
        // Value is 1-based (user enters 1, 2, 3...), so convert to 0-based for AE
        // Then convert to time: (value - 1) / sourceFps
        var sourceTime = (value - 1) / sourceFps;

        // Use setValueAtTime to create or update keyframe
        // This method is more reliable than addKey as it automatically handles duplicates
        timeRemapProp.setValueAtTime(compTime, sourceTime);

        // Find the keyframe we just created/updated to set interpolation
        var keyIndex = -1;
        for (var i = 1; i <= timeRemapProp.numKeys; i++) {
            var keyTime = timeRemapProp.keyTime(i);
            if (Math.abs(keyTime - compTime) < 0.001) { // Within 1ms
                keyIndex = i;
                break;
            }
        }

        // Set interpolation type
        if (keyIndex !== -1) {
            if (keyframeType === "hold") {
                timeRemapProp.setInterpolationTypeAtKey(keyIndex,
                    KeyframeInterpolationType.LINEAR,
                    KeyframeInterpolationType.HOLD);
            } else {
                timeRemapProp.setInterpolationTypeAtKey(keyIndex,
                    KeyframeInterpolationType.LINEAR,
                    KeyframeInterpolationType.LINEAR);
            }
        }

        app.endUndoGroup();
        return "true";

    } catch (e) {
        app.endUndoGroup();
        return "Error: " + e.toString();
    }
}

// Delete time remap keyframe
function deleteTimeRemapKeyframe(layerName, frame) {
    try {
        app.beginUndoGroup("Delete Time Remap Keyframe");

        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return "Error: No active composition";
        }

        // Find layer
        var layer = null;
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).name === layerName) {
                layer = comp.layer(i);
                break;
            }
        }

        if (!layer || !layer.timeRemapEnabled) {
            return "Error: Layer not found or time remap not enabled";
        }

        var timeRemapProp = layer.property("ADBE Time Remapping");
        var compFps = comp.frameRate;
        var compTime = frame / compFps;

        // Find and delete keyframe
        for (var i = 1; i <= timeRemapProp.numKeys; i++) {
            var keyTime = timeRemapProp.keyTime(i);
            if (Math.abs(keyTime - compTime) < 0.001) {
                timeRemapProp.removeKey(i);
                break;
            }
        }

        app.endUndoGroup();
        return "true";

    } catch (e) {
        app.endUndoGroup();
        return "Error: " + e.toString();
    }
}

// Read existing time remap keyframes
function readTimeRemapKeyframes(layerName) {
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ error: "No active composition" });
        }

        var layer = null;
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).name === layerName) {
                layer = comp.layer(i);
                break;
            }
        }

        if (!layer || !layer.timeRemapEnabled) {
            return JSON.stringify({ keyframes: [] });
        }

        var timeRemapProp = layer.property("ADBE Time Remapping");
        var keyframes = [];
        var compFps = comp.frameRate;

        // Get source fps
        var sourceItem = layer.source;
        var sourceFps = compFps;

        if (sourceItem && sourceItem instanceof FootageItem) {
            sourceFps = sourceItem.mainSource.conformFrameRate || compFps;
        } else if (sourceItem && sourceItem instanceof CompItem) {
            sourceFps = sourceItem.frameRate;
        }

        for (var i = 1; i <= timeRemapProp.numKeys; i++) {
            var keyTime = timeRemapProp.keyTime(i);
            var keyValue = timeRemapProp.keyValue(i);

            // Convert times to frames
            var compFrame = Math.round(keyTime * compFps);
            // Convert source time to 1-based frame number
            var sourceFrame = Math.round(keyValue * sourceFps) + 1;

            keyframes.push({
                frame: compFrame,
                value: sourceFrame,
                time: keyTime
            });
        }

        return JSON.stringify({ keyframes: keyframes });

    } catch (e) {
        return JSON.stringify({ error: e.toString() });
    }
}

// Clear all time remap keyframes for a layer (for import)
function clearAllTimeRemapKeyframes(layerName) {
    try {
        app.beginUndoGroup("Clear Time Remap Keyframes");

        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return "Error: No active composition";
        }

        var layer = null;
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).name === layerName) {
                layer = comp.layer(i);
                break;
            }
        }

        if (!layer) {
            return "Error: Layer not found - " + layerName;
        }

        // If time remap is enabled, remove all keyframes EXCEPT the first one
        // This prevents time remap from auto-disabling
        if (layer.timeRemapEnabled) {
            var timeRemapProp = layer.property("ADBE Time Remapping");

            if (timeRemapProp && timeRemapProp.numKeys >= 2) {
                // Remove from last to second (keep first)
                for (var k = timeRemapProp.numKeys; k >= 2; k--) {
                    timeRemapProp.removeKey(k);
                }
            }
        }

        app.endUndoGroup();
        return "true";

    } catch (e) {
        app.endUndoGroup();
        return "Error: " + e.toString();
    }
}

// Add keyframe for IMPORT ONLY (1-based frame)
function addTimeRemapKeyframe_Import(layerName, frame, value, keyframeType, compFps) {
    try {
        app.beginUndoGroup("Add Time Remap Keyframe Import");

        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return "Error: No active composition";
        }

        var layer = null;
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).name === layerName) {
                layer = comp.layer(i);
                break;
            }
        }

        if (!layer) {
            return "Error: Layer not found - " + layerName;
        }

        var justEnabled = false;
        if (!layer.timeRemapEnabled) {
            layer.timeRemapEnabled = true;
            justEnabled = true;
        }

        var timeRemapProp = layer.property("ADBE Time Remapping");
        if (!timeRemapProp) {
            return "Error: Cannot access time remap property";
        }

        if (justEnabled && timeRemapProp.numKeys >= 2) {
            timeRemapProp.removeKey(2);
        }

        // Convert 1-based frame to time
        var compTime = (frame - 1) / compFps;

        var sourceItem = layer.source;
        var sourceFps = compFps;
        if (sourceItem && sourceItem instanceof FootageItem) {
            sourceFps = sourceItem.mainSource.conformFrameRate || compFps;
        } else if (sourceItem && sourceItem instanceof CompItem) {
            sourceFps = sourceItem.frameRate;
        }

        var sourceTime = (value - 1) / sourceFps;
        timeRemapProp.setValueAtTime(compTime, sourceTime);

        var keyIndex = -1;
        for (var i = 1; i <= timeRemapProp.numKeys; i++) {
            var keyTime = timeRemapProp.keyTime(i);
            if (Math.abs(keyTime - compTime) < 0.001) {
                keyIndex = i;
                break;
            }
        }

        if (keyIndex !== -1) {
            if (keyframeType === "hold") {
                timeRemapProp.setInterpolationTypeAtKey(keyIndex,
                    KeyframeInterpolationType.LINEAR,
                    KeyframeInterpolationType.HOLD);
            } else {
                timeRemapProp.setInterpolationTypeAtKey(keyIndex,
                    KeyframeInterpolationType.LINEAR,
                    KeyframeInterpolationType.LINEAR);
            }
        }

        app.endUndoGroup();
        return "true";

    } catch (e) {
        app.endUndoGroup();
        return "Error: " + e.toString();
    }
}

// Remove first keyframe if CSV doesn't start at frame 1
function removeFirstKeyframeIfNeeded(layerName, firstFrameFromCSV, fps) {
    try {
        app.beginUndoGroup("Remove First Keyframe");

        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return "Error: No active composition";
        }

        var layer = null;
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).name === layerName) {
                layer = comp.layer(i);
                break;
            }
        }

        if (!layer || !layer.timeRemapEnabled) {
            return "true";
        }

        var timeRemapProp = layer.property("ADBE Time Remapping");

        if (firstFrameFromCSV > 1 && timeRemapProp && timeRemapProp.numKeys > 1) {
            for (var i = 1; i <= timeRemapProp.numKeys; i++) {
                var keyTime = timeRemapProp.keyTime(i);
                var keyFrame = Math.round(keyTime * fps) + 1;

                if (keyFrame === 1) {
                    timeRemapProp.removeKey(i);
                    break;
                }
            }
        }

        app.endUndoGroup();
        return "true";

    } catch (e) {
        app.endUndoGroup();
        return "Error: " + e.toString();
    }
}

// Trim layer duration
function trimLayerDuration(layerName, endFrame, maxFrame, fps) {
    try {
        app.beginUndoGroup("Trim Layer Duration");

        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return "Error: No active composition";
        }

        var layer = null;
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).name === layerName) {
                layer = comp.layer(i);
                break;
            }
        }

        if (!layer) {
            return "Error: Layer not found - " + layerName;
        }

        if (!layer.timeRemapEnabled) {
            return "Error: Time remap not enabled for " + layerName;
        }

        var timeRemapProp = layer.property("ADBE Time Remapping");
        var firstKeyframeTime = 999999;

        if (timeRemapProp && timeRemapProp.numKeys > 0) {
            for (var i = 1; i <= timeRemapProp.numKeys; i++) {
                var keyTime = timeRemapProp.keyTime(i);
                if (keyTime < firstKeyframeTime) {
                    firstKeyframeTime = keyTime;
                }
            }
        }

        if (firstKeyframeTime === 999999) {
            firstKeyframeTime = 0;
        }

        var endTime;
        if (endFrame && endFrame > 0) {
            endTime = (endFrame - 1) / fps;
        } else {
            endTime = comp.duration;
        }

        layer.outPoint = endTime;
        layer.inPoint = firstKeyframeTime;

        app.endUndoGroup();
        return "true";

    } catch (e) {
        app.endUndoGroup();
        return "Error: " + e.toString();
    }
}

/**
 * Triggers the "Remove All" logic by calling a confirmation dialog
 * inside After Effects (Native UI).
 */
function removeAllKeyframes() {
    // We call a function in hostscript that triggers the native AE dialog
    csInterface.evalScript('confirmAndDisableTimeRemap()', function (result) {
        if (result === "true") {
            // Success: Reset local data
            currentData = {};
            if (compInfo && compInfo.layers) {
                compInfo.layers.forEach(function (layer) {
                    currentData[layer.name] = {};
                });
            }
            rebuildTable();
            updateStatus('All Time Remap keyframes removed.');
        } else if (result === "cancelled") {
            // User clicked 'No'
            updateStatus('Operation cancelled.');
        } else {
            // Error occurred
            updateStatus('Error: ' + result);
        }
    });
}

// Delete time remap keyframe - IMPROVED to preserve markers
function deleteTimeRemapKeyframe(layerName, frame) {
    try {
        app.beginUndoGroup("Delete Time Remap Keyframe");

        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return "Error: No active composition";
        }

        // Find layer
        var layer = null;
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).name === layerName) {
                layer = comp.layer(i);
                break;
            }
        }

        if (!layer || !layer.timeRemapEnabled) {
            return "Error: Layer not found or time remap not enabled";
        }

        var timeRemapProp = layer.property("ADBE Time Remapping");
        var compFps = comp.frameRate;
        var compTime = frame / compFps;

        // Find keyframe to delete
        var keyIndexToDelete = -1;
        for (var i = 1; i <= timeRemapProp.numKeys; i++) {
            var keyTime = timeRemapProp.keyTime(i);
            if (Math.abs(keyTime - compTime) < 0.001) {
                keyIndexToDelete = i;
                break;
            }
        }

        if (keyIndexToDelete !== -1) {
            // Check if this would be the last keyframe
            if (timeRemapProp.numKeys === 1) {
                // Instead of disabling Time Remap, replace this keyframe with a temporary one
                // at a different location to keep Time Remap enabled
                var sourceItem = layer.source;
                var sourceFps = compFps;
                var sourceDuration = 1.0;

                if (sourceItem && sourceItem instanceof FootageItem) {
                    sourceFps = sourceItem.mainSource.conformFrameRate || compFps;
                    sourceDuration = sourceItem.duration;
                } else if (sourceItem && sourceItem instanceof CompItem) {
                    sourceFps = sourceItem.frameRate;
                    sourceDuration = sourceItem.duration;
                }

                var sourceFrameCount = Math.ceil(sourceDuration * sourceFps);

                // Create a temporary keyframe at a high frame to keep Time Remap enabled
                var tempCompTime = 100.0; // 100 seconds into comp
                var tempSourceFrame = sourceFrameCount + 1;
                var tempSourceTime = (tempSourceFrame - 1) / sourceFps;

                timeRemapProp.setValueAtTime(tempCompTime, tempSourceTime);

                // Now safe to delete the original keyframe (there's still the temp one)
                timeRemapProp.removeKey(keyIndexToDelete);
            } else {
                // Safe to delete - there are other keyframes
                timeRemapProp.removeKey(keyIndexToDelete);
            }
        }

        app.endUndoGroup();
        return "true";

    } catch (e) {
        app.endUndoGroup();
        return "Error: " + e.toString();
    }
}

// Clean up temporary keyframes (both markers and temp placeholders)
function cleanupTemporaryKeyframes(layerName, compFps) {
    try {
        app.beginUndoGroup("Cleanup Temporary Keyframes");

        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return "Error: No active composition";
        }

        var layer = null;
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).name === layerName) {
                layer = comp.layer(i);
                break;
            }
        }

        if (!layer || !layer.timeRemapEnabled) {
            app.endUndoGroup();
            return "true";
        }

        var timeRemapProp = layer.property("ADBE Time Remapping");
        var sourceItem = layer.source;
        var sourceFps = compFps;
        var sourceDuration = 1.0;

        if (sourceItem && sourceItem instanceof FootageItem) {
            sourceFps = sourceItem.mainSource.conformFrameRate || compFps;
            sourceDuration = sourceItem.duration;
        } else if (sourceItem && sourceItem instanceof CompItem) {
            sourceFps = sourceItem.frameRate;
            sourceDuration = sourceItem.duration;
        }

        var sourceFrameCount = Math.ceil(sourceDuration * sourceFps);
        var markerSourceFrame = sourceFrameCount + 1;
        var markerSourceTime = (markerSourceFrame - 1) / sourceFps;

        // Find and remove all keyframes that are markers or temps
        // Work backwards to avoid index issues
        for (var i = timeRemapProp.numKeys; i >= 1; i--) {
            var keyTime = timeRemapProp.keyTime(i);
            var keyValue = timeRemapProp.keyValue(i);
            var keyFrameNumber = Math.round(keyValue * sourceFps) + 1;

            // Check if this is a marker (value = sourceFrameCount + 1)
            var isMarker = (keyFrameNumber === markerSourceFrame);

            // Check if this is a temp placeholder (comp time > 50 seconds)
            var isTemp = (keyTime > 50.0);

            // Remove if it's a marker or temp, but keep at least 1 keyframe
            if ((isMarker || isTemp) && timeRemapProp.numKeys > 1) {
                timeRemapProp.removeKey(i);
            }
        }

        app.endUndoGroup();
        return "true";
    } catch (e) {
        app.endUndoGroup();
        return "Error: " + e.toString();
    }
}

/**
 * Displays ScriptUI dialog for confirmation.
 * @return {string} "true" if confirmed, "false" if cancelled.
 */
function ConfirmDialog() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return "Error: No active composition";

    var selectedLayers = comp.selectedLayers;
    if (selectedLayers.length === 0) return "Error: No layers selected";

    var dlg = new Window("dialog", "Reset Property");
    dlg.orientation = "column";
    dlg.alignChildren = ["fill", "top"];
    dlg.spacing = 15;
    dlg.margins = 20;

    var textGroup = dlg.add("group");
    textGroup.orientation = "column";
    textGroup.alignChildren = ["left", "top"];
    textGroup.spacing = 5;

    var title = textGroup.add("statictext", undefined, "Reset Time Remap?");

    title.graphics.font = ScriptUI.newFont(title.graphics.font.name, "BOLD", 14);

    textGroup.add("statictext", undefined, "This will remove all keyframes and disable");
    textGroup.add("statictext", undefined, "Time Remapping for " + selectedLayers.length + " selected layer(s).");

    var btnGroup = dlg.add("group");
    btnGroup.orientation = "row";
    btnGroup.alignment = ["right", "top"];
    btnGroup.spacing = 10;

    var cancelBtn = btnGroup.add("button", undefined, "Cancel", { name: "cancel" });
    var okBtn = btnGroup.add("button", undefined, "Remove All", { name: "ok" });


    if (dlg.show() == 1) { // If user clicks "Remove All"
        app.beginUndoGroup("Remove All Time Remap");
        try {
            for (var i = 0; i < selectedLayers.length; i++) {
                if (selectedLayers[i].canSetTimeRemapEnabled) {
                    selectedLayers[i].timeRemapEnabled = false;
                }
            }
            app.endUndoGroup();
            return "true";
        } catch (e) {
            app.endUndoGroup();
            return e.toString();
        }
    } else {
        return "false"; // User cancelled
    }
}

/**
 * UI Dialog Export
 * @return {string} "csv", "json" or "cancel"
 */
function showExportTypeDialog() {
    var dlg = new Window("dialog", "Export Options");
    dlg.orientation = "column";
    dlg.alignChildren = ["fill", "top"];
    dlg.spacing = 15;
    dlg.margins = 20;

    dlg.add("statictext", undefined, "Select export format:");

    var btnGroup = dlg.add("group");
    btnGroup.orientation = "row";
    btnGroup.alignment = ["center", "top"];
    btnGroup.spacing = 10;

    var csvBtn = btnGroup.add("button", undefined, "Export as CSV");
    var jsonBtn = btnGroup.add("button", undefined, "Export as JSON");
    var cancelBtn = btnGroup.add("button", undefined, "Cancel");

    var result = "cancel";

    csvBtn.onClick = function () {
        result = "csv";
        dlg.close();
    };

    jsonBtn.onClick = function () {
        result = "json";
        dlg.close();
    };

    cancelBtn.onClick = function () {
        dlg.close();
    };

    dlg.show();
    return result;
}

function importDougaData(jsonStr) {
    var data;
    try { data = JSON.parse(jsonStr); } catch (e) { return JSON.stringify({ error: 'JSON parse: ' + e.toString() }); }
    var columns = data.columns || [];
    var fps = data.fps || 24;

    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
        return JSON.stringify({ error: 'No active comp. Sync layers first.' });
    }

    app.beginUndoGroup('Import Timesheet Douga');
    var layerCount = 0;
    var totalKeys = 0;
    for (var c = 0; c < columns.length; c++) {
        var col = columns[c];
        var cells = col.cells || [];
        if (!cells.length) continue;
        var label = col.label || col.layerName;
        var layer = null;
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).name === label) { layer = comp.layer(i); break; }
        }
        if (!layer) continue;
        clearAllTimeRemapKeyframes(layer.name);
        for (var k = 0; k < cells.length; k++) {
            if (addTimeRemapKeyframe_Import(layer.name, cells[k].frame, cells[k].value, 'hold', fps) === 'true') totalKeys++;
        }
        layerCount++;
    }
    app.endUndoGroup();
    return JSON.stringify({ layerCount: layerCount, keyframeCount: totalKeys });
}
`;