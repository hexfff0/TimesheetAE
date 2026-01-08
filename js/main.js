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
    updateStatus('Ready');
});
