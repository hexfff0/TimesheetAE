/**
 * CSInterface - Communication bridge between CEP panel and host application
 */
var CSInterface = function() {};

CSInterface.prototype.evalScript = function(script, callback) {
    if (callback === null || callback === undefined) {
        callback = function(result) {};
    }
    window.__adobe_cep__.evalScript(script, callback);
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

CSInterface.prototype.getSystemPath = function(pathType) {
    var path = decodeURI(window.__adobe_cep__.getSystemPath(pathType));
    var OSVersion = this.getOSInformation();
    if (OSVersion.indexOf("Windows") >= 0) {
        path = path.replace("file:///", "");
    } else if (OSVersion.indexOf("Mac") >= 0) {
        path = path.replace("file://", "");
    }
    return path;
};

CSInterface.prototype.getOSInformation = function() {
    var userAgent = navigator.userAgent;
    if (navigator.platform == "Win32" || navigator.platform == "Windows") {
        return "Windows" + userAgent.substring(userAgent.indexOf("Windows NT") + 11, userAgent.indexOf("Windows NT") + 14);
    } else if (navigator.platform == "MacIntel" || navigator.platform == "Macintosh") {
        return "Mac" + userAgent.substring(userAgent.indexOf("Mac OS X") + 9, userAgent.indexOf("Mac OS X") + 14);
    }
    return "Unknown";
};

CSInterface.prototype.getApplicationID = function() {
    var appId = this.hostEnvironment.appId;
    return appId;
};

CSInterface.prototype.hostEnvironment = (function() {
    var environment = window.__adobe_cep__ ? JSON.parse(window.__adobe_cep__.getHostEnvironment()) : null;
    return environment;
})();

// Constants
CSInterface.THEME_COLOR_CHANGED_EVENT = "com.adobe.csxs.events.ThemeColorChanged";
