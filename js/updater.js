/**
 * Timesheet Extension - Self Updater
 *
 * Checks the public GitHub repo for a newer version on every panel open
 * (silently, no cooldown), shows a soft non-blocking banner when one exists,
 * and applies the update: the panel downloads each file, base64-encodes it,
 * and hands it
 * to the host `writeUpdaterFile`, which decodes and stages it byte-exact into
 * a temp folder (only the files listed in version.json are touched). Once all
 * files are staged, `applyStagedUpdate` swaps them into the install folder
 * in-process (delete+rename); a Startup script written by `finishStagedUpdate`
 * is the automatic fallback for any file CEF keeps memory-mapped, and the swap
 * finishes at the next AE launch.
 *
 * Install root comes from the panel via CEP getSystemPath("extension"), never
 * from the host: host code runs as an evalScript string where $.fileName is
 * empty. After a full apply the panel reloads to pick up the new code.
 */

// Repo that owns the update feed. Must be a public GitHub repo. Files are
// fetched from raw.githubusercontent.com, version.json from the repo root.
var UPDATE_REPO_OWNER = 'hexfff0';
var UPDATE_REPO_NAME = 'TimesheetAE';
var UPDATE_BRANCH = 'main';
var UPDATE_VERSION_URL = 'https://raw.githubusercontent.com/' + UPDATE_REPO_OWNER + '/' + UPDATE_REPO_NAME + '/' + UPDATE_BRANCH + '/version.json';
var UPDATE_FILE_BASE = 'https://raw.githubusercontent.com/' + UPDATE_REPO_OWNER + '/' + UPDATE_REPO_NAME + '/' + UPDATE_BRANCH + '/';


// The version this build was shipped as (matches CSXS/manifest.xml). Update
// this on every release; it is the fallback when the install has no
// version.json yet (e.g. a pre-updater install).
var UPDATE_CURRENT_VERSION = '3.4.0';

var UPDATE_STATE = {
    available: null    // parsed remote version.json when newer
};

/**
 * The installed extension root, resolved once and cached. The panel derives it
 * reliably via the CEP systemPath API ("extension" = install root) because the
 * host cannot: every host call runs as a string through evalScript, where
 * $.fileName is empty. Fall back to parsing location.href (file://.../index.html)
 * when the API is unavailable.
 */
var UPDATE_INSTALL_ROOT = null;

function getInstallRoot() {
    if (UPDATE_INSTALL_ROOT) return UPDATE_INSTALL_ROOT;
    var root = null;
    try {
        root = csInterface.getSystemPath('extension');
    } catch (e) { root = null; }
    if (!root || root === 'extension') {
        // Fallback: location.href is file:///C:/.../com.timesheet.extension/index.html
        try {
            var path = decodeURIComponent(location.href.split('?')[0].split('#')[0]);
            path = path.replace(/^file:\/{3}/, '');
            path = path.replace(/\/index\.html$/i, '');
            if (path) root = path;
        } catch (e) { root = null; }
    }
    if (root) {
        // Normalize trailing slash so host path joins are clean.
        UPDATE_INSTALL_ROOT = root.replace(/\/+$/, '');
    }
    return UPDATE_INSTALL_ROOT;
}

/**
 * Read the locally installed version: the version.json sitting in the install
 * root beside the panel (read synchronously by the host). When it is absent or
 * unreadable, fall back to the baked UPDATE_CURRENT_VERSION of this build.
 */
function readLocalUpdaterVersion(callback) {
    var root = getInstallRoot();
    evalHost('readUpdaterVersion', [root], function (result) {
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
 * Check for a newer version. Called on every panel open from initUpdater
 * (force=false, silent — never delays setup). When force=true (clicking the
 * bottom-right version label) the outcome is reported to the status bar.
 */
function checkForUpdates(force) {
    if (force) updateStatus('Checking for updates...');

    readLocalUpdaterVersion(function (localVersion) {
        fetch(UPDATE_VERSION_URL)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (remote) {
                if (!remote || !remote.version) {
                    if (force) updateStatus('Update check: no version feed.');
                    return;
                }
                if (!localVersion || !isNewerVersion(remote.version, localVersion)) {
                    if (force) updateStatus('Timesheet is up to date (v' + remote.version + ').');
                    return;
                }

                UPDATE_STATE.available = remote;
                showUpdateBanner(remote);
            })
            .catch(function (err) {
                // Network/JSON failures are silent on load, but a manual check
                // should say why nothing happened.
                if (force) updateStatus('Update check failed: ' + (err && err.message ? err.message : err));
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
 * base64-encode it, stage it via the host, then swap the staged files into
 * place in-process (delete+rename) and reload to pick up the new code. Any
 * file that stays locked (CEF memory-maps the running panel's files) is left
 * for the Startup-script fallback at the next AE launch.
 */
function applyUpdate() {
    var remote = UPDATE_STATE.available;
    if (!remote || !remote.files || !remote.files.length) return;
    var root = getInstallRoot();
    if (!root) {
        updateStatus('Update failed: cannot resolve extension install path.');
        return;
    }

    var banner = document.getElementById('updateBanner');
    if (banner) {
        var btn = banner.querySelector('#updateActionBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Updating...'; }
    }

    var index = 0;
    var files = remote.files;

    // Stage the installed version.json too, or the next panel open would
    // re-report the same update. It is staged like every other file and moved
    // by the same swap.
    function syncInstalledVersion(done) {
        var localJson = JSON.stringify({
            version: remote.version || UPDATE_CURRENT_VERSION,
            releaseNotes: remote.releaseNotes || ''
        });
        evalHost('writeUpdaterFile', [root, 'version.json', utf8ToBase64(localJson)], function (result) {
            done(result === 'staged');
        });
    }

    // Reset the banner to a fresh state (used after errors + on completion).
    function setBannerText(text) {
        if (banner) {
            banner.querySelector('.update-banner-text').textContent = text;
        }
    }

    // Report an error and re-enable the Update button.
    function fail(message) {
        setBannerText('Update failed: ' + message);
        if (banner) {
            var b = banner.querySelector('#updateActionBtn');
            if (b) { b.disabled = false; b.textContent = 'Update'; }
        }
    }

    function next() {
        if (index >= files.length) {
            // All files staged. Swap them into place in-process; the Startup
            // script fallback was already written by finishStagedUpdate inside
            // applyStagedUpdate for any file that stays locked.
            syncInstalledVersion(function (ok) {
                if (!ok) {
                    fail('could not stage version.json');
                    return;
                }
                evalHost('applyStagedUpdate', [root], function (applyResult) {
                    if (applyResult === 'applied') {
                        setBannerText('Update applied (v' + (remote.version || '') + '). Reloading...');
                        updateStatus('Update applied. Reloading panel...');
                        // Best-effort cleanup of staging + the Startup fallback
                        // script (the live swap already did the work).
                        evalHost('cleanupStagedUpdate', [root], function () {
                            setTimeout(function () { location.reload(); }, 300);
                        });
                        return;
                    }

                    if (typeof applyResult === 'string' && applyResult.indexOf('partial:') === 0) {
                        var missed = applyResult.substring('partial:'.length);
                        // Some files stayed locked (CEF memory-map). The Startup
                        // script left in place by finishStagedUpdate finishes the
                        // job at the next AE launch — no reload needed.
                        setBannerText(missed + ' file' + (missed === '1' ? ' is' : 's are') +
                            ' locked while running. Restart After Effects to finish.');
                        updateStatus('Update partly applied. Restart After Effects to finish.');
                        return;
                    }

                    fail(applyResult);
                });
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
                    evalHost('writeUpdaterFile', [root, file.path, b64], function (result) {
                        if (result !== 'staged') {
                            // A sharing violation / transient lock often clears
                            // within a few hundred ms — retry once before giving up.
                            if (!retrying && attempts <= 1) {
                                setTimeout(function () { writeOnce(true); }, 250);
                                return;
                            }
                            fail(result);
                            return;
                        }
                        updateStatus('Staged ' + (file.path.split('/').pop()));
                        next();
                    });
                }
                writeOnce(false);
            })
            .catch(function (err) {
                fail(err.message);
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
 * it never blocks the initial table build. Checks on every panel open (no
 * cooldown). Also fills the bottom-right version label with the installed
 * version and makes it clickable to re-check with visible status feedback.
 */
function initUpdater() {
    var label = document.getElementById('versionLabel');
    if (label) {
        // Show the installed version (read by the host from the on-disk
        // version.json; falls back to the baked-in current version).
        readLocalUpdaterVersion(function (version) {
            label.textContent = 'v' + version;
        });
        if (typeof fetch === 'function') {
            label.title = 'Check for updates';
            // The version label is a clickable action, so give it button
            // semantics for assistive tech and keyboard users.
            label.setAttribute('role', 'button');
            label.tabIndex = 0;
            label.addEventListener('click', function () {
                checkForUpdates(true);
            });
            label.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    checkForUpdates(true);
                }
            });
        } else {
            label.title = '';
        }
    }
    if (typeof fetch !== 'function') return; // very old CEF - skip gracefully
    setTimeout(checkForUpdates, 0);
}