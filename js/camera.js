/**
 * Timesheet Extension - Camera Import + Camera Link Modal
 *
 * XDTS camera import and the "Camera Link" modal (Comp vs Link expressions
 * mode). Extracted from events.js so the camera-specific behavior has one
 * home. setupCameraHandlers() is called from setupEventListeners().
 */

/**
 * Wire the camera import button, the "new comp from selection" button, and the
 * camera-link modal (open, close-on-overlay/X, and the two mode buttons).
 */
function setupCameraHandlers() {
    var importCamBtn = document.getElementById('importCamXdtsBtn');
    if (importCamBtn) importCamBtn.addEventListener('click', importCameraFromXdts);

    var newCompBtn = document.getElementById('newCompFromSelBtn');
    if (newCompBtn) newCompBtn.addEventListener('click', newCompFromSelection);

    document.addEventListener('click', function (e) {
        var btn = e.target.closest('#cameraCompModal [data-mode]');
        if (!btn) return;
        var modal = document.getElementById('cameraCompModal');
        var mode = btn.dataset.mode;
        modal.classList.remove('open');

        var w = parseInt(document.getElementById('camWidth').value) || 1920;
        var h = parseInt(document.getElementById('camHeight').value) || 1080;

        if (mode === 'comp') {
            updateStatus('Creating comp from selection...');
            evalHost('createCompFromSelection', [w, h], function (res) {
                if (res === 'true') {
                    updateStatus('Camera comp created (' + w + 'x' + h + ')');
                } else {
                    updateStatus('Comp failed: ' + res);
                }
            });
        } else if (mode === 'link') {
            updateStatus('Adding camera link expressions...');
            evalHost('addCameraLinkExpression', [w, h], function (res) {
                if (res === 'true') {
                    updateStatus('Camera link expressions added');
                } else {
                    updateStatus('Link failed: ' + res);
                }
            });
        }
    });

    // Close modal on overlay click
    document.getElementById('cameraCompModal').addEventListener('click', function (e) {
        if (e.target === this) {
            this.classList.remove('open');
        }
    });

    // Close modal on X button click
    document.getElementById('cameraCompClose').addEventListener('click', function () {
        closeCameraModal();
    });
}

function closeCameraModal() {
    var modal = document.getElementById('cameraCompModal');
    modal.classList.remove('open');
    returnFocus(getLastFocused());
}

/**
 * The last element focused before a modal opened, so focus can be restored on
 * close. Shared by both modals (camera + preview).
 */
var _lastFocusedBeforeModal = null;

function getLastFocused() {
    return _lastFocusedBeforeModal;
}

function setLastFocused(el) {
    _lastFocusedBeforeModal = el;
}

/**
 * Move focus into a modal on open, remembering the trigger element so it can
 * be restored on close. Prefers the primary choice over the close button.
 */
function moveFocusIn(modal) {
    var opener = document.activeElement;
    if (opener && opener !== document.body) setLastFocused(opener);
    var first = modal.querySelector('.modal-option, button:not(.modal-close), input, select, a, [tabindex]');
    if (first) first.focus();
}

function returnFocus(el) {
    if (el && el.focus) {
        try { el.focus(); } catch (e) {}
    }
}

function importCameraFromXdts() {
    readLocalFile('.xdts', function (fileName, content) {
        try {
            var raw = content;
            var jsonStart = raw.indexOf('{');
            if (jsonStart === -1) { updateStatus('Invalid XDTS: no JSON content'); return; }
            var xdts = JSON.parse(raw.substring(jsonStart));
            var timeline = xdts.timeTables && xdts.timeTables[0];
            if (!timeline) { updateStatus('Invalid XDTS: no timeline'); return; }

            var camField = null;
            (timeline.fields || []).forEach(function (f) {
                if (camField) return;
                var frames = f.tracks && f.tracks[0] ? f.tracks[0].frames : [];
                var hasMulti = frames.some(function (fr) {
                    return fr.data && fr.data[0] && fr.data[0].values && fr.data[0].values.length > 1;
                });
                if (hasMulti) camField = f;
            });
            if (!camField) { updateStatus('No camera field found'); return; }

            var track = camField.tracks[0];
            var frames = track.frames || [];
            if (!frames.length) {
                var fieldSummary = [];
                (timeline.fields || []).forEach(function (f) {
                    var t = f.tracks && f.tracks[0];
                    var fc = t && t.frames ? t.frames.length : 0;
                    fieldSummary.push('f' + f.fieldId + '=' + fc + 'frames');
                });
                updateStatus('Camera field ' + camField.fieldId + ' empty. Fields: ' + fieldSummary.join(', '));
                return;
            }
            var keyframes = [];
            var lastFrame = null;
            frames.forEach(function (fr) {
                if (!fr.data || !fr.data[0] || !fr.data[0].values) return;
                var v = fr.data[0].values;
                if (v[0] === 'SYMBOL_NULL_CELL') return;
                lastFrame = { f: fr.frame + 1, x: parseFloat(v[1]), y: parseFloat(v[2]), s: parseFloat(v[3]), r: parseFloat(v[4]) };
                if (v[0] !== 'SYMBOL_HYPHEN') {
                    keyframes.push({ f: fr.frame + 1, x: parseFloat(v[1]), y: parseFloat(v[2]), s: parseFloat(v[3]), r: parseFloat(v[4]) });
                }
            });
            if (lastFrame && keyframes.length && (lastFrame.f !== keyframes[keyframes.length - 1].f)) {
                keyframes.push(lastFrame);
            }

            if (!keyframes.length) { updateStatus('No camera keyframes found'); return; }

            var w = parseInt(document.getElementById('camWidth').value) || 1920;
            var h = parseInt(document.getElementById('camHeight').value) || 1080;

            // createCameraSolid expects its data as a JSON *string* (host evals it), so
            // pre-stringify and let evalHost serialize the string.
            evalHost('createCameraSolid', [w, h, JSON.stringify(keyframes)], function () {
                updateStatus('Camera: ' + keyframes.length + 'K imported');
            });
        } catch (err) {
            updateStatus('XDTS parse error: ' + err.message);
        }
    });
}

function newCompFromSelection() {
    var w = parseInt(document.getElementById('camWidth').value) || 1920;
    var h = parseInt(document.getElementById('camHeight').value) || 1080;
    var modal = document.getElementById('cameraCompModal');
    modal.classList.add('open');
    moveFocusIn(modal);
}