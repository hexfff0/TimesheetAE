// WARNING: This file is GENERATED from host/hostscript.jsx by build/host-bundle.js.
// Do not edit it directly — edit host/hostscript.jsx and run `npm run dev:build`.

var HOST_FUNCS = `
/**
 * Timesheet Extension - Host Script
 *
 * This is the CANONICAL source of the ExtendScript that runs inside After
 * Effects. js/host-funcs.js is generated from this file by build/host-bundle.js
 * (see "npm run dev:build"). Never edit the generated file directly.
 *
 * ExtendScript (ES3) constraints apply: var only, no template literals,
 * no let/const, no arrow functions.
 *
 * Conventions (do not "fix" without verifying in AE):
 * - Layer lookup is always index-first, then name fallback (findLayer).
 * - Frame indices are intentionally inconsistent per function; see the
 *   comments on addTimeRemapKeyframe (0-based frame) vs
 *   addTimeRemapKeyframe_Import (1-based frame). Keyframe VALUES are always
 *   1-based and converted via (value - 1) / sourceFps.
 * - Every mutating operation runs inside beginUndoGroup/endUndoGroup.
 * - AE quirks are preserved on purpose: enabling time remap auto-creates two
 *   keyframes (we keep the first), and deleting the last keyframe would
 *   auto-disable time remap (so we park a placeholder keyframe instead).
 */

/**
 * Resolve a layer by index first, then by name, exactly as the original call
 * sites did (index wins when it resolves; the name loop is the fallback).
 * Returns the Layer or null.
 */
function findLayer(comp, layerIndex, layerName) {
    var layer = null;
    if (layerIndex !== undefined && layerIndex > 0) {
        layer = comp.layer(layerIndex);
    }
    if (!layer && layerName !== undefined && layerName !== null) {
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).name === layerName) {
                return comp.layer(i);
            }
        }
    }
    return layer;
}

/**
 * Return the frame rate of a layer's source (footage conform rate, nested comp
 * rate, or the comp rate as a last resort). Used to convert keyframe values.
 */
function sourceFrameRate(layer, fallbackFps) {
    var sourceItem = layer.source;
    if (sourceItem && sourceItem instanceof FootageItem) {
        return sourceItem.mainSource.conformFrameRate || fallbackFps;
    }
    if (sourceItem && sourceItem instanceof CompItem) {
        return sourceItem.frameRate;
    }
    return fallbackFps;
}

/**
 * Return the active composition, or null when the active item is not a comp.
 * Every host function guards with this check before doing any work.
 */
function activeComp() {
    var comp = app.project.activeItem;
    if (comp && comp instanceof CompItem) {
        return comp;
    }
    return null;
}

/**
 * Find the keyframe index on prop whose time is within 1/1000s of compTime,
 * or -1 when no keyframe sits at that time.
 */
function keyIndexAtTime(prop, compTime) {
    for (var i = 1; i <= prop.numKeys; i++) {
        if (Math.abs(prop.keyTime(i) - compTime) < 0.001) {
            return i;
        }
    }
    return -1;
}

/**
 * Set interpolation on the given keyframe index. Defaults to LINEAR; HOLD is
 * applied only when keyframeType is "hold". No-op when keyIndex is invalid.
 */
function setKeyframeInterpolation(prop, keyIndex, keyframeType) {
    if (keyIndex === -1) return;
    if (keyframeType === "hold") {
        prop.setInterpolationTypeAtKey(keyIndex,
            KeyframeInterpolationType.LINEAR,
            KeyframeInterpolationType.HOLD);
    } else {
        prop.setInterpolationTypeAtKey(keyIndex,
            KeyframeInterpolationType.LINEAR,
            KeyframeInterpolationType.LINEAR);
    }
}

// Get information about selected layers
function getSelectedLayersInfo() {
    try {
        var comp = activeComp();

        if (!comp) {
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
        for (var s = 0; s < sortedLayers.length; s++) {
            var layer = sortedLayers[s];
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
function addTimeRemapKeyframe(layerIndex, layerName, frame, value, keyframeType, compFps) {
    try {
        app.beginUndoGroup("Add Time Remap Keyframe");

        var comp = activeComp();
        if (!comp) {
            return "Error: No active composition";
        }

        var layer = findLayer(comp, layerIndex, layerName);
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

        // Convert value (source frame number) to time in source timeline.
        // Value is 1-based (user enters 1, 2, 3...), so the source time is
        // (value - 1) / sourceFps using the layer's own frame rate.
        var sourceFps = sourceFrameRate(layer, compFps);
        var sourceTime = (value - 1) / sourceFps;

        // Use setValueAtTime to create or update keyframe
        // This method is more reliable than addKey as it automatically handles duplicates
        timeRemapProp.setValueAtTime(compTime, sourceTime);

        // Find the keyframe we just created/updated and set interpolation
        setKeyframeInterpolation(timeRemapProp, keyIndexAtTime(timeRemapProp, compTime), keyframeType);

        // Mirror the import path (removeFirstKeyframeIfNeeded): enabling Time
        // Remap makes AE auto-create a keyframe at comp frame 1. When the data
        // being added does not start there, that auto key is a phantom that
        // would otherwise survive and show up in the table at row 1. Safe to
        // drop: the data key we just set keeps Time Remap enabled. frame is
        // 0-based, so "starts at frame 1" is frame === 0.
        if (justEnabled && frame !== 0) {
            for (var i = 1; i <= timeRemapProp.numKeys; i++) {
                if (Math.round(timeRemapProp.keyTime(i) * compFps) + 1 === 1) {
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

/**
 * Delete a time remap keyframe.
 *
 * Frames passed here are 0-based comp frames. When deleting the very last
 * keyframe, AE would auto-disable Time Remap, so a temporary placeholder
 * keyframe is parked at comp time 100.0s first to keep the property enabled.
 */
function deleteTimeRemapKeyframe(layerIndex, layerName, frame) {
    try {
        app.beginUndoGroup("Delete Time Remap Keyframe");

        var comp = activeComp();
        if (!comp) {
            return "Error: No active composition";
        }

        var layer = findLayer(comp, layerIndex, layerName);
        if (!layer || !layer.timeRemapEnabled) {
            // No-op: the panel lets users clear cells on layers that never had
            // Time Remap enabled, and a layer lookup can legitimately miss
            // after the selection changes. With no Time Remap there are no
            // keyframes to delete, so report success instead of an error.
            return "true";
        }

        var timeRemapProp = layer.property("ADBE Time Remapping");
        var compFps = comp.frameRate;
        var compTime = frame / compFps;

        // Find keyframe to delete
        var keyIndexToDelete = keyIndexAtTime(timeRemapProp, compTime);

        if (keyIndexToDelete !== -1) {
            // Check if this would be the last keyframe
            if (timeRemapProp.numKeys === 1) {
                // Instead of disabling Time Remap, replace this keyframe with a temporary one
                // at a different location to keep Time Remap enabled
                var sourceFps = sourceFrameRate(layer, compFps);
                var sourceDuration = 1.0;
                var sourceItem = layer.source;
                if (sourceItem && sourceItem instanceof FootageItem) {
                    sourceDuration = sourceItem.duration;
                } else if (sourceItem && sourceItem instanceof CompItem) {
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

// Read existing time remap keyframes
function readTimeRemapKeyframes(layerIndex, layerName) {
    try {
        var comp = activeComp();
        if (!comp) {
            return JSON.stringify({ error: "No active composition" });
        }

        var layer = findLayer(comp, layerIndex, layerName);
        if (!layer || !layer.timeRemapEnabled) {
            return JSON.stringify({ keyframes: [] });
        }

        var timeRemapProp = layer.property("ADBE Time Remapping");
        var keyframes = [];
        var compFps = comp.frameRate;
        var sourceFps = sourceFrameRate(layer, compFps);

        for (var i = 1; i <= timeRemapProp.numKeys; i++) {
            var keyTime = timeRemapProp.keyTime(i);
            var keyValue = timeRemapProp.keyValue(i);

            // Convert times to frames (0-based comp frame + 1-based source frame)
            var compFrame = Math.round(keyTime * compFps);
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
function clearAllTimeRemapKeyframes(layerIndex, layerName) {
    try {
        app.beginUndoGroup("Clear Time Remap Keyframes");

        var comp = activeComp();
        if (!comp) {
            return "Error: No active composition";
        }

        var layer = findLayer(comp, layerIndex, layerName);
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
function addTimeRemapKeyframe_Import(layerIndex, layerName, frame, value, keyframeType, compFps) {
    try {
        app.beginUndoGroup("Add Time Remap Keyframe Import");

        var comp = activeComp();
        if (!comp) {
            return "Error: No active composition";
        }

        var layer = findLayer(comp, layerIndex, layerName);
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

        var sourceFps = sourceFrameRate(layer, compFps);
        var sourceTime = (value - 1) / sourceFps;
        timeRemapProp.setValueAtTime(compTime, sourceTime);

        setKeyframeInterpolation(timeRemapProp, keyIndexAtTime(timeRemapProp, compTime), keyframeType);

        app.endUndoGroup();
        return "true";

    } catch (e) {
        app.endUndoGroup();
        return "Error: " + e.toString();
    }
}

// Remove first keyframe if CSV doesn't start at frame 1
function removeFirstKeyframeIfNeeded(layerIndex, layerName, firstFrameFromCSV, fps) {
    try {
        app.beginUndoGroup("Remove First Keyframe");

        var comp = activeComp();
        if (!comp) {
            return "Error: No active composition";
        }

        var layer = findLayer(comp, layerIndex, layerName);
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
function trimLayerDuration(layerIndex, layerName, endFrame, maxFrame, fps) {
    try {
        app.beginUndoGroup("Trim Layer Duration");

        var comp = activeComp();
        if (!comp) {
            return "Error: No active composition";
        }

        var layer = findLayer(comp, layerIndex, layerName);
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
 * Displays ScriptUI dialog for confirmation.
 * @return {string} "true" if confirmed, "false" if cancelled.
 */
function ConfirmDialog() {
    var comp = activeComp();
    if (!comp) return "Error: No active composition";

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
 * Build the four camera-link expression strings. sourceRef is the JS
 * expression prefix used to reach the linked comp: createCompFromSelection
 * targets the pre-comp with thisLayer.source, addCameraLinkExpression targets
 * the parent layer's source directly. See the rebuild script on why the source
 * string is interpolated inline rather than concatenated per-expression.
 */
function cameraExpressions(sourceRef) {
    // NOTE: the original expressions embed the two characters backslash-n (not
    // a real newline) between statements. That byte-exact form is preserved.
    var p = 'for (var i = 1; i < ' + sourceRef + '.numLayers + 1; ++i) {\\n' +
        'bclr = ' + sourceRef + '.layer(i);\\n' +
        'if (bclr.name.indexOf("camera") == 0 && (bclr.time>=bclr.inPoint) && (bclr.time<bclr.outPoint)){\\n';
    var scale = 'transform.scale;\\n' + p +
        'bc = ' + sourceRef + '.layer(i);\\n' +
        'scl = bc.scale.valueAtTime(time-thisLayer.startTime) * 0.01;\\n' +
        'while (true){\\n' +
        'if(!bc.hasParent) break;\\n' +
        'bc = bc.parent;\\n' +
        'for (var i=0; i < 2; i++) {scl[i]*=bc.scale.valueAtTime(time-thisLayer.startTime)[i]/100}\\n' +
        '}\\n' +
        '[1/scl[0]*transform.scale[0],1/scl[1]*transform.scale[1]]\\n' +
        'break;}transform.scale;}';
    var pos = 'transform.position;\\n' + p +
        sourceRef + '.layer(i).transform.anchorPoint.valueAtTime(time-thisLayer.startTime);\\n' +
        'break;}transform.position;}';
    var rot = 'transform.rotation;\\n' + p +
        'rt = ' + sourceRef + '.layer(i).toWorldVec([1,0,0],time-thisLayer.startTime); -radiansToDegrees(Math.atan2(rt[1],rt[0]));\\n' +
        'break;}transform.rotation;}';
    var anchor = 'transform.anchorPoint;\\n' + p +
        'bc = ' + sourceRef + '.layer(i);\\n' +
        'bc.toWorld(bc.anchorPoint.valueAtTime(time-thisLayer.startTime));\\n' +
        'break;}transform.anchorPoint;}';
    return { scale: scale, pos: pos, rot: rot, anchor: anchor };
}

function createCameraSolid(w, h, dataJson) {
    var comp = activeComp();
    if (!comp) return "Error: No active comp";
    var data = eval(dataJson);
    if (!data || !data.length) return "Error: No camera data";
    app.beginUndoGroup("Import XDTS Camera");
    var solid = comp.layers.addSolid([1, 1, 1], "camera", w, h, 1.0);
    solid.guideLayer = true;
    solid.label = 1;
    var pos = solid.property("Position");
    var scl = solid.property("Scale");
    var rot = solid.property("Rotation");
    for (var j = 0; j < data.length; j++) {
        var d = data[j];
        var t = (d.f - 1) * comp.frameDuration;
        pos.setValueAtTime(t, [d.x, d.y]);
        scl.setValueAtTime(t, [d.s, d.s, 100]);
        rot.setValueAtTime(t, d.r);
    }
    var maskGrp = solid.property("ADBE Mask Parade");
    var mask = maskGrp.addProperty("ADBE Mask Atom");
    mask.name = "Mask 1";
    var shape = new Shape();
    shape.vertices = [[0, 0], [w, 0], [w, h], [0, h]];
    shape.closed = true;
    mask.property("ADBE Mask Shape").setValue(shape);
    mask.inverted = true;
    var fx = solid.property("ADBE Effect Parade");
    var stroke = fx.addProperty("Stroke");
    stroke.property("ADBE Stroke-0001").setValue(1);
    stroke.property("ADBE Stroke-0010").setValue(1);
    stroke.property("ADBE Stroke-0002").setValue([0, 80/255, 1]);
    stroke.property("ADBE Stroke-0003").setValue(5.0);
    stroke.property("ADBE Stroke-0004").setValue(100);
    stroke.property("ADBE Stroke-0005").setValue(100);
    stroke.property("ADBE Stroke-0008").setValue(0);
    stroke.property("ADBE Stroke-0009").setValue(100);
    stroke.property("ADBE Stroke-0006").setValue(0);
    stroke.property("ADBE Stroke-0007").setValue(3);
    app.endUndoGroup();
    return "true";
}

function createCompFromSelection(w, h) {
    var sel = app.project.selection;
    if (!sel || sel.length === 0) return "Error: No item selected";
    var comp = sel[0];
    if (!(comp instanceof CompItem)) return "Error: Selected item is not a comp";
    app.beginUndoGroup("New Comp from Selection");
    var newComp = app.project.items.addComp("Camera", w, h, 1, comp.duration, comp.frameRate);
    var preCompLayer = newComp.layers.add(comp);
    var exprs = cameraExpressions("thisLayer.source");
    var t = preCompLayer.property("ADBE Transform Group");
    if (t) {
        try { t.property("ADBE Scale").expression = exprs.scale; } catch (e) {}
        try { t.property("ADBE Position").expression = exprs.pos; } catch (e) {}
        try { t.property("ADBE Rotate Z").expression = exprs.rot; } catch (e) {}
        try { t.property("ADBE Anchor Point").expression = exprs.anchor; } catch (e) {}
    }
    app.endUndoGroup();
    return "true";
}

function addCameraLinkExpression(w, h) {
    var comp = activeComp();
    if (!comp) return "Error: No active comp";
    var sel = comp.selectedLayers;
    if (!sel || sel.length === 0) return "Error: No layer selected";
    app.beginUndoGroup("Add Camera Link Expression");
    var exprs = cameraExpressions("source");
    for (var s = 0; s < sel.length; s++) {
        var layer = sel[s];
        var t = layer.property("ADBE Transform Group");
        if (t) {
            try {
                var scaleProp = t.property("ADBE Scale");
                if (scaleProp && scaleProp.canSetExpression) scaleProp.expression = exprs.scale;
                var posProp = t.property("ADBE Position");
                if (posProp && posProp.canSetExpression) posProp.expression = exprs.pos;
                var rotProp = t.property("ADBE Rotate Z");
                if (rotProp && rotProp.canSetExpression) rotProp.expression = exprs.rot;
                var anchorProp = t.property("ADBE Anchor Point");
                if (anchorProp && anchorProp.canSetExpression) anchorProp.expression = exprs.anchor;
            } catch (e) {}
        }
    }
    app.endUndoGroup();
    return "true";
}

/**
 * Self-updater helpers (panel updater.js drives these via evalHost).
 * The host script lives at <installRoot>/host/hostscript.jsx, so the install
 * root is always Folder($.fileName).parent.parent — no path has to come from
 * the panel.
 */

/**
 * Decode a base64 string to a binary string of single-char bytes, using a
 * hand-rolled ES3-safe decoder (ExtendScript has no atob).
 */
function base64Decode(base64) {
    var lookup = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var result = "";
    var buffer = [0, 0, 0];
    var byteCount = 0;
    var i = 0;
    for (i = 0; i < base64.length; i++) {
        var c = base64.charAt(i);
        if (c === "=" || c === "" ) break; // padding terminates the stream
        var index = lookup.indexOf(c);
        if (index < 0) continue; // skip whitespace/newlines
        buffer[byteCount] = index;
        byteCount++;
        if (byteCount === 4) {
            result += String.fromCharCode(
                (buffer[0] << 2) | (buffer[1] >> 4),
                ((buffer[1] & 15) << 4) | (buffer[2] >> 2),
                ((buffer[2] & 3) << 6) | buffer[3]
            );
            byteCount = 0;
        }
    }
    if (byteCount === 2) {
        result += String.fromCharCode((buffer[0] << 2) | (buffer[1] >> 4));
    } else if (byteCount === 3) {
        result += String.fromCharCode(
            (buffer[0] << 2) | (buffer[1] >> 4),
            ((buffer[1] & 15) << 4) | (buffer[2] >> 2)
        );
    }
    return result;
}

/**
 * Return the installed extension root folder (parent of host/).
 */
function updaterRoot() {
    return File($.fileName).parent.parent;
}

/**
 * Read the installed copy's version.json (the local version the updater
 * compares against). Returns its raw text, or "null" when it is absent.
 */
function readUpdaterVersion() {
    try {
        var localFile = new File(updaterRoot().fsName + "/version.json");
        if (!localFile.exists) return "null";
        localFile.encoding = "UTF-8";
        localFile.open("r");
        var content = localFile.read();
        localFile.close();
        return content;
    } catch (e) {
        return "Error: " + e.toString();
    }
}

/**
 * Recursively create a folder chain (Folder.create() only makes one level).
 * ES3-safe; returns true when the folder exists by the end.
 */
function ensureFolder(folder) {
    try {
        if (folder.exists) return true;
        var parent = folder.parent;
        if (parent === null) return false; // can't create above the drive root
        if (!ensureFolder(parent)) return false;
        return folder.create();
    } catch (e) {
        return false;
    }
}

/**
 * Write an update payload (base64) to <installRoot>/filePath, creating parent
 * folders as needed. filePath must be extension-relative; ".." traversal is
 * rejected. Encoding BINARY + a pre-decoded byte string preserves bytes
 * exactly (no CRLF translation).
 */
function writeUpdaterFile(filePath, base64) {
    try {
        if (!filePath || filePath.indexOf("..") !== -1 || filePath.indexOf("/") === 0) {
            return "Error: Invalid update path - " + filePath;
        }
        // The panel always sends forward-slash paths, so no normalization is
        // needed. Avoid backslash escape sequences here: the host bundle embeds
        // this script in a JS template literal that would decode them.
        var target = new File(updaterRoot().fsName + "/" + filePath);
        if (!ensureFolder(target.parent)) {
            return "Error: Cannot create folder - " + filePath;
        }
        var data = base64Decode(base64);
        target.encoding = "BINARY";
        // Try "e" (edit, no-truncate) first: writing the running panel's own
        // HTML via truncating "w" fails with a sharing violation because CEF
        // keeps the file memory-mapped. In-place "e" + length setter avoids
        // that. Fall back to "w" for older hosts where "e" is unavailable.
        var opened = false;
        if (target.open("e")) {
            target.seek(0);
            target.write(data);
            target.length = data.length;
            opened = true;
        } else if (target.open("w")) {
            target.write(data);
            opened = true;
        }
        if (opened) {
            target.close();
            return "true";
        }
        return "Error: Cannot open for write - " + filePath +
            " (error: " + target.error + ")";
    } catch (e) {
        return "Error: " + e.toString();
    }
}`;

// HOST_BUNDLE_SHA256=e7ae8a8c61ba9215da7fd1698d753f97383fc79ca9cac46da21dc7c69e3aea10
