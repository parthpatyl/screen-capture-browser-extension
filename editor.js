const canvas = document.getElementById('editorCanvas');
const ctx = canvas.getContext('2d');
const textInput = document.getElementById('textInput');
const propertiesBar = document.getElementById('properties-bar');
const propDraw = document.getElementById('prop-draw');
const propText = document.getElementById('prop-text');

// ==========================================
// STATE MANAGEMENT for OBJECTS
// ==========================================
let elements = []; // Array of { id, type, ...props }
let history = []; // Array of elements arrays (snapshots)
let historyStep = -1;

let backgroundHelper = { img: null };
let currentTool = 'pointer';

// Interaction State
let isDrawing = false;
let isDraggingElement = false; // Fixed: Missing declaration
let currentElement = null; // The object currently being created
let selectedElementIndex = -1; // The object currently selected for moving
let dragStartPos = { x: 0, y: 0 }; // Mouse position when drag started
let initialElementPos = null; // State of element when drag started (for offsets)

// Configuration
let strokeColor = '#ef4444';
let lineWidth = 4;
const highlighterAlpha = 0.4;

// Text Config
let fontSize = 24;
let fontFamily = 'sans-serif';
let textFill = false;
let textBorder = false;

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const data = await chrome.storage.local.get(['screenshotDataUrl']);
        if (data.screenshotDataUrl) {
            const img = new Image();
            img.onload = () => {
                backgroundHelper.img = img;
                canvas.width = img.width;
                canvas.height = img.height;
                render();
                saveState(); // Initial empty state
            };
            img.src = data.screenshotDataUrl;
        }
    } catch (e) {
        console.error('Error loading image:', e);
    }
    updateCursor();
});

// ==========================================
// RENDERING ENGINE
// ==========================================
function render() {
    // 1. Clear Canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 2. Draw Background
    if (backgroundHelper.img) {
        ctx.drawImage(backgroundHelper.img, 0, 0);
    }

    // 3. Draw All Elements
    elements.forEach(el => drawElement(el));

    // 4. Draw Current Element (being created)
    if (currentElement) {
        drawElement(currentElement);
    }
}

function drawElement(el) {
    ctx.save();
    ctx.beginPath();

    // Common styles
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // For text, we handle styles differently inside the block
    if (el.type !== 'text') {
        ctx.strokeStyle = el.color;
        ctx.lineWidth = el.size;
        if (el.type === 'highlighter') {
            ctx.globalAlpha = highlighterAlpha;
        } else {
            ctx.globalAlpha = 1.0;
        }
    }

    if (el.type === 'rect') {
        ctx.strokeRect(el.x, el.y, el.w, el.h);
    } else if (el.type === 'circle') {
        // el.r is radius
        ctx.beginPath();
        ctx.arc(el.cx, el.cy, el.r, 0, 2 * Math.PI);
        ctx.stroke();
    } else if (el.type === 'line') {
        drawArrow(ctx, el.x1, el.y1, el.x2, el.y2, el.size);
    } else if (el.type === 'pen' || el.type === 'highlighter') {
        if (el.points.length > 0) {
            ctx.moveTo(el.points[0][0], el.points[0][1]);
            // Simple line connection or curve? 
            // Using same logic as before (quadratic)
            if (el.points.length < 3) {
                const b = el.points[0];
                ctx.lineTo(el.points[el.points.length - 1][0], el.points[el.points.length - 1][1]);
            } else {
                for (let i = 1; i < el.points.length - 2; i++) {
                    const xc = (el.points[i][0] + el.points[i + 1][0]) / 2;
                    const yc = (el.points[i][1] + el.points[i + 1][1]) / 2;
                    ctx.quadraticCurveTo(el.points[i][0], el.points[i][1], xc, yc);
                }
                ctx.quadraticCurveTo(
                    el.points[el.points.length - 2][0],
                    el.points[el.points.length - 2][1],
                    el.points[el.points.length - 1][0],
                    el.points[el.points.length - 1][1]
                );
            }
            ctx.stroke();
        }
    } else if (el.type === 'text') {
        // Draw Text Box
        const padding = 8;

        // Background
        if (el.fill) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(el.x, el.y, el.w, el.h);
        }

        // Border
        if (el.border) {
            ctx.lineWidth = 2;
            ctx.strokeStyle = el.color;
            ctx.strokeRect(el.x, el.y, el.w, el.h);
        }

        // Text Content
        ctx.font = `${el.fontSize}px ${el.fontFamily}`;
        ctx.textBaseline = 'top';
        ctx.fillStyle = el.color;

        // We use the stored ScaleFactor if we want scale independence, strictly pixels here
        const lines = el.text.split('\n');
        const lineHeight = el.fontSize * 1.2;

        lines.forEach((line, index) => {
            ctx.fillText(line, el.x + padding, el.y + padding + (index * lineHeight));
        });
    }

    ctx.restore();
}

// Reuse arrow logic
function drawArrow(ctx, fromX, fromY, toX, toY, width) {
    const headLength = 10 + width * 1.5;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const angle = Math.atan2(dy, dx);

    // We need to set lineWidth since it's passed differently
    ctx.lineWidth = width;

    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headLength * Math.cos(angle - Math.PI / 6), toY - headLength * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headLength * Math.cos(angle + Math.PI / 6), toY - headLength * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
}

// ==========================================
// HIT TESTING
// ==========================================
function getElementAtPosition(x, y) {
    // Iterate backwards (top to bottom)
    for (let i = elements.length - 1; i >= 0; i--) {
        if (hitTest(elements[i], x, y)) {
            return i;
        }
    }
    return -1;
}

function hitTest(el, x, y) {
    const threshold = 10;

    if (el.type === 'rect' || el.type === 'text') {
        let rx = el.x, ry = el.y, rw = el.w, rh = el.h;
        if (rw < 0) { rx += rw; rw = -rw; }
        if (rh < 0) { ry += rh; rh = -rh; }
        return (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh);
    }
    if (el.type === 'circle') {
        const dist = Math.sqrt(Math.pow(x - el.cx, 2) + Math.pow(y - el.cy, 2));
        return dist <= el.r + threshold && dist >= el.r - threshold;
    }
    if (el.type === 'line') {
        return distanceToLine(x, y, el.x1, el.y1, el.x2, el.y2) < threshold;
    }
    if (el.type === 'pen' || el.type === 'highlighter') {
        for (let i = 0; i < el.points.length - 1; i++) {
            const [p1x, p1y] = el.points[i];
            const [p2x, p2y] = el.points[i + 1];
            if (distanceToLine(x, y, p1x, p1y, p2x, p2y) < threshold) return true;
        }
        return false;
    }
    return false;
}

function distanceToLine(x, y, x1, y1, x2, y2) {
    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) param = dot / lenSq;

    let xx, yy;
    if (param < 0) {
        xx = x1; yy = y1;
    } else if (param > 1) {
        xx = x2; yy = y2;
    } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
    }
    const dx = x - xx;
    const dy = y - yy;
    return Math.sqrt(dx * dx + dy * dy);
}


// ==========================================
// MOUSE HANDLERS
// ==========================================
canvas.addEventListener('mousedown', (e) => {
    // If textInput is active, finishes handled by document listener ideally
    // But if we clicked the canvas itself, we might want to force finish if document listener didn't catch it yet (race condition?)
    // Actually, document listener is on 'mousedown' too.

    // Check if we just clicked to finalize text
    if (textInput.style.display === 'block') {
        // If we are clicking INSIDE the text box, don't do anything (editing)
        if (textInput.contains(e.target)) return;
        // If clicking outside, finishText() is called by global listener.
        // We should NOT start a new drawing action in the same click.
        return;
    }

    const pos = getPos(e);

    // 1. POINTER TOOL (MOVE)
    if (currentTool === 'pointer') {
        const idx = getElementAtPosition(pos.x, pos.y);
        if (idx !== -1) {
            selectedElementIndex = idx;
            isDraggingElement = true; // Use different flag name to avoid conflict
            dragStartPos = pos;
            // deep copy to avoid reference issues if we want to cancel? No, just copy for offset.
            // Actually, we need to know the initial position of the element to apply delta
            initialElementPos = JSON.parse(JSON.stringify(elements[idx]));
        }
        return;
    }

    // 2. TEXT TOOL
    if (currentTool === 'text') {
        // Handled by specific Logic block below or we integrate here?
        // Let's keep specific Logic block for DOM Overlay text creation
        return;
    }

    // 3. DRAWING TOOLS
    isDrawing = true;
    dragStartPos = pos;
    // Create new element structure based on tool
    if (['pen', 'highlighter'].includes(currentTool)) {
        currentElement = {
            type: currentTool,
            points: [[pos.x, pos.y]],
            color: strokeColor,
            size: lineWidth
        };
    } else if (currentTool === 'rect') {
        currentElement = { type: 'rect', x: pos.x, y: pos.y, w: 0, h: 0, color: strokeColor, size: lineWidth };
    } else if (currentTool === 'circle') {
        currentElement = { type: 'circle', cx: pos.x, cy: pos.y, r: 0, color: strokeColor, size: lineWidth };
    } else if (currentTool === 'line') {
        currentElement = { type: 'line', x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y, color: strokeColor, size: lineWidth };
    }

    render();
});

canvas.addEventListener('mousemove', (e) => {
    const pos = getPos(e);

    // 0. UPDATE CURSOR (Pointer Tool)
    if (currentTool === 'pointer' && !isDraggingElement) {
        const idx = getElementAtPosition(pos.x, pos.y);
        canvas.style.cursor = (idx !== -1) ? 'move' : 'default';
    }

    // 1. MOVING ELEMENT
    if (currentTool === 'pointer' && isDraggingElement && selectedElementIndex !== -1) {
        const dx = pos.x - dragStartPos.x;
        const dy = pos.y - dragStartPos.y;

        const el = elements[selectedElementIndex];
        const initial = initialElementPos;

        if (el.type === 'rect' || el.type === 'text') {
            el.x = initial.x + dx;
            el.y = initial.y + dy;
        } else if (el.type === 'circle') {
            el.cx = initial.cx + dx;
            el.cy = initial.cy + dy;
        } else if (el.type === 'line') {
            el.x1 = initial.x1 + dx;
            el.y1 = initial.y1 + dy;
            el.x2 = initial.x2 + dx;
            el.y2 = initial.y2 + dy;
        } else if (el.type === 'pen' || el.type === 'highlighter') {
            el.points = initial.points.map(p => [p[0] + dx, p[1] + dy]);
        }

        render();
        return;
    }

    // 2. DRAWING
    if (isDrawing && currentElement) {
        if (currentElement.type === 'pen' || currentElement.type === 'highlighter') {
            currentElement.points.push([pos.x, pos.y]);
        } else if (currentElement.type === 'rect') {
            currentElement.w = pos.x - currentElement.x;
            currentElement.h = pos.y - currentElement.y;
        } else if (currentElement.type === 'circle') {
            currentElement.r = Math.sqrt(Math.pow(pos.x - currentElement.cx, 2) + Math.pow(pos.y - currentElement.cy, 2));
        } else if (currentElement.type === 'line') {
            currentElement.x2 = pos.x;
            currentElement.y2 = pos.y;
        }
        render();
    }
});

canvas.addEventListener('mouseup', () => {
    if (currentTool === 'pointer' && isDraggingElement) {
        isDraggingElement = false;
        selectedElementIndex = -1;
        initialElementPos = null;
        saveState();
        return;
    }

    if (isDrawing && currentElement) {
        elements.push(currentElement);
        currentElement = null;
        isDrawing = false;
        saveState();
        render();
    }
});

// ==========================================
// TEXT TOOL LOGIC
// ==========================================
// We keep the DOM input for Typing, but turn it into an Object on Finish.

canvas.addEventListener('mousedown', (e) => {
    if (currentTool !== 'text') return;

    // If we are clicking while text box is open, 'finishText' (via document listener) logic 
    // runs. We need to wait or check status.
    // If display is block, we are finishing. 
    // If handled by document listener, display will be none soon.

    // Simplest approach: If textInput is visible, let the document listener handle closing it.
    // We only open NEW text if it's hidden.
    if (textInput.style.display === 'block') return;

    const wrapper = document.querySelector('.canvas-wrapper');
    const wrapperRect = wrapper.getBoundingClientRect();
    const x = e.clientX - wrapperRect.left + wrapper.scrollLeft;
    const y = e.clientY - wrapperRect.top + wrapper.scrollTop;

    textInput.style.display = 'block';

    // Position it where clicked
    // Note: textInput is in .canvas-wrapper coordinate space (relative)
    textInput.style.left = x + 'px';
    textInput.style.top = y + 'px';
    textInput.innerText = '';

    updateInputStyle();

    // Auto focus
    setTimeout(() => textInput.focus(), 0);
});

// Initial Text Creation Dragging (Before finalizing)
let isDraggingTextInput = false;
let dragInputStart = { x: 0, y: 0 };
let inputStartPos = { x: 0, y: 0 };

textInput.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    isDraggingTextInput = true;
    dragInputStart = { x: e.clientX, y: e.clientY };
    inputStartPos = {
        x: parseInt(textInput.style.left || 0),
        y: parseInt(textInput.style.top || 0)
    };
});

window.addEventListener('mousemove', (e) => {
    if (isDraggingTextInput) {
        const dx = e.clientX - dragInputStart.x;
        const dy = e.clientY - dragInputStart.y;
        textInput.style.left = (inputStartPos.x + dx) + 'px';
        textInput.style.top = (inputStartPos.y + dy) + 'px';
    }
});

window.addEventListener('mouseup', () => {
    isDraggingTextInput = false;
});

// Finalize Text
function finishText() {
    const text = textInput.innerText;
    if (!text.trim()) {
        textInput.style.display = 'none';
        return;
    }

    // Convert DOM position to Canvas position
    // DOM uses css pixels inside canvas-wrapper. 
    // Canvas might have different internal resolution if we did scaling (but here canvas.width = img.width)
    // The CSS logic: .canvas-wrapper contains canvas. 
    // The canvas is scaled via CSS? No, canvas size is set to img size.
    // CSS size might be constrained? 
    // Usually editorCanvas css width is valid.
    // Let's assume 1:1 mapping if not zoomed.
    // We need to account for canvas scaling if CSS size != attribute size.

    const rect = canvas.getBoundingClientRect();
    const domRect = textInput.getBoundingClientRect();

    // Scale factors
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Calculate relative position to canvas
    const x = (domRect.left - rect.left) * scaleX;
    const y = (domRect.top - rect.top) * scaleY;
    const w = domRect.width * scaleX;
    const h = domRect.height * scaleY;

    // Create Text Element
    const newTextEl = {
        type: 'text',
        text: text,
        x: x,
        y: y, // This is top-left
        w: w,
        h: h,
        color: strokeColor,
        fontSize: fontSize,
        fontFamily: fontFamily,
        fill: textFill,
        border: textBorder
    };

    elements.push(newTextEl);
    saveState();
    render();

    textInput.style.display = 'none';
    textInput.innerText = '';
}

// Global Listener to finish text
document.addEventListener('mousedown', (e) => {
    if (textInput.style.display === 'block') {
        if (!textInput.contains(e.target) &&
            !propertiesBar.contains(e.target) &&
            e.target !== canvas && // Canvas clicks are handled separately? No, if we click canvas we should also finish?
            !e.target.classList.contains('tool-btn')) { // Don't finalize if switching properties, but YES finalize if clicking canvas
            // Logic: if we click canvas (to start new drawing), we basically want to close this one first.
            // If we click anywhere else that is not the input itself.

            // Check if we are interacting with properties bar
            if (propertiesBar.contains(e.target)) return;

            finishText();
        }
    }
});
// Need to handle canvas click explicitly to finish text
// The canvas mousedown handler runs. 
// If we click canvas, we want to finish text. 
// Canvas mousedown first line checks.

textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        finishText();
    } else if (e.key === 'Escape') {
        textInput.style.display = 'none';
        textInput.innerText = '';
    }
});


// ==========================================
// HELPERS & TOOLS
// ==========================================
// Tool Selection
document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (btn.id.startsWith('tool-')) {
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
            if (btn.id === 'btn-undo') return;

            e.currentTarget.classList.add('active');
            currentTool = btn.id.replace('tool-', '');

            updateCursor();
            updatePropertiesBar();

            // If existing text input is open, finish it?
            if (textInput.style.display === 'block') finishText();
        }
    });
});

function updateCursor() {
    if (currentTool === 'text') {
        canvas.style.cursor = 'text';
    } else if (currentTool === 'pointer') {
        canvas.style.cursor = 'default';
    } else {
        canvas.style.cursor = 'crosshair';
    }
}

function updatePropertiesBar() {
    if (currentTool === 'pointer') {
        propertiesBar.classList.remove('visible');
    } else {
        propertiesBar.classList.add('visible');
    }

    if (currentTool === 'text') {
        propDraw.classList.remove('active-section');
        propText.classList.add('active-section');
    } else {
        propText.classList.remove('active-section');
        propDraw.classList.add('active-section');
    }
}

// Color Palette
document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', (e) => {
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
        e.target.classList.add('active');
        strokeColor = e.target.dataset.color;
        updateInputStyle();
    });
});

document.getElementById('strokeSize').addEventListener('input', (e) => {
    lineWidth = parseInt(e.target.value, 10);
});

// Text Props Listeners
document.getElementById('fontFamily').addEventListener('change', (e) => {
    fontFamily = e.target.value;
    updateInputStyle();
});
document.getElementById('textSize').addEventListener('input', (e) => {
    fontSize = parseInt(e.target.value, 10);
    updateInputStyle();
});
document.getElementById('textBg').addEventListener('change', (e) => {
    textFill = e.target.checked;
    updateInputStyle();
});
document.getElementById('textBorder').addEventListener('change', (e) => {
    textBorder = e.target.checked;
    updateInputStyle();
});

function updateInputStyle() {
    if (textInput.style.display === 'block') {
        textInput.style.color = strokeColor;
        textInput.style.fontFamily = fontFamily;
        textInput.style.fontSize = fontSize + 'px';
        if (textFill) {
            textInput.style.backgroundColor = '#ffffff';
            // Logic for contrast text?
            // textInput.style.color = strokeColor;
            // Keeping simple as per previous logic
        } else {
            textInput.style.backgroundColor = 'transparent';
        }

        if (textBorder) {
            textInput.style.border = `2px solid ${strokeColor}`;
        } else {
            textInput.style.border = '1px dashed #3b82f6';
        }
    }
}

function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
}

function isLight(color) {
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return yiq >= 128;
}

// ==========================================
// UNDO / DOWNLOAD
// ==========================================

function saveState() {
    historyStep++;
    // Remove future states if we were in middle
    if (historyStep < history.length) {
        history.length = historyStep;
    }
    // Deep copy elements
    history.push(JSON.parse(JSON.stringify(elements)));
}

document.getElementById('btn-undo').addEventListener('click', () => {
    if (historyStep > 0) {
        historyStep--;
        elements = JSON.parse(JSON.stringify(history[historyStep]));
        render();
    }
});

document.getElementById('btn-download').addEventListener('click', () => {
    // Render everything freshly
    render();
    const link = document.createElement('a');
    link.download = `annotated-${new Date().getTime()}.jpg`;
    link.href = canvas.toDataURL('image/jpeg', 0.9);
    link.click();
});

document.getElementById('btn-cancel').addEventListener('click', () => {
    window.close();
});

// ==========================================
// CONTEXT MENU / EDITING LOGIC
// ==========================================
const contextMenu = document.getElementById('context-menu');
const btnCtxEdit = document.getElementById('btn-ctx-edit');
const btnCtxDelete = document.getElementById('btn-ctx-delete');

let activeContextElementIndex = -1;

canvas.addEventListener('dblclick', (e) => {
    // Only allow context menu if in pointer mode
    if (currentTool !== 'pointer') return;

    const pos = getPos(e);
    const idx = getElementAtPosition(pos.x, pos.y);

    if (idx !== -1) {
        activeContextElementIndex = idx;
        const el = elements[idx];

        // Position Menu (convert Canvas coords to DOM coords)
        const wrapper = document.querySelector('.canvas-wrapper');
        const wrapperRect = wrapper.getBoundingClientRect();
        const rect = canvas.getBoundingClientRect();

        // This is tricky: getPos returns "Canvas Internal Scaled Coords".
        // We need Screen/DOM coords for the div.
        // e.clientX/Y is easier for fixed/absolute positioning if we use page coords?
        // But context-menu is inside canvas-wrapper (relative).
        // Let's use the event client coordinates relative to wrapper.

        const menuX = e.clientX - wrapperRect.left + wrapper.scrollLeft;
        const menuY = e.clientY - wrapperRect.top + wrapper.scrollTop;

        contextMenu.style.left = menuX + 'px';
        contextMenu.style.top = menuY + 'px';
        contextMenu.style.display = 'flex';

        // Toggle Edit Button based on type
        if (el.type === 'text') {
            btnCtxEdit.style.display = 'flex';
        } else {
            btnCtxEdit.style.display = 'none';
        }
    } else {
        hideContextMenu();
    }
});

// Hide menu when clicking elsewhere
document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target) && e.target !== canvas) {
        hideContextMenu();
    }
    // If clicking canvas (single click), also hide? 
    // Yes, usually starting a drag or clicking empty space should close it.
    if (e.target === canvas) {
        hideContextMenu();
    }
});

function hideContextMenu() {
    contextMenu.style.display = 'none';
    activeContextElementIndex = -1;
}

btnCtxDelete.addEventListener('click', () => {
    if (activeContextElementIndex !== -1) {
        elements.splice(activeContextElementIndex, 1);
        saveState();
        render();
        hideContextMenu();
    }
});

btnCtxEdit.addEventListener('click', () => {
    if (activeContextElementIndex !== -1) {
        const el = elements[activeContextElementIndex];
        if (el.type === 'text') {
            // "Edit" mode:
            // 1. Remove the text element from canvas (so it looks like we picked it up)
            elements.splice(activeContextElementIndex, 1);
            render(); // Text disappears from canvas

            // 2. Open the text box with existing content and styles
            textInput.style.display = 'block';

            // Calculate DOM position from Canvas position
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;

            // We need to invert the scaling to get back to CSS pixels
            textInput.style.left = (el.x / scaleX) + 'px';
            textInput.style.top = (el.y / scaleY) + 'px';

            // Copy styles
            textInput.innerText = el.text;
            textInput.style.color = el.color;
            textInput.style.fontFamily = el.fontFamily;
            textInput.style.fontSize = el.fontSize + 'px';

            strokeColor = el.color; // Set global state so updates work? 
            // Ideally we should sync global Toolbar state to this element too, but that's complex.
            // For now, let's just make sure the Input looks right.

            if (el.fill) {
                textInput.style.backgroundColor = '#ffffff';
                textFill = true;
            } else {
                textInput.style.backgroundColor = 'transparent';
                textFill = false;
            }

            if (el.border) {
                textInput.style.border = `2px solid ${el.color}`;
                textBorder = true;
            } else {
                textInput.style.border = '1px dashed #3b82f6';
                textBorder = false;
            }

            // Update the toolbar toggles to match (visual UX)
            document.getElementById('textBg').checked = textFill;
            document.getElementById('textBorder').checked = textBorder;
            document.getElementById('textSize').value = el.fontSize;
            document.getElementById('fontFamily').value = el.fontFamily;

            // Also need to switch to Text tool mode so completion logic works?
            // Actually, if we just show the input, the existing "mousedown" -> "finishText" logic
            // works regardless of tool, mostly. 
            // But we should probably switch tool to 'text' to be consistent.
            currentTool = 'text';
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
            document.getElementById('tool-text').classList.add('active');
            updatePropertiesBar(); // Show text properties

            setTimeout(() => {
                textInput.focus();
                // Select all text?
                const range = document.createRange();
                range.selectNodeContents(textInput);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            }, 0);

            hideContextMenu();
        }
    }
});
