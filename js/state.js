/**
 * Timesheet Extension - Global State
 */

var csInterface = new CSInterface();
var selectedCells = new Set();
var currentData = {};
var compInfo = null;
var isDragging = false;
var dragStartCell = null;
var selectionAnchor = null;
var suppressBlurApply = false;
var isMoving = false;
var movingCandidate = false;
var moveMouseStart = { x: 0, y: 0 };
var moveData = []; // [{row, col, relRow, relCol, value, layerName}]
var moveOrigin = { row: 0, col: 0 };
var currentDropTopLeft = null;
