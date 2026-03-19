let panels = [];
let projectorWindow = null;
let selectedPanelId = null;
let projectorOpenState = false;

// --- HOT CONTROL STATE ---
let activeHotSlot = null;
const hotControls = Array.from({ length: 10 }, () => ({
    type: 'fast_in_fade_out',
    lastTrigger: 0,
    isHeld: false,
    speed: 1.0,
    toggledOn: false
}));

const previewCanvas = document.getElementById('preview-canvas');
const container = document.getElementById('preview-container');
const ctx = previewCanvas.getContext('2d');
const inputW = document.getElementById('proj-w');
const inputH = document.getElementById('proj-h');


// --- WORKFLOW STATES ---
let snapToGrid = false;
let snapToPanels = false;

// Top Toolbar Listeners
document.getElementById('btn-snap-grid').onclick = (e) => {
    snapToGrid = !snapToGrid;
    e.target.innerText = `Grid Snap: ${snapToGrid ? 'ON' : 'OFF'}`;
    e.target.style.backgroundColor = snapToGrid ? '#28a745' : '#444';
};

document.getElementById('btn-snap-panels').onclick = (e) => {
    snapToPanels = !snapToPanels;
    e.target.innerText = `Panel Snap: ${snapToPanels ? 'ON' : 'OFF'}`;
    e.target.style.backgroundColor = snapToPanels ? '#28a745' : '#444';
};

document.getElementById('btn-fullscreen-panel').onclick = () => {
    const activePanel = panels.find(p => p.id === selectedPanelId);
    if (!activePanel) {
        alert("Please select a panel first!");
        return;
    }
    activePanel.points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    renderHandles();
};


// --- UTILS ---
function getRandomColor() { return `hsla(${Math.floor(Math.random() * 360)}, 70%, 60%, 1)`; }

function colorToHex(color) {
    const temp = document.createElement('div');
    temp.style.color = color;
    document.body.appendChild(temp);
    const rgb = window.getComputedStyle(temp).color;
    document.body.removeChild(temp);
    const rgbValues = (rgb.match(/\d+/g) || [0, 0, 0]).map(Number);
    return "#" + rgbValues.slice(0, 3).map(x => x.toString(16).padStart(2, '0')).join('');
}

function getRes() { return { w: parseInt(inputW.value) || 1920, h: parseInt(inputH.value) || 1080 }; }

function syncPreviewBox() {
    const res = getRes();
    const ratio = res.w / res.h;
    previewCanvas.width = res.w;
    previewCanvas.height = res.h;


    const maxWidth = Math.min(window.innerWidth - 350, 800);
    container.style.width = maxWidth + "px";
    container.style.height = (maxWidth / ratio) + "px";
}

function drawImagePerspective(ctx, img, pts) {
    const w = img.width;
    const h = img.height;

    // calculate the homography matrix
    const dx1 = pts[1].x - pts[2].x;
    const dx2 = pts[3].x - pts[2].x;
    const dy1 = pts[1].y - pts[2].y;
    const dy2 = pts[3].y - pts[2].y;
    const sumX = pts[0].x - pts[1].x + pts[2].x - pts[3].x;
    const sumY = pts[0].y - pts[1].y + pts[2].y - pts[3].y;

    let g = 0, h_val = 0;
    const det = dx1 * dy2 - dx2 * dy1;
    if (det !== 0) {
        g = (sumX * dy2 - sumY * dx2) / det;
        h_val = (dx1 * sumY - dy1 * sumX) / det;
    }

    const a = pts[1].x - pts[0].x + g * pts[1].x;
    const b = pts[3].x - pts[0].x + h_val * pts[3].x;
    const c = pts[0].x;
    const d = pts[1].y - pts[0].y + g * pts[1].y;
    const e = pts[3].y - pts[0].y + h_val * pts[3].y;
    const f = pts[0].y;

    // project a 0-1 texture coordinate to a screen coordinate
    const project = (u, v) => {
        const W = g * u + h_val * v + 1;
        return { x: (a * u + b * v + c) / W, y: (d * u + e * v + f) / W };
    };

    // affine triangle
    const drawTriangle = (p0, p1, p2, t0, t1, t2) => {
        ctx.save();
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.closePath(); ctx.clip();
        const delta = t0.u * (t1.v - t2.v) - t1.u * (t0.v - t2.v) + t2.u * (t0.v - t1.v);
        if (delta !== 0) {
            const ma = (p0.x * (t1.v - t2.v) - p1.x * (t0.v - t2.v) + p2.x * (t0.v - t1.v)) / delta;
            const mb = (p0.y * (t1.v - t2.v) - p1.y * (t0.v - t2.v) + p2.y * (t0.v - t1.v)) / delta;
            const mc = (t0.u * (p1.x - p2.x) - t1.u * (p0.x - p2.x) + t2.u * (p0.x - p1.x)) / delta;
            const md = (t0.u * (p1.y - p2.y) - t1.u * (p0.y - p2.y) + t2.u * (p0.y - p1.y)) / delta;
            const me = (p0.x * (t1.u * t2.v - t2.u * t1.v) - p1.x * (t0.u * t2.v - t2.u * t0.v) + p2.x * (t0.u * t1.v - t1.u * t0.v)) / delta;
            const mf = (p0.y * (t1.u * t2.v - t2.u * t1.v) - p1.y * (t0.u * t2.v - t2.u * t0.v) + p2.y * (t0.u * t1.v - t1.u * t0.v)) / delta;
            ctx.transform(ma, mb, mc, md, me, mf);
            ctx.drawImage(img, 0, 0);
            ctx.drawImage(img, 0, 0); // remove anti-aliasing seams
        }
        ctx.restore();
    };

    const grid = 10;
    for (let row = 0; row < grid; row++) {
        for (let col = 0; col < grid; col++) {
            const u0 = col / grid, v0 = row / grid;
            const u1 = (col + 1) / grid, v1 = (row + 1) / grid;

            const p00 = project(u0, v0), p10 = project(u1, v0), p11 = project(u1, v1), p01 = project(u0, v1);
            const t00 = { u: u0 * w, v: v0 * h }, t10 = { u: u1 * w, v: v0 * h };
            const t11 = { u: u1 * w, v: v1 * h }, t01 = { u: u0 * w, v: v1 * h };

            drawTriangle(p00, p10, p01, t00, t10, t01);
            drawTriangle(p10, p11, p01, t10, t11, t01);
        }
    }
}


function syncUIColors() {
    const activePanel = panels.find(p => p.id === selectedPanelId);
    const fullscreenBtn = document.getElementById('btn-fullscreen-panel');

    if (activePanel) {
        fullscreenBtn.style.backgroundColor = activePanel.color;
    } else {
        fullscreenBtn.style.backgroundColor = 'var(--primary)';
    }
}


// --- OFF-SCREEN TEXT GENERATOR ---
function updateTextCanvas(panel) {
    if (!panel.textCanvas) {
        panel.textCanvas = document.createElement('canvas');
        panel.textCanvas.width = 1000;
        panel.textCanvas.height = 1000;
    }
    const tCtx = panel.textCanvas.getContext('2d');
    const cw = panel.textCanvas.width;
    const ch = panel.textCanvas.height;

    tCtx.clearRect(0, 0, cw, ch);
    tCtx.fillStyle = panel.color;
    tCtx.textAlign = "center";
    tCtx.textBaseline = "middle";

    let fontSize = 300;
    tCtx.font = `bold ${fontSize}px Arial`;
    let metrics = tCtx.measureText(panel.text);

    if (metrics.width > cw * 0.9) {
        fontSize = fontSize * ((cw * 0.9) / metrics.width);
        tCtx.font = `bold ${fontSize}px Arial`;
    }

    tCtx.fillText(panel.text, cw / 2, ch / 2);
}

window.addEventListener('resize', syncPreviewBox);
[inputW, inputH].forEach(el => {
    el.addEventListener('input', function() {
        if (parseInt(this.value) > 9999) {
            this.value = 9999;
        }
    });

    el.addEventListener('change', syncPreviewBox);
});syncPreviewBox();

// --- KEYBOARD LISTENERS ---
window.addEventListener('keydown', (e) => {
    const key = parseInt(e.key);
    if (key >= 1 && key <= 9 && !hotControls[key].isHeld) {
        hotControls[key].isHeld = true;
        hotControls[key].lastTrigger = performance.now();

        if (hotControls[key].type === 'toggle_visibility') {
            hotControls[key].toggledOn = !hotControls[key].toggledOn;
        }

        updateHotUI();
    }
});

window.addEventListener('keyup', (e) => {
    const key = parseInt(e.key);
    if (key >= 1 && key <= 9) {
        hotControls[key].isHeld = false;
        updateHotUI();
    }
});

function updateHotUI() {
    for (let i = 1; i <= 9; i++) {
        const slotEl = document.querySelector(`[data-slot="${i}"]`);
        if (slotEl) {
            // visual feedback based on control type
            if (hotControls[i].type === 'toggle_visibility') {
                slotEl.classList.toggle('trigger-active', hotControls[i].toggledOn);
            } else {
                slotEl.classList.toggle('trigger-active', hotControls[i].isHeld);
            }
        }
    }
}

// --- HOT CONTROL UI SETUP ---
const hotGrid = document.getElementById('hot-grid');
for (let i = 1; i <= 9; i++) {
    const slot = document.createElement('div');
    slot.className = 'hot-slot';
    slot.innerText = i;
    slot.dataset.slot = i;
    slot.onclick = () => {
        activeHotSlot = i;
        document.querySelectorAll('.hot-slot').forEach(s => s.classList.remove('active-config'));
        slot.classList.add('active-config');
        document.getElementById('hot-config-panel').style.display = 'block';
        document.getElementById('config-label').innerText = `Config Slot ${i}`;
        document.getElementById('hot-anim-type').value = hotControls[i].type;

        let speedSlider = document.getElementById('hot-speed-input');
        if (speedSlider) {
            speedSlider.value = hotControls[i].speed;
        } else {
            const speedControls = document.createElement('div');
            speedControls.id = 'hot-speed-container';
            speedControls.style.marginTop = '10px';
            speedControls.innerHTML = `<label style="font-size:11px; color:#aaa; display:block; margin-bottom:5px;">Hotkey Speed/Decay</label>
                                       <input type="range" id="hot-speed-input" min="0.1" max="5.0" step="0.1" value="${hotControls[i].speed}">`;
            document.getElementById('hot-config-panel').appendChild(speedControls);

            document.getElementById('hot-speed-input').oninput = (ev) => {
                if (activeHotSlot) hotControls[activeHotSlot].speed = parseFloat(ev.target.value);
            };
        }
    };
    hotGrid.appendChild(slot);
}

const hotAnimSelect = document.getElementById('hot-anim-type');
if (!hotAnimSelect.querySelector('option[value="toggle_visibility"]')) {
    const newOption = document.createElement('option');
    newOption.value = 'toggle_visibility';
    newOption.text = 'Toggle Visibility';
    hotAnimSelect.appendChild(newOption);
}

hotAnimSelect.onchange = (e) => {
    if (activeHotSlot) {
        hotControls[activeHotSlot].type = e.target.value;
        hotControls[activeHotSlot].toggledOn = false;
        updateHotUI();
    }
};

// --- PANEL MANAGEMENT ---
document.getElementById('add-panel').addEventListener('click', () => {
    const id = Date.now();
    const newPanel = {
        id: id,
        name: `Panel ${panels.length + 1}`,
        color: getRandomColor(),
        effect: 'solid',
        opacityEffect: 'visible',
        speed: 1.0,
        size: 1.0,
        image: null,
        text: 'TEXT',
        textCanvas: null,
        points: [{ x: 0.3, y: 0.3 }, { x: 0.6, y: 0.3 }, { x: 0.6, y: 0.6 }, { x: 0.3, y: 0.6 }]
    };
    panels.push(newPanel);
    updateTextCanvas(newPanel);
    selectPanel(id);
});

function selectPanel(id) {
    selectedPanelId = id;
    renderLayerList();
    renderHandles();
    updateEffectButtons();
    updateFillButtons();
    renderEffectControls();
    syncUIColors();
}

function renderLayerList() {
    const list = document.getElementById('layer-list');
    list.innerHTML = '';
    panels.forEach((p, index) => {
        const item = document.createElement('div');
        item.className = `panel-item ${p.id === selectedPanelId ? 'selected' : ''}`;

        const swatch = document.createElement('div');
        swatch.className = 'color-swatch';
        swatch.style.backgroundColor = p.color;
        swatch.innerText = index + 1;

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.className = 'color-picker-hidden';
        colorInput.value = colorToHex(p.color);

        colorInput.oninput = (e) => {
            p.color = e.target.value;
            swatch.style.backgroundColor = p.color;
            updateTextCanvas(p);
            renderHandles();

            if (p.id === selectedPanelId) {
                updateFillButtons();
                updateEffectButtons();
                syncUIColors();
            }
        };
        swatch.onclick = (e) => { e.stopPropagation(); colorInput.click(); };

        const nameWrapper = document.createElement('div');
        nameWrapper.className = 'name-wrapper';
        nameWrapper.setAttribute('data-value', p.name);
        const nameInput = document.createElement('input');
        nameInput.className = 'panel-name-input';
        nameInput.value = p.name;
        nameInput.oninput = (e) => { p.name = e.target.value; nameWrapper.setAttribute('data-value', e.target.value); };
        nameInput.onclick = (e) => e.stopPropagation();
        nameWrapper.appendChild(nameInput);

        const delBtn = document.createElement('button');
        delBtn.className = 'delete-btn';
        delBtn.innerHTML = '×';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            panels = panels.filter(pan => pan.id !== p.id);
            if (selectedPanelId === p.id) selectedPanelId = null;
            selectPanel(selectedPanelId);
        };

        item.onclick = () => selectPanel(p.id);
        item.append(swatch, colorInput, nameWrapper, delBtn);
        list.appendChild(item);
    });
}

function renderEffectControls() {
    const container = document.getElementById('effect-controls-container');
    const activePanel = panels.find(p => p.id === selectedPanelId);
    if (!activePanel) { container.innerHTML = ''; return; }

    if (activePanel.size === undefined) activePanel.size = 1.0;

    container.innerHTML = `
        <div class="control-group" style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
            <label style="width: 45px; font-size:12px;">Speed</label>
            <input type="range" id="eff-speed" min="0.1" max="5.0" step="0.1" value="${activePanel.speed}">
        </div>
        <div class="control-group" style="display:flex; align-items:center; gap:10px;">
            <label style="width: 45px; font-size:12px;">Size</label>
            <input type="range" id="eff-size" min="0.1" max="5.0" step="0.1" value="${activePanel.size}">
        </div>
    `;

    document.getElementById('eff-speed').oninput = (e) => activePanel.speed = parseFloat(e.target.value);
    document.getElementById('eff-size').oninput = (e) => activePanel.size = parseFloat(e.target.value);
}

function updateEffectButtons() {
    const activePanel = panels.find(p => p.id === selectedPanelId);

    if (!activePanel) {
        document.querySelectorAll('#opacity-effects .effect-btn').forEach(btn => {
            btn.classList.remove('active');
            btn.style.backgroundColor = '';
        });
        return;
    }

    document.querySelectorAll('#opacity-effects .effect-btn').forEach(btn => {
        const isActive = activePanel.opacityEffect === btn.dataset.effect;
        btn.classList.toggle('active', isActive);

        btn.style.backgroundColor = isActive ? activePanel.color : '';

        btn.onclick = () => {
            activePanel.opacityEffect = btn.dataset.effect;
            updateEffectButtons();
            renderEffectControls();
        };
    });
}

const textInputField = document.getElementById('text-input-field');
if (textInputField) {
    textInputField.addEventListener('input', (e) => {
        const activePanel = panels.find(p => p.id === selectedPanelId);
        if (activePanel) {
            activePanel.text = e.target.value.toUpperCase();
            updateTextCanvas(activePanel);
        }
    });
}

function updateFillButtons() {
    const uploadBtn = document.getElementById('upload-image-btn');
    const textInput = document.getElementById('text-input-field');
    const activePanel = panels.find(p => p.id === selectedPanelId);

    // clear colors if no panel is selected
    if (!activePanel) {
        uploadBtn.style.display = 'none';
        if (textInput) textInput.style.display = 'none';
        document.querySelectorAll('#fill-effects .fill-btn').forEach(btn => {
            btn.classList.remove('active');
            btn.style.backgroundColor = '';
        });
        return;
    }

    // toggle show/hide image UI
    uploadBtn.style.display = (activePanel.effect === 'image') ? 'block' : 'none';

    // toggle show/hide texdt UI
    if (textInput) {
        textInput.style.display = (activePanel.effect === 'text') ? 'block' : 'none';
        textInput.value = activePanel.text;
    }

    document.querySelectorAll('#fill-effects .fill-btn').forEach(btn => {
        const isActive = activePanel.effect === btn.dataset.effect;
        btn.classList.toggle('active', isActive);

        btn.style.backgroundColor = isActive ? activePanel.color : '';

        btn.onclick = () => {
            activePanel.effect = btn.dataset.effect;
            updateFillButtons();
            renderEffectControls();
        };
    });
}

function renderHandles() {
    document.querySelectorAll('.handle, .center-drag').forEach(h => h.remove());
    const activePanel = panels.find(p => p.id === selectedPanelId);
    if (!activePanel) return;

    const setupDrag = (targetPoints) => (e) => {
        e.preventDefault();
        let lastX = e.clientX, lastY = e.clientY;

        // hidden precision state to prevent "snap drift"
        let exactPoints = targetPoints.map(p => ({ x: p.x, y: p.y }));

        document.onmousemove = (me) => {
            const rect = container.getBoundingClientRect();
            const sens = me.shiftKey ? 0.1 : 1.0;
            const dx = ((me.clientX - lastX) / rect.width) * sens;
            const dy = ((me.clientY - lastY) / rect.height) * sens;

            const oldPositions = targetPoints.map(p => ({ x: p.x, y: p.y }));

            exactPoints.forEach(p => { p.x += dx; p.y += dy; });

            targetPoints.forEach((p, i) => { p.x = exactPoints[i].x; p.y = exactPoints[i].y; });

            if (snapToGrid) {
                targetPoints.forEach(p => {
                    p.x = Math.round(p.x * 40) / 40;
                    p.y = Math.round(p.y * 40) / 40;
                });
            }

            if (snapToPanels && targetPoints.length === 1) {
                const pt = targetPoints[0];
                let closest = null;
                let minDist = 0.03; // Magnetic snapping lock radius (todo: allow user to change later)

                panels.forEach(pan => {
                    if (pan.id === activePanel.id) return; // dont snap to itself
                    pan.points.forEach(opt => {
                        const dist = Math.hypot(pt.x - opt.x, pt.y - opt.y);
                        if (dist < minDist) { minDist = dist; closest = opt; }
                    });
                });
                if (closest) { pt.x = closest.x; pt.y = closest.y; }
            }

            // convecxity check
            if (typeof isConvex === 'function' && !isConvex(activePanel.points)) {
                targetPoints.forEach((p, i) => { p.x = oldPositions[i].x; p.y = oldPositions[i].y; });
                exactPoints.forEach((p, i) => { p.x = oldPositions[i].x; p.y = oldPositions[i].y; });
            }

            lastX = me.clientX; lastY = me.clientY;
            renderHandles();
        };
        document.onmouseup = () => document.onmousemove = null;
    };

    const center = document.createElement('div');
    center.className = 'center-drag';
    center.onmousedown = setupDrag(activePanel.points);
    container.appendChild(center);

    activePanel.points.forEach((p) => {
        const h = document.createElement('div');
        h.className = 'handle';
        h.style.backgroundColor = activePanel.color;
        h.style.left = (p.x * 100) + '%';
        h.style.top = (p.y * 100) + '%';
        h.onmousedown = setupDrag([p]);
        container.appendChild(h);
    });

    const avg = activePanel.points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    center.style.left = (avg.x / activePanel.points.length * 100) + '%';
    center.style.top = (avg.y / activePanel.points.length * 100) + '%';
}

// --- MEDIA / IMAGE UPLOAD LOGIC ---
document.getElementById('upload-image-btn').addEventListener('click', () => {
    if (!selectedPanelId) {
        alert("Please select a panel first!");
        return;
    }
    document.getElementById('image-loader').click();
});

document.getElementById('image-loader').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file || !selectedPanelId) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            const activePanel = panels.find(p => p.id === selectedPanelId);
            if (activePanel) {
                activePanel.image = img;          // save image to panel
                activePanel.effect = 'image';     // auto switch fill effect to image
                updateFillButtons();
            }
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);

    e.target.value = '';
});

// --- PERSPECTIVE DRAWING ENGINE ---
function draw(tCtx, w, h, isPreview) {
    tCtx.clearRect(0, 0, w, h);
    const time = performance.now();

    panels.forEach((p, index) => {
        const isSel = p.id === selectedPanelId;
        const pts = p.points;
        const path = new Path2D();
        path.moveTo(pts[0].x * w, pts[0].y * h);
        pts.forEach(pt => path.lineTo(pt.x * w, pt.y * h));
        path.closePath();

        let opacity = 1.0;

        if (p.opacityEffect === 'hidden') {
            opacity = 0.0;
        } else if (p.opacityEffect === 'strobe') {
            opacity = (Math.floor(time / (100 / p.speed)) % 2 === 0) ? 1.0 : 0.0;
        } else if (p.opacityEffect === 'breathe') {
            opacity = (Math.sin(time * 0.002 * p.speed) + 1) / 2;
        } else if (p.opacityEffect === 'hot_control') {
            const slotIdx = index + 1;
            if (slotIdx <= 9) {
                const hot = hotControls[slotIdx];
                const elapsed = (time - hot.lastTrigger) / 1000;

                if (hot.type === 'fast_in_fade_out') opacity = Math.max(0, 1 - (elapsed * hot.speed));
                else if (hot.type === 'fast_in_fast_out') opacity = (elapsed < 0.1) ? 1.0 : 0.0;
                else if (hot.type === 'hold_solid') opacity = hot.isHeld ? 1.0 : 0.0;
                else if (hot.type === 'hold_strobe') opacity = (hot.isHeld && Math.floor(time / (100 / hot.speed)) % 2 === 0) ? 1.0 : 0.0;
                else if (hot.type === 'toggle_visibility') opacity = hot.toggledOn ? 1.0 : 0.0;
            } else {
                opacity = 0;
            }
        }

        tCtx.save();

        const baseAlpha = isPreview ? Math.max(0.15, opacity) : opacity;
        tCtx.globalAlpha = baseAlpha;

        if (baseAlpha > 0) {
            if (p.effect === 'scan_bar') {
                tCtx.save();
                tCtx.clip(path);
                const bounce = (Math.sin(time * 0.002 * p.speed) + 1) / 2;
                tCtx.strokeStyle = p.color;
                tCtx.lineWidth = 15 * (p.size || 1.0);
                tCtx.beginPath();
                const x1 = pts[0].x + (pts[1].x - pts[0].x) * bounce;
                const y1 = pts[0].y + (pts[1].y - pts[0].y) * bounce;
                const x2 = pts[3].x + (pts[2].x - pts[3].x) * bounce;
                const y2 = pts[3].y + (pts[2].y - pts[3].y) * bounce;
                tCtx.moveTo(x1 * w, y1 * h);
                tCtx.lineTo(x2 * w, y2 * h);
                tCtx.stroke();
                tCtx.restore();

            } else if (p.effect === 'grid') {
                tCtx.save();
                tCtx.strokeStyle = p.color;
                tCtx.lineWidth = 1;
                tCtx.globalAlpha = baseAlpha * 0.5;
                tCtx.stroke(path);
                tCtx.clip(path);

                const subdivisions = Math.max(2, Math.floor(10 / (p.size || 1.0)));
                const len = pts.length;

                for (let i = 1; i < subdivisions; i++) {
                    const ratio = i / subdivisions;
                    if (len >= 4) {
                        const startA = pts[0], endA = pts[1];
                        const startB = pts[3], endB = pts[2];
                        const p1 = { x: (startA.x + (endA.x - startA.x) * ratio) * w, y: (startA.y + (endA.y - startA.y) * ratio) * h };
                        const p2 = { x: (startB.x + (endB.x - startB.x) * ratio) * w, y: (startB.y + (endB.y - startB.y) * ratio) * h };
                        tCtx.beginPath(); tCtx.moveTo(p1.x, p1.y); tCtx.lineTo(p2.x, p2.y); tCtx.stroke();

                        const p3 = { x: (startA.x + (startB.x - startA.x) * ratio) * w, y: (startA.y + (startB.y - startA.y) * ratio) * h };
                        const p4 = { x: (endA.x + (endB.x - endA.x) * ratio) * w, y: (endA.y + (endB.y - endA.y) * ratio) * h };
                        tCtx.beginPath(); tCtx.moveTo(p3.x, p3.y); tCtx.lineTo(p4.x, p4.y); tCtx.stroke();
                    } else if (len === 3) {
                        const pSide = { x: (pts[1].x + (pts[2].x - pts[1].x) * ratio) * w, y: (pts[1].y + (pts[2].y - pts[1].y) * ratio) * h };
                        tCtx.beginPath(); tCtx.moveTo(pts[0].x * w, pts[0].y * h); tCtx.lineTo(pSide.x, pSide.y); tCtx.stroke();
                    }
                }
                tCtx.restore();

            } else if (p.effect === 'ripple') {
                const count = 5;
                const avg = pts.reduce((acc, pt) => ({ x: acc.x + pt.x, y: acc.y + pt.y }), { x: 0, y: 0 });
                const cx = (avg.x / pts.length) * w;
                const cy = (avg.y / pts.length) * h;

                tCtx.save();
                tCtx.clip(path);

                for (let i = 0; i < count; i++) {
                    const speed = p.speed || 1.0;
                    const off = ((time * 0.001 * speed + i / count) % 1);
                    const scale = 1 - off;

                    tCtx.save();
                    tCtx.translate(cx, cy);
                    tCtx.scale(scale, scale);
                    tCtx.translate(-cx, -cy);

                    tCtx.strokeStyle = p.color;
                    tCtx.lineWidth = (3 / Math.max(0.1, scale)) * (p.size || 1.0);
                    tCtx.globalAlpha = baseAlpha * scale;
                    tCtx.stroke(path);
                    tCtx.restore();
                }
                tCtx.restore();

            } else if (p.effect === 'laser_fan') {
                tCtx.save();
                tCtx.clip(path);

                const avg = pts.reduce((acc, pt) => ({ x: acc.x + pt.x, y: acc.y + pt.y }), { x: 0, y: 0 });
                const originX = (avg.x / pts.length) * w;
                const originY = (Math.max(...pts.map(pt => pt.y))) * h;

                tCtx.fillStyle = 'rgba(0, 0, 0, 0)';
                tCtx.fill(path);

                tCtx.globalCompositeOperation = 'screen';
                const numLasers = 7;

                for(let i = 0; i < numLasers; i++) {
                    const phase = (time * 0.002 * p.speed) + (i * 0.5);
                    const angle = Math.sin(phase) * 1.5 - (Math.PI / 2);

                    tCtx.beginPath();
                    tCtx.moveTo(originX, originY);
                    tCtx.lineTo(originX + Math.cos(angle) * (w + h), originY + Math.sin(angle) * (w + h));

                    tCtx.lineWidth = 6 * (p.size || 1.0);

                    tCtx.strokeStyle = p.color;

                    tCtx.shadowBlur = 15;
                    tCtx.shadowBlur = 15 * (p.size || 1.0);
                    tCtx.stroke();
                }
                tCtx.restore();

            } else if (p.effect === 'hyperspace') {
                tCtx.save();
                tCtx.clip(path);

                const avg = pts.reduce((acc, pt) => ({ x: acc.x + pt.x, y: acc.y + pt.y }), { x: 0, y: 0 });
                const cx = (avg.x / pts.length) * w;
                const cy = (avg.y / pts.length) * h;
                const maxDist = Math.max(w, h);

                for (let i = 0; i < 100; i++) {
                    const angle = i * 137.5 * (Math.PI / 180);

                    let rawDist = ((time * 0.5 * p.speed + (i * 40)) % 1000) / 1000;
                    const r = (rawDist * rawDist) * maxDist;

                    const starX = cx + Math.cos(angle) * r;
                    const starY = cy + Math.sin(angle) * r;

                    const size = Math.max(5, rawDist * 12) * (p.size || 1.0);

                    tCtx.fillStyle = p.color;
                    tCtx.beginPath();
                    tCtx.ellipse(starX, starY, size * 2, size * 0.5, angle, 0, Math.PI * 2);
                    tCtx.fill();
                }
                tCtx.restore();

            } else if (p.effect === 'dj_wash') {
                tCtx.save();
                tCtx.clip(path);

                tCtx.globalCompositeOperation = 'lighter';

                for(let i = 0; i < 3; i++) {
                    const offset = i * 2000;
                    const lx = (w / 2) + Math.sin(time * 0.001 * p.speed + offset) * (w / 2);
                    const ly = (h / 2) + Math.cos(time * 0.0013 * p.speed + offset) * (h / 2);

                    const grad = tCtx.createRadialGradient(lx, ly, 0, lx, ly, w / 1.5);

                    tCtx.globalAlpha = baseAlpha * 0.8;
                    grad.addColorStop(0, p.color);
                    grad.addColorStop(1, 'rgba(0,0,0,0)');

                    tCtx.fillStyle = grad;

                    tCtx.fillRect(0, 0, w, h);
                }
                tCtx.restore();
            } else if (p.effect === 'radar_sweep') {
                tCtx.save();
                tCtx.clip(path);

                tCtx.fillStyle = 'rgba(0, 0, 0, 0.85)';
                tCtx.fill(path);

                const avg = pts.reduce((acc, pt) => ({ x: acc.x + pt.x, y: acc.y + pt.y }), { x: 0, y: 0 });
                const cx = (avg.x / pts.length) * w;
                const cy = (avg.y / pts.length) * h;
                const maxDist = Math.max(w, h);

                tCtx.strokeStyle = p.color;
                tCtx.lineWidth = 1;
                for (let r = 50; r < maxDist; r += 50) {
                    tCtx.globalAlpha = baseAlpha * 0.15;
                    tCtx.beginPath();
                    tCtx.arc(cx, cy, r, 0, Math.PI * 2);
                    tCtx.stroke();
                }

                const angle = time * 0.002 * p.speed;
                const sweepSize = 0.6 * (p.size || 1.0);

                tCtx.globalAlpha = baseAlpha * 0.8;
                tCtx.fillStyle = p.color;
                tCtx.beginPath();
                tCtx.moveTo(cx, cy);
                tCtx.arc(cx, cy, maxDist, angle, angle - sweepSize, true);
                tCtx.closePath();
                tCtx.fill();

                tCtx.globalAlpha = baseAlpha;
                tCtx.lineWidth = 3;
                tCtx.beginPath();
                tCtx.moveTo(cx, cy);
                tCtx.lineTo(cx + Math.cos(angle) * maxDist, cy + Math.sin(angle) * maxDist);
                tCtx.stroke();

                tCtx.restore();

            } else if (p.effect === 'pulse_rings') {
                tCtx.save();
                tCtx.clip(path);

                const avg = pts.reduce((acc, pt) => ({ x: acc.x + pt.x, y: acc.y + pt.y }), { x: 0, y: 0 });
                const cx = (avg.x / pts.length) * w;
                const cy = (avg.y / pts.length) * h;
                const maxDist = Math.max(w, h);

                tCtx.strokeStyle = p.color;
                tCtx.globalCompositeOperation = 'screen';

                for (let i = 0; i < 5; i++) {
                    let r = ((time * 0.3 * p.speed + i * (maxDist / 5)) % maxDist);

                    let fade = 1 - (r / maxDist);
                    tCtx.globalAlpha = baseAlpha * fade;

                    tCtx.lineWidth = ((r / maxDist) * 15 + 2) * (p.size || 1.0);

                    tCtx.beginPath();
                    tCtx.arc(cx, cy, r, 0, Math.PI * 2);
                    tCtx.stroke();
                }
                tCtx.restore();

            } else if (p.effect === 'cyber_rain') {
                tCtx.save();
                tCtx.clip(path);

                tCtx.fillStyle = 'rgba(0, 0, 0, 0)';
                tCtx.fill(path);

                tCtx.strokeStyle = p.color;
                tCtx.lineCap = 'round';

                for (let x = 20; x < w; x += 40) {
                    let offset = (x * 12345) % 2000;
                    let speedMult = 1 + ((x * 7) % 3) * 0.3;

                    let dropY = ((time * 0.4 * p.speed * speedMult + offset) % (h + 400)) - 400;

                    let tailLen = (60 + (x * 33) % 150) * (p.size || 1.0);

                    tCtx.globalAlpha = baseAlpha;
                    tCtx.lineWidth = 4 * (p.size || 1.0);
                    tCtx.beginPath();
                    tCtx.moveTo(x, dropY + tailLen);
                    tCtx.lineTo(x, dropY + tailLen - 15);
                    tCtx.stroke();

                    tCtx.globalAlpha = baseAlpha * 0.3;
                    tCtx.lineWidth = 2 * (p.size || 1.0);
                    tCtx.beginPath();
                    tCtx.moveTo(x, dropY + tailLen - 15);
                    tCtx.lineTo(x, dropY);
                    tCtx.stroke();
                }
                tCtx.restore();

            } else if (p.effect === 'image') {
                if (p.image) {
                    tCtx.save();
                    tCtx.globalAlpha = baseAlpha;

                    if (pts.length === 4) {
                        // convert panel normalized coordinates to actual screen coordinates
                        const screenPts = [
                            { x: pts[0].x * w, y: pts[0].y * h }, // top left
                            { x: pts[1].x * w, y: pts[1].y * h }, // top right
                            { x: pts[2].x * w, y: pts[2].y * h }, // bot right
                            { x: pts[3].x * w, y: pts[3].y * h }  // bot left
                        ];

                        drawImagePerspective(tCtx, p.image, screenPts);
                    } else {
                        tCtx.clip(path);
                        let minX = w, minY = h, maxX = 0, maxY = 0;
                        pts.forEach(pt => {
                            const px = pt.x * w; const py = pt.y * h;
                            if (px < minX) minX = px; if (py < minY) minY = py;
                            if (px > maxX) maxX = px; if (py > maxY) maxY = py;
                        });
                        tCtx.drawImage(p.image, minX, minY, maxX - minX, maxY - minY);
                    }
                    tCtx.restore();
                } else {
                    tCtx.fillStyle = '#222';
                    tCtx.fill(path);
                    tCtx.globalAlpha = baseAlpha;
                    tCtx.fillStyle = '#fff';
                    tCtx.font = "14px Arial";
                    tCtx.textAlign = "center";
                    const avg = pts.reduce((acc, pt) => ({ x: acc.x + pt.x, y: acc.y + pt.y }), { x: 0, y: 0 });
                    tCtx.fillText("Upload Media", (avg.x / pts.length) * w, (avg.y / pts.length) * h);
                }

            }

            else if (p.effect === 'text') {
                tCtx.save();
                tCtx.globalAlpha = baseAlpha;

                if (pts.length === 4 && p.textCanvas) {
                    const screenPts = [
                        {x: pts[0].x * w, y: pts[0].y * h},
                        {x: pts[1].x * w, y: pts[1].y * h},
                        {x: pts[2].x * w, y: pts[2].y * h},
                        {x: pts[3].x * w, y: pts[3].y * h}
                    ];
                    drawImagePerspective(tCtx, p.textCanvas, screenPts);
                }

                tCtx.restore();
            }

            else {
                // solid color Defaultelse {
                tCtx.fillStyle = p.color;
                if (isPreview && isSel) tCtx.globalAlpha = baseAlpha * 0.7;
                tCtx.fill(path);
            }

            if (isPreview || p.effect === 'solid') {
                tCtx.globalAlpha = isPreview ? 1.0 : opacity;
                tCtx.strokeStyle = p.color;
                tCtx.lineWidth = (isPreview && isSel) ? 5 : 2;
                tCtx.stroke(path);
            }
        }

        if (isPreview && isSel && opacity === 0) {
            tCtx.globalAlpha = 1.0;
            tCtx.strokeStyle = p.color;
            tCtx.lineWidth = 4;
            tCtx.stroke(path);
        }

        tCtx.restore();
    });
}


function loop() {
    const res = getRes();
    draw(ctx, res.w, res.h, true);

    const isProjectorAlive = projectorWindow && !projectorWindow.closed;

    if (isProjectorAlive) {
        const outCanvas = projectorWindow.document.getElementById('out-canvas');
        if (outCanvas) draw(outCanvas.getContext('2d'), res.w, res.h, false);
    }

    if (isProjectorAlive !== projectorOpenState) {
        projectorOpenState = isProjectorAlive;
        const launchBtn = document.getElementById('launch-projector');

        if (launchBtn) {
            launchBtn.innerText = isProjectorAlive ? "Reload Projector View" : "Launch Projector View";
            //launchBtn.style.backgroundColor = isProjectorAlive ? "#4f4f4f" : "";
        }
    }

    requestAnimationFrame(loop);
}

// legacy launch view (main screen)
    /*
    document.getElementById('launch-projector').onclick = () => {
        const res = getRes();
        projectorWindow = window.open('', 'ProjOut', `width=${res.w},height=${res.h},menubar=no,toolbar=no,location=no`);
        projectorWindow.document.body.style.cssText = 'margin:0;background:black;overflow:hidden;';
        projectorWindow.document.body.innerHTML = `<canvas id="out-canvas" width="${res.w}" height="${res.h}" style="width:100vw;height:100vh;"></canvas>`;
    };
    */

document.getElementById('launch-projector').onclick = async () => {
    const res = getRes();

    let windowFeatures = `width=${res.w},height=${res.h},menubar=no,toolbar=no,location=no`;

    try {
        if ('getScreenDetails' in window) {
            // prompt the user for permission the first time it runs
            const screenDetails = await window.getScreenDetails();

            const secondaryScreen = screenDetails.screens.find(s => s !== screenDetails.currentScreen);

            if (secondaryScreen) {
                windowFeatures += `,left=${secondaryScreen.availLeft},top=${secondaryScreen.availTop}`;
            }
        }
    } catch (err) {
        console.warn("Multi-monitor placement skipped:", err.message);
    }

    projectorWindow = window.open('', 'ProjOut', windowFeatures);

    if (projectorWindow) {
        projectorWindow.document.title = "Projector View";
        projectorWindow.document.body.style.cssText = 'margin:0;background:black;overflow:hidden;';
        projectorWindow.document.body.innerHTML = `<canvas id="out-canvas" width="${res.w}" height="${res.h}" style="width:100vw;height:100vh;"></canvas>`;
    } else {
        alert("Popup blocked! Please allow popups to launch the projector view.");
    }
};

loop();