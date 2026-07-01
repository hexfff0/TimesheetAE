/**
 * Timesheet Extension - Main Entry Point
 * 
 * This file serves as the entry point for the extension.
 * All functionality is modularized into separate files:
 * - state.js: Global state variables
 * - ui.js: Table building and UI functions
 * - selection.js: Cell selection and navigation
 * - keyframe.js: Keyframe operations
 * - export-import.js: Export/Import functionality
 * - events.js: Event handlers and keyboard shortcuts
 */

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function () {
    setupEventListeners();
    setupCustomDropdowns();
    updateStatus('Ready');
    startAeBridge();
});

function startAeBridge() {
    var PORT = 9720;
    var http;
    try { http = require('http'); } catch (e) { return; }
    if (!http) return;

    var server = http.createServer(function (req, res) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
        if (req.method !== 'POST' || req.url !== '/douga') { res.writeHead(404); res.end(); return; }

        var body = '';
        req.on('data', function (c) { body += c; });
        req.on('end', function () {
            try {
                var data = JSON.parse(body);
                if (!compInfo || !compInfo.layers || !compInfo.layers.length) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'No synced layers. Click Sync in AE panel first.' }));
                    return;
                }
                importDougaByIndex(data, compInfo.layers, function (p) {
                    updateStatus(p.error ? 'AE: ' + p.error : 'Douga: ' + p.layerCount + 'L ' + p.keyframeCount + 'K');
                    res.writeHead(p.error ? 400 : 200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(p));
                });
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
    });

    server.listen(PORT, '127.0.0.1', function () {
        updateStatus('Ready (bridge :' + PORT + ')');
    });
}

function importDougaByIndex(data, syncedLayers, callback) {
    var columns = data.columns || [];
    var fps = data.fps || 24;
    var totalKeys = 0;
    var layerCount = 0;
    var pending = 0;
    var cutDuration = (data.cut && data.cut.durationFrames) || 72;

    function done(err) {
        if (err) { callback({ error: err }); return; }
        callback({ layerCount: layerCount, keyframeCount: totalKeys });
    }

    for (var c = 0; c < columns.length; c++) {
        var col = columns[c];
        var cells = col.cells || [];
        if (!cells.length) continue;
        if (c >= syncedLayers.length) continue;
        var layerName = syncedLayers[c].name;
        var layerIndex = syncedLayers[c].index;
        var fpsForLayer = compInfo.fps || fps;

        pending++;
        (function (idx, name, cellsArr, fpsLocal, durFrames) {
            var script = 'clearAllTimeRemapKeyframes(' + idx + ',"' + name + '");';
            for (var k = 0; k < cellsArr.length; k++) {
                script += 'addTimeRemapKeyframe_Import(' + idx + ',"' + name + '",' + cellsArr[k].frame + ',' + cellsArr[k].value + ',"hold",' + fpsLocal + ');';
            }
            var firstFrame = cellsArr.length ? cellsArr[0].frame : 1;
            script += 'removeFirstKeyframeIfNeeded(' + idx + ',"' + name + '",' + firstFrame + ',' + fpsLocal + ');';
            script += 'trimLayerDuration(' + idx + ',"' + name + '",' + durFrames + ',' + durFrames + ',' + fpsLocal + ');';
            script += '"true"';
            csInterface.evalScript(script, function (r) {
                if (r === 'true') totalKeys += cellsArr.length;
                layerCount++;
                pending--;
                if (pending === 0) { loadExistingKeyframes(); done(); }
            });
        })(layerIndex, layerName, cells, fpsForLayer, cutDuration);
    }

    if (pending === 0) done('No columns matched synced layers');
}
