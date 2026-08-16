/**
 * CSInterface - Communication bridge between CEP panel and host application
 */
var CSInterface = function() {};

CSInterface.prototype.evalScript = function(script, callback) {
    if (callback === null || callback === undefined) {
        callback = function(result) {};
    }
    window.__adobe_cep__.evalScript(HOST_FUNCS + ';' + script, callback);
};

/**
 * Return a host-system path. `type` is one of the CEP systemPath constants:
 * "extension" returns the installed extension root (used by the updater to
 * resolve installRoot reliably — the host cannot derive it via $.fileName).
 */
CSInterface.prototype.getSystemPath = function(type) {
    if (window.__adobe_cep__ && typeof window.__adobe_cep__.getSystemPath === 'function') {
        return window.__adobe_cep__.getSystemPath(type);
    }
    return null;
};

CSInterface.prototype.addEventListener = function(type, listener, obj) {
    window.addEventListener(type, listener, obj);
};

CSInterface.prototype.removeEventListener = function(type, listener, obj) {
    window.removeEventListener(type, listener, obj);
};

CSInterface.prototype.dispatchEvent = function(event) {
    if (typeof event.data == "object") {
        event.data = JSON.stringify(event.data);
    }
    window.__adobe_cep__.dispatchEvent(event);
};

// Constants
CSInterface.THEME_COLOR_CHANGED_EVENT = "com.adobe.csxs.events.ThemeColorChanged";
