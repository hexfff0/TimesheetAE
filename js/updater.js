/**
 * Timesheet Extension - Self Updater
 *
 * Fetches version.json from the public GitHub repo on panel load (silently),
 * shows a soft non-blocking banner when a newer version exists, and applies
 * the update with "Direct file-write": the panel downloads each file, base64-
 * encodes it, and hands it to the host `writeUpdaterFile`, which decodes and
 * writes it into the install folder (byte-exact, incremental - only the files
 * listed in version.json are touched).
 *
 * Reload strategy: CEP has no reliable "restart this panel" API, so after a
 * successful apply we location.reload() to pick up the new code; if the panel
 * is reloaded before all files are flushed, the user is told to close/reopen.
 */

// Repo that owns the update feed. Must be a public GitHub repo. Files are
// fetched from raw.githubusercontent.com, version.json from the repo root.
var UPDATE_REPO_OWNER = 'hexfff0';
var UPDATE_REPO_NAME = 'TimesheetAE';
var UPDATE_BRANCH = 'main';
var UPDATE_VERSION_URL = 'https://raw.githubusercontent.com/' + UPDATE_REPO_OWNER + '/' + UPDATE_REPO_NAME + '/' + UPDATE_BRANCH + '/version.json';
var UPDATE_FILE_BASE = 'https://raw.githubusercontent.com/' + UPDATE_REPO_OWNER + '/' + UPDATE_REPO_NAME + '/' + UPDATE_BRANCH + '/';

// Cooldown so the silent auto-check only hits the network once per session.
var UPDATE_LAST_CHECK_KEY = 'timesheet.updateLastCheck';
var UPDATE_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12h

// The version this build was shipped as (matches CSXS/manifest.xml). Update
// this on every release; it is the fallback when the install has no
// version.json yet (e.g. a pre-updater install).
var UPDATE_CURRENT_VERSION = '3.3.0';

var UPDATE_STATE = {
    checked: false,
    available: null,   // parsed remote version.json when newer
    downloading: false,
    applied: false
};

/**
 * Read the locally installed version: the version.json sitting in the install
 * root beside the panel (read synchronously by the host). When it is absent or
 * unreadable, fall back to the baked UPDATE_CURRENT_VERSION of this build.
 */
function readLocalUpdaterVersion(callback) {
    evalHost('readUpdaterVersion', [], function (result) {
        var version = null;
        if (result && result !== 'null' && result !== 'undefined') {
            try {
                var data = JSON.parse(result);
                version = data && data.version ? data.version : null;
            } catch (e) {
                version = null;
            }
        }
        callback(version || UPDATE_CURRENT_VERSION);
    });
}

/**
 * Check for a newer version. Silent and non-blocking: called from initUpdater
 * on a timer so it never delays panel setup. Stores its result so applyUpdate
 * can reuse the comparison without a second fetch.
 */
function checkForUpdates() {
    // Cooldown: don't hammer GitHub on every panel open.
    var last = 0;
    try { last = parseInt(localStorage.getItem(UPDATE_LAST_CHECK_KEY)) || 0; } catch (e) {}
    if (Date.now() - last < UPDATE_COOLDOWN_MS) {
        UPDATE_STATE.checked = true;
        return;
    }

    readLocalUpdaterVersion(function (localVersion) {
        fetch(UPDATE_VERSION_URL)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (remote) {
                UPDATE_STATE.checked = true;
                try { localStorage.setItem(UPDATE_LAST_CHECK_KEY, String(Date.now())); } catch (e) {}

                if (!remote || !remote.version) return;
                if (!localVersion || !isNewerVersion(remote.version, localVersion)) return;

                UPDATE_STATE.available = remote;
                showUpdateBanner(remote);
            })
            .catch(function () {
                // Network/JSON failures are silent - no banner, no status spam.
                UPDATE_STATE.checked = true;
            });
    });
}

/**
 * Compare dotted version strings. Returns true when `remote` is strictly newer
 * than `local`.
 */
function isNewerVersion(remote, local) {
    var r = String(remote).split('.').map(Number);
    var l = String(local).split('.').map(Number);
    var len = Math.max(r.length, l.length);
    for (var i = 0; i < len; i++) {
        var rv = i < r.length ? r[i] : 0;
        var lv = i < l.length ? l[i] : 0;
        if (rv > lv) return true;
        if (rv < lv) return false;
    }
    return false; // equal
}

/**
 * Show a soft, non-blocking update banner (does not steal focus, does not
 * cover the toolbar). Dismissible, with an "Update" action that the user
 * controls.
 */
function showUpdateBanner(remote) {
    var existing = document.getElementById('updateBanner');
    if (existing) existing.parentNode.removeChild(existing);

    var banner = document.createElement('div');
    banner.id = 'updateBanner';
    banner.className = 'update-banner';
    banner.innerHTML =
        '<div class="update-banner-text">' +
        'A new Timesheet version is available' +
        (remote.version ? ' (v' + escapeHtml(remote.version) + ')' : '') +
        '</div>' +
        '<button id="updateActionBtn" class="update-banner-btn">Update</button>' +
        '<button class="update-banner-close" title="Dismiss">&times;</button>';
    document.body.appendChild(banner);

    banner.querySelector('.update-banner-close').addEventListener('click', function () {
        banner.parentNode.removeChild(banner);
    });
    banner.querySelector('#updateActionBtn').addEventListener('click', function () {
        applyUpdate();
    });

    if (remote.releaseNotes) {
        banner.title = remote.releaseNotes;
    }
}

function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

/**
 * Apply the update: download each file listed in the remote version.json,
 * base64-encode it, write it via the host into the install folder. Sequential
 * so the host never gets concurrent writes. On success, reload to pick up
 * the new code (see reload note at the top).
 */
function applyUpdate() {
    var remote = UPDATE_STATE.available;
    if (!remote || !remote.files || !remote.files.length) return;

    var banner = document.getElementById('updateBanner');
    if (banner) {
        var btn = banner.querySelector('#updateActionBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Updating...'; }
    }
    UPDATE_STATE.downloading = true;

    var index = 0;
    var files = remote.files;

    // The installed version.json must be refreshed too, or the next panel open
    // would re-report the same update. Written from the remote's own fields.
    function syncInstalledVersion(done) {
        var localJson = JSON.stringify({
            version: remote.version || UPDATE_CURRENT_VERSION,
            releaseNotes: remote.releaseNotes || ''
        });
        evalHost('writeUpdaterFile', ['version.json', utf8ToBase64(localJson)], function (result) {
            done(result === 'true');
        });
    }

    function next() {
        if (index >= files.length) {
            syncInstalledVersion(function (ok) {
                UPDATE_STATE.downloading = false;
                UPDATE_STATE.applied = true;
                if (banner) {
                    banner.querySelector('.update-banner-text').textContent =
                        ok ? 'Updated. Reloading...' : 'Updated (version note pending). Reloading...';
                }
                // Reload picks up the freshly written files. CEP has no reliable
                // close/reopen API; if the reload happens before the panel has
                // fully flushed, the next open runs the new code anyway.
                setTimeout(function () { window.location.reload(); }, 400);
            });
            return;
        }

        var file = files[index];
        index++;
        var url = (file.storage || UPDATE_FILE_BASE) + file.path;
        var absUrl = /^https?:\/\//.test(url) ? url : UPDATE_FILE_BASE + file.path;

        fetch(absUrl)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + file.path);
                return res.arrayBuffer();
            })
            .then(function (buf) {
                var b64 = arrayBufferToBase64(buf);
                var attempts = 0;

                function writeOnce(retrying) {
                    attempts++;
                    evalHost('writeUpdaterFile', [file.path, b64], function (result) {
                        if (result !== 'true') {
                            // A sharing violation / transient lock often clears
                            // within a few hundred ms — retry once before giving up.
                            if (!retrying && attempts <= 1) {
                                setTimeout(function () { writeOnce(true); }, 250);
                                return;
                            }
                            UPDATE_STATE.downloading = false;
                            if (banner) {
                                banner.querySelector('.update-banner-text').textContent = 'Update failed: ' + result;
                                var b = banner.querySelector('#updateActionBtn');
                                if (b) { b.disabled = false; b.textContent = 'Update'; }
                            }
                            return;
                        }
                        updateStatus('Updated ' + (file.path.split('/').pop()));
                        next();
                    });
                }
                writeOnce(false);
            })
            .catch(function (err) {
                UPDATE_STATE.downloading = false;
                if (banner) {
                    banner.querySelector('.update-banner-text').textContent = 'Update failed: ' + err.message;
                    var b = banner.querySelector('#updateActionBtn');
                    if (b) { b.disabled = false; b.textContent = 'Update'; }
                }
            });
    }

    next();
}

function arrayBufferToBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function utf8ToBase64(str) {
    // btoa only accepts Latin-1; encode UTF-8 bytes first so version.json
    // notes with non-Latin1 characters survive.
    var bytes = unescape(encodeURIComponent(str)); // eslint-disable-line no-escape
    return btoa(bytes);
}

/**
 * Kick off the silent check from the panel entry point (main.js). Deferred so
 * it never blocks the initial table build.
 */
function initUpdater() {
    if (typeof fetch !== 'function') return; // very old CEF - skip gracefully
    setTimeout(checkForUpdates, 0);
}