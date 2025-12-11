const canvas = document.getElementById('editorCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const textInput = document.getElementById('textInput');
const propertiesBar = document.getElementById('properties-bar');
const propDraw = document.getElementById('prop-draw');
const propText = document.getElementById('prop-text');

// State
let currentTool = 'pointer';
let isDrawing = false;
let startX, startY;
let snapshot = null;
let history = [];
let historyStep = -1;
let points = [];

// Configuration
let strokeColor = '#ef4444';
let lineWidth = 4;
const highlighterAlpha = 0.4;

// Text Config
let fontSize = 24;
let fontFamily = 'sans-serif';
let textFill = false;
let textBorder = false;

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const data = await chrome.storage.local.get(['screenshotDataUrl']);
        if (data.screenshotDataUrl) {
            const img = new Image();
            img.onload = () => {
                initCanvas(img);
            };
            img.src = data.screenshotDataUrl;
        }
    } catch (e) {
        console.error('Error loading image:', e);
    }

    updateCursor();
});

function initCanvas(img) {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    saveState();
}

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
        }
    });
});

function updateCursor() {
    if (currentTool === 'text') {
        canvas.style.cursor = 'crosshair';
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

    // Toggle Sections
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

// Size Slider (Draw)
document.getElementById('strokeSize').addEventListener('input', (e) => {
    lineWidth = parseInt(e.target.value, 10);
});

// Text Props
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
        textInput.style.backgroundColor = textFill ? (isLight(strokeColor) ? '#000' : '#fff') : 'transparent'; // Contrast bg
        if (textFill) textInput.style.color = isLight(strokeColor) ? '#fff' : '#000'; // Contrast text if fill
        else textInput.style.color = strokeColor;

        textInput.style.border = textBorder ? `2px solid ${strokeColor}` : '1px dashed #3b82f6';

        // If fill is on, we actually want the background to be the stroke color, and text to be white/black
        // But users usually want colored text. Let's assume Fill = Yellow/White bg box.
        // Simplified Logic: 
        // Fill = White Background, Colored Text (Post-it style)
        if (textFill) {
            textInput.style.backgroundColor = '#ffffff';
            textInput.style.color = strokeColor;
        } else {
            textInput.style.backgroundColor = 'transparent';
        }
    }
}

// Helper for contrast
function isLight(color) {
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return yiq >= 128;
}

// Drawing Logic
canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseout', stopDrawing);

function startDrawing(e) {
    if (currentTool === 'pointer' || currentTool === 'text') return;

    isDrawing = true;
    const pos = getPos(e);
    startX = pos.x;
    startY = pos.y;
    points = [[startX, startY]];

    snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);

    if (currentTool === 'pen' || currentTool === 'highlighter') {
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(startX, startY);
        setupContext();
        ctx.stroke();
    }
}

function draw(e) {
    if (!isDrawing) return;
    const pos = getPos(e);

    ctx.putImageData(snapshot, 0, 0);
    setupContext();

    if (currentTool === 'pen' || currentTool === 'highlighter') {
        points.push([pos.x, pos.y]);

        ctx.beginPath();
        if (points.length < 3) {
            const b = points[0];
            ctx.moveTo(b[0], b[1]);
            ctx.lineTo(points[points.length - 1][0], points[points.length - 1][1]);
        } else {
            ctx.moveTo(points[0][0], points[0][1]);
            for (let i = 1; i < points.length - 2; i++) {
                const xc = (points[i][0] + points[i + 1][0]) / 2;
                const yc = (points[i][1] + points[i + 1][1]) / 2;
                ctx.quadraticCurveTo(points[i][0], points[i][1], xc, yc);
            }
            ctx.quadraticCurveTo(
                points[points.length - 2][0],
                points[points.length - 2][1],
                points[points.length - 1][0],
                points[points.length - 1][1]
            );
        }
        ctx.stroke();

    } else {
        ctx.beginPath();
        if (currentTool === 'line') {
            drawArrow(ctx, startX, startY, pos.x, pos.y);
        } else if (currentTool === 'rect') {
            ctx.strokeRect(startX, startY, pos.x - startX, pos.y - startY);
        } else if (currentTool === 'circle') {
            const r = Math.sqrt(Math.pow(pos.x - startX, 2) + Math.pow(pos.y - startY, 2));
            ctx.arc(startX, startY, r, 0, 2 * Math.PI);
            ctx.stroke();
        }
    }
}

function stopDrawing() {
    if (!isDrawing) return;
    isDrawing = false;
    saveState();
}

function setupContext() {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (currentTool === 'highlighter') {
        ctx.globalAlpha = highlighterAlpha;
        ctx.lineWidth = lineWidth * 4;
        ctx.strokeStyle = strokeColor;
    } else {
        ctx.globalAlpha = 1.0;
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = strokeColor;
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

function drawArrow(ctx, fromX, fromY, toX, toY) {
    const headLength = 10 + lineWidth * 1.5;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const angle = Math.atan2(dy, dx);

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

// =========================================================
// TEXT TOOL LOGIC (NEW)
// =========================================================

// Text Tool Logic
canvas.addEventListener('mousedown', (e) => {
    if (currentTool !== 'text') return;

    // If text box is already open, we might be finalizing it via document click.
    // But if we click the canvas, we want to finalize current AND start new.

    if (textInput.style.display === 'block') {
        finishText();
        // Fall through to create new one below
    }

    const wrapper = document.querySelector('.canvas-wrapper');
    const wrapperRect = wrapper.getBoundingClientRect();

    // Calculate position taking into account scroll
    const x = e.clientX - wrapperRect.left + wrapper.scrollLeft;
    const y = e.clientY - wrapperRect.top + wrapper.scrollTop;

    textInput.style.display = 'block';
    textInput.style.left = x + 'px';
    textInput.style.top = y + 'px';
    textInput.innerText = '';

    updateInputStyle();

    // Auto focus
    setTimeout(() => textInput.focus(), 0);
});

// Draggable Logic for Text Input
let isDraggingText = false;
let dragStartX, dragStartY;
let elementStartX, elementStartY;

textInput.addEventListener('mousedown', (e) => {
    e.stopPropagation(); // Prevent bubbling to canvas/document
    isDraggingText = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    elementStartX = parseInt(textInput.style.left || 0);
    elementStartY = parseInt(textInput.style.top || 0);
});

window.addEventListener('mousemove', (e) => {
    if (isDraggingText) {
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        textInput.style.left = (elementStartX + dx) + 'px';
        textInput.style.top = (elementStartY + dy) + 'px';
    }
});

window.addEventListener('mouseup', () => {
    isDraggingText = false;
});

// Refocus helper for property changes
function checkRefocus() {
    if (textInput.style.display === 'block') {
        textInput.focus();
    }
}

// Add listeners to properties to prevent focus loss or restore it
document.getElementById('fontFamily').addEventListener('change', checkRefocus);
document.getElementById('textSize').addEventListener('input', checkRefocus);
document.getElementById('textSize').addEventListener('change', checkRefocus);
document.querySelectorAll('.color-swatch').forEach(s => {
    s.addEventListener('click', () => setTimeout(checkRefocus, 50)); // Delay for click processing
});

// Document click to finalize (if clicking outside)
document.addEventListener('mousedown', (e) => {
    if (textInput.style.display === 'block') {
        // If clicking outside textInput AND not on properties controls
        // AND NOT on the canvas (canvas handles its own restart logic)
        if (!textInput.contains(e.target) &&
            !propertiesBar.contains(e.target) &&
            e.target !== canvas) {

            finishText();
        }
    }
});

textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        finishText();
    } else if (e.key === 'Escape') {
        textInput.style.display = 'none';
        textInput.innerText = '';
    }
});

function finishText() {
    const text = textInput.innerText;
    if (!text.trim()) {
        textInput.style.display = 'none';
        return;
    }

    // Check if we switched tools (e.g. via toolbar click)
    // The previous tool logic might have already run? No.

    // We need to render the text. 
    // Wait, if users clicked "Undo" or "Pen", currentTool changes?
    // This function runs on mousedown. The 'click' on toolbar fires LATER.
    // So currentTool is still 'text' (mostly).

    const rect = canvas.getBoundingClientRect();
    const domRect = textInput.getBoundingClientRect();

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (domRect.left - rect.left) * scaleX;
    const y = (domRect.top - rect.top) * scaleY;
    const w = domRect.width * scaleX;
    const h = domRect.height * scaleY;

    ctx.save();

    // Background
    if (textFill) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, w, h);
    }

    // Border
    if (textBorder) {
        ctx.lineWidth = 2; // Fixed border width
        ctx.strokeStyle = strokeColor;
        ctx.strokeRect(x, y, w, h);
    }

    // Text
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = strokeColor;

    const padding = 8 * scaleX;
    const lines = text.split('\n');
    const lineHeight = fontSize * 1.2;

    lines.forEach((line, index) => {
        ctx.fillText(line, x + padding, y + padding + (index * lineHeight));
    });

    ctx.restore();

    saveState();
    textInput.style.display = 'none';
    textInput.innerText = '';
}

// Undo
document.getElementById('btn-undo').addEventListener('click', () => {
    if (historyStep > 0) {
        historyStep--;
        const img = new Image();
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
        };
        img.src = history[historyStep];
    }
});

function saveState() {
    historyStep++;
    if (historyStep < history.length) {
        history.length = historyStep;
    }
    history.push(canvas.toDataURL());
}

document.getElementById('btn-download').addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = `annotated-${new Date().getTime()}.jpg`;
    link.href = canvas.toDataURL('image/jpeg', 0.9);
    link.click();
});

document.getElementById('btn-cancel').addEventListener('click', () => {
    window.close();
});
