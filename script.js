// script.js - 画像軽量化・通信安定化・完全版

// ★指定された最新のGAS URL
const GAS_URL = "https://script.google.com/macros/s/AKfycbx8Oxc4dVAK1v5crQjBGEH6zbpg3m7hZFKxx7tn9ERKfHN4bYyDSY_Y5yXuGf1cEc1L/exec";

// --- 画像・データファイルパス ---
const MAP_SRC = "./map.bmp";
const COLLISION_SRC = "./map_collision.bmp";
const CSV_SRC = "./data.csv";

// --- 設定値 ---
const MAX_TIME_LIMIT = 30; // 制限時間（分）
const MOVE_FRAMES_PER_MINUTE = 120; // 移動による時間経過

// --- DOM要素の取得 ---
const gameArea = document.getElementById('game-area');
const canvas = document.getElementById('map-canvas');
const ctx = canvas.getContext('2d');
const statusDiv = document.getElementById('status-message');
const debugCoords = document.getElementById('coord-display');
const playerIdInput = document.getElementById('player-id-input');
const eventPopup = document.getElementById('event-popup');
const logSection = document.getElementById('log-section');
const resultScreen = document.getElementById('result-screen');
const resultLogBody = document.getElementById('result-log-body');
const endScreen = document.getElementById('end-screen');

const timerBarFill = document.getElementById('timer-bar-fill');
const timerText = document.getElementById('timer-text');

const collisionCanvas = document.createElement('canvas');
const collisionCtx = collisionCanvas.getContext('2d');

// --- ゲーム状態変数 ---
let mapImage = new Image();
let collisionImage = new Image();
let scaleFactor = 1;
let gameOffsetX = 0;
let gameOffsetY = 0;

let player = { x: 508, y: 500, radius: 10, speed: 4, id: "" };
let keys = {};
let roomData = [];
let logs = [];
let movementHistory = [];
let isGameRunning = false;

// 時間・セッション管理
let accumulatedTime = 0;
let moveFrameCount = 0;
let sessionUUID = "";
let sessionStartTime = "";
let eventOpenTime = 0; 

// --- 初期化 ---
mapImage.src = MAP_SRC;
collisionImage.src = COLLISION_SRC;

let imagesLoaded = 0;
function onImageLoad() {
    imagesLoaded++;
    if (imagesLoaded === 2) {
        initGameSize();
        fetch(CSV_SRC)
            .then(r => r.text())
            .then(parseCSV)
            .catch(e => console.error("CSV Load Error:", e));
        requestAnimationFrame(gameLoop);
    }
}
mapImage.onload = onImageLoad;
collisionImage.onload = onImageLoad;

// --- 画面リサイズ ---
function initGameSize() {
    const w = gameArea.clientWidth;
    const h = gameArea.clientHeight;
    canvas.width = w; canvas.height = h;
    collisionCanvas.width = mapImage.width; collisionCanvas.height = mapImage.height;
    collisionCtx.drawImage(collisionImage, 0, 0);
    const scaleW = w / mapImage.width;
    const scaleH = h / mapImage.height;
    scaleFactor = Math.min(scaleW, scaleH);
    gameOffsetX = (w - (mapImage.width * scaleFactor)) / 2;
    gameOffsetY = (h - (mapImage.height * scaleFactor)) / 2;
}
window.addEventListener('resize', initGameSize);

// --- 入力 ---
window.addEventListener('keydown', e => keys[e.key] = true);
window.addEventListener('keyup', e => keys[e.key] = false);

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const originalX = Math.round((mouseX - gameOffsetX) / scaleFactor);
    const originalY = Math.round((mouseY - gameOffsetY) / scaleFactor);
    if(originalX >= 0 && originalX <= mapImage.width && originalY >= 0 && originalY <= mapImage.height) {
        debugCoords.textContent = `X:${originalX} Y:${originalY}`;
    } else {
        debugCoords.textContent = "Outside";
    }
});

// --- ゲームループ ---
function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

function update() {
    if (!isGameRunning) return;
    if (eventPopup.style.display === 'flex') return;
    if (resultScreen.style.display === 'flex') return; 

    let dx = 0; let dy = 0;
    if (keys['ArrowUp'] || keys['w']) dy = -player.speed;
    if (keys['ArrowDown'] || keys['s']) dy = player.speed;
    if (keys['ArrowLeft'] || keys['a']) dx = -player.speed;
    if (keys['ArrowRight'] || keys['d']) dx = player.speed;

    if (dx !== 0 && dy !== 0) { dx *= 0.71; dy *= 0.71; }

    if (dx !== 0 || dy !== 0) {
        moveFrameCount++;
        // 軌跡記録 (10フレーム毎)
        if (moveFrameCount % 10 === 0) {
            movementHistory.push({ 
                x: Math.floor(player.x), 
                y: Math.floor(player.y), 
                time: accumulatedTime,
                realTime: new Date().toLocaleString()
            });
        }
        if (moveFrameCount >= MOVE_FRAMES_PER_MINUTE) {
            addTime(1); 
            moveFrameCount = 0;
            statusDiv.textContent = "移動により時間が経過しました";
            setTimeout(() => { if(isGameRunning) statusDiv.textContent = ""; }, 2000);
            if(checkTimeLimit()) return; 
        }
    }

    const nextX = player.x + dx;
    const nextY = player.y + dy;

    if (!checkCollision(nextX, player.y)) player.x = nextX;
    if (!checkCollision(player.x, nextY)) player.y = nextY;

    checkEvents();
}

function checkCollision(x, y) {
    if (x < 0 || x > mapImage.width || y < 0 || y > mapImage.height) return true;
    const p = collisionCtx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    if (p[0] < 50 && p[1] < 50 && p[2] < 50) return true;
    return false;
}

function draw() {
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!mapImage.complete) return;
    ctx.drawImage(mapImage, gameOffsetX, gameOffsetY, mapImage.width * scaleFactor, mapImage.height * scaleFactor);

    // リザルト画面裏でも軌跡とプレイヤーを描画し続ける
    if (movementHistory.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.6)'; ctx.lineWidth = 3;
        const startX = gameOffsetX + (movementHistory[0].x * scaleFactor);
        const startY = gameOffsetY + (movementHistory[0].y * scaleFactor);
        ctx.moveTo(startX, startY);
        for (let i = 1; i < movementHistory.length; i++) {
            const px = gameOffsetX + (movementHistory[i].x * scaleFactor);
            const py = gameOffsetY + (movementHistory[i].y * scaleFactor);
            ctx.lineTo(px, py);
        }
        ctx.lineTo(gameOffsetX + (player.x * scaleFactor), gameOffsetY + (player.y * scaleFactor));
        ctx.stroke();
    }
    
    const sx = gameOffsetX + (player.x * scaleFactor);
    const sy = gameOffsetY + (player.y * scaleFactor);
    const sr = player.radius * scaleFactor;
    ctx.fillStyle = '#00f0ff'; ctx.strokeStyle = 'white'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy - sr * 0.4, sr * 0.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx - sr, sy + sr); ctx.quadraticCurveTo(sx, sy - sr * 0.5, sx + sr, sy + sr); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "white"; ctx.font = `${12 * scaleFactor}px Meiryo`; ctx.textAlign = "center";
    ctx.fillText(player.id, sx, sy + sr + 15);
    
    roomData.forEach(room => {
        if (room.isDiscovered) {
            const allCompleted = room.tasks.every(t => t.status === 'completed');
            const pinColor = allCompleted ? '#00ccff' : '#ff3333'; 
            const px = gameOffsetX + (room.x * scaleFactor);
            const py = gameOffsetY + (room.y * scaleFactor);
            drawPin(px, py, pinColor, scaleFactor);
        }
    });
}

function drawPin(x, y, color, scale) {
    const size = 15 * scale;
    ctx.fillStyle = color; ctx.strokeStyle = 'white'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - (size/2), y - size); ctx.lineTo(x + (size/2), y - size); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - size, size/2, 0, Math.PI*2); ctx.fill(); ctx.stroke();
}

function addTime(minutes) {
    accumulatedTime += minutes;
    updateTimeGauge();
}

function updateTimeGauge() {
    let percent = (accumulatedTime / MAX_TIME_LIMIT) * 100;
    if (percent > 100) percent = 100;
    timerBarFill.style.width = percent + "%";
    timerText.textContent = `${accumulatedTime} / ${MAX_TIME_LIMIT} 分`;
    if (percent < 50) timerBarFill.style.backgroundColor = "#00ff00";
    else if (percent < 80) timerBarFill.style.backgroundColor = "#ffcc00";
    else timerBarFill.style.backgroundColor = "#ff3333";
}

function checkTimeLimit() {
    if (accumulatedTime >= MAX_TIME_LIMIT) {
        finishGame();
        return true;
    }
    return false;
}

// --- ゲーム終了処理 ---
function finishGame() {
    isGameRunning = false;
    eventPopup.style.display = 'none';
    
    // ★通信の渋滞を防ぐため、軌跡を送った1秒後に画像を送る
    sendTrajectoryToGAS();
    setTimeout(() => {
        sendImageToGAS();
    }, 1000);

    resultLogBody.innerHTML = "";
    logs.forEach(log => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${log.elapsedTime}</td><td>${log.timestamp}</td><td>${log.decisionTime}秒</td><td>${log.location}</td><td>${log.event}</td><td>${log.choice}</td><td>${log.result}</td>`;
        resultLogBody.appendChild(tr);
    });

    const ths = document.getElementById('result-table').querySelectorAll('th');
    if(ths.length < 7) {
       const headerRow = document.querySelector('#result-table thead tr');
       headerRow.innerHTML = `<th>シミュ経過</th><th>リアル日時</th><th>決断秒数</th><th>場所</th><th>イベント</th><th>選択</th><th>結果</th>`;
    }

    const btnArea = resultScreen.querySelector('.button-area');
    const oldBtn = document.getElementById('btn-manual-send');
    if(oldBtn) oldBtn.remove();
    const manualSendBtn = document.createElement('button');
    manualSendBtn.id = 'btn-manual-send';
    manualSendBtn.className = 'dl-btn';
    manualSendBtn.style.backgroundColor = '#ff9900';
    manualSendBtn.textContent = '結果をサーバーに再送信';
    manualSendBtn.onclick = () => { 
        alert("送信を開始します..."); 
        sendTrajectoryToGAS(); 
        setTimeout(()=>sendImageToGAS(), 1000);
    };
    btnArea.insertBefore(manualSendBtn, btnArea.firstChild);

    resultScreen.style.display = 'flex';
}

window.showEndScreen = () => {
    resultScreen.style.display = 'none';
    endScreen.style.display = 'flex';
};

// --- CSVパース ---
function parseCSV(text) {
    const lines = text.trim().split('\n');
    roomData = [];
    for (let i = 1; i < lines.length; i++) {
        const row = parseCSVLine(lines[i]);
        if(row.length < 5) continue;
        const roomName = row[2];
        const x = parseInt(row[3]);
        const y = parseInt(row[4]);
        const r = parseInt(row[5]);
        const order = parseInt(row[6]); 

        let room = roomData.find(d => d.name === roomName && Math.abs(d.x - x) < 5 && Math.abs(d.y - y) < 5);
        if(!room) {
            room = { name: roomName, x: x, y: y, radius: r, tasks: [], isDiscovered: false, ignoreUntilExit: false, currentTaskIndex: 0 };
            roomData.push(room);
        }
        const task = { id: row[0], name: row[7], description: row[8], order: order, choices: [], status: 'pending' };
        if(row[9]) task.choices.push({ text: row[9], result: row[10], time: parseInt(row[11]||0) });
        if(row[12]) task.choices.push({ text: row[12], result: row[13], time: parseInt(row[14]||0) });
        if(row[15]) task.choices.push({ text: row[15], result: row[16], time: parseInt(row[17]||0) });
        if(row[18]) task.choices.push({ text: row[18], result: row[19], time: parseInt(row[20]||0) });
        room.tasks.push(task);
    }
    roomData.forEach(room => { room.tasks.sort((a, b) => a.order - b.order); });
}

function parseCSVLine(line) {
    const res = [];
    let start = 0, inQ = false;
    for(let i=0; i<line.length; i++){
        if(line[i]==='"') inQ = !inQ;
        if(line[i]===',' && !inQ){ res.push(line.substring(start, i).replace(/^"|"$/g,'')); start=i+1; }
    }
    res.push(line.substring(start).replace(/^"|"$/g,''));
    return res;
}

// --- イベント制御 ---
function checkEvents() {
    if(eventPopup.style.display === 'flex') return;
    for (let i = 0; i < roomData.length; i++) {
        const room = roomData[i];
        const dist = Math.hypot(player.x - room.x, player.y - room.y);
        if (dist < room.radius) {
            room.isDiscovered = true;
            if (room.ignoreUntilExit) continue; 
            const pendingCount = room.tasks.filter(t => t.status === 'pending').length;
            if(pendingCount === 0) continue;
            if(room.currentTaskIndex >= room.tasks.length) room.currentTaskIndex = 0;
            let foundTask = null;
            let startIndex = room.currentTaskIndex;
            let count = 0;
            while(count < room.tasks.length) {
                let idx = (startIndex + count) % room.tasks.length;
                if(room.tasks[idx].status === 'pending') {
                    room.currentTaskIndex = idx;
                    foundTask = room.tasks[idx];
                    break;
                }
                count++;
            }
            if (foundTask) { triggerEvent(room, foundTask); break; }
        } else {
            room.ignoreUntilExit = false;
        }
    }
}

function triggerEvent(room, task) {
    keys = {};
    document.getElementById('event-title').textContent = `場所: ${room.name}`;
    document.getElementById('event-desc').innerHTML = `<strong>${task.name}</strong><br>${task.description}`;
    eventOpenTime = Date.now();

    const choicesDiv = document.getElementById('event-choices');
    choicesDiv.innerHTML = "";
    task.choices.forEach((c, index) => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.innerHTML = c.text; 
        btn.onclick = () => resolveEvent(room, task, c, index);
        choicesDiv.appendChild(btn);
    });
    
    // ★文言変更
    const holdBtn = document.createElement('button');
    holdBtn.className = 'choice-btn';
    holdBtn.style.backgroundColor = '#777';
    holdBtn.textContent = 'この場所以外を探索する（保留）';
    holdBtn.onclick = () => {
        room.ignoreUntilExit = true;
        eventPopup.style.display = 'none';
        recordLog(room, task, "保留", "この場所以外を探索する");
    };
    choicesDiv.appendChild(holdBtn);
    document.getElementById('close-btn').style.display = 'none';
    eventPopup.style.display = 'flex';
}

function resolveEvent(room, task, choice, choiceIndex) {
    if(choiceIndex === 3) task.status = 'pending'; else task.status = 'completed';
    addTime(choice.time || 0);
    recordLog(room, task, choice.text, choice.result);
    document.getElementById('event-desc').innerHTML = `<div style="color:#5bc0de; font-weight:bold; margin-bottom:10px;">選択結果</div>${choice.result}`;
    document.getElementById('event-choices').innerHTML = "";
    const closeBtn = document.getElementById('close-btn');
    closeBtn.style.display = 'block';
    closeBtn.textContent = "確認";
    closeBtn.onclick = () => {
        eventPopup.style.display = 'none';
        if(checkTimeLimit()) return;
        room.currentTaskIndex++;
        if(task.status === 'completed') statusDiv.textContent = `✅ ${task.name} 完了`; else statusDiv.textContent = `⏭️ ${task.name} 次へ`;
    };
}

// ログ記録
function recordLog(room, task, choiceText, resultText) {
    const now = new Date();
    let duration = 0;
    if (eventOpenTime > 0) {
        duration = Math.floor((Date.now() - eventOpenTime) / 1000);
    }
    const logEntry = {
        type: 'event', 
        playerId: player.id,
        sessionUUID: sessionUUID,
        startTime: sessionStartTime,
        timestamp: now.toLocaleString(),
        elapsedTime: accumulatedTime + "分",
        decisionTime: duration, 
        location: room.name,
        event: task.name,
        choice: choiceText,
        result: resultText
    };
    logs.push(logEntry);
    sendToGAS(logEntry);
    addLogToScreen(room.name, task.name, choiceText, duration);
    eventOpenTime = 0;
}

function addLogToScreen(location, event, choice, duration) {
    const div = document.createElement('div');
    div.className = 'log-item';
    const timeStr = duration !== undefined ? ` (決断:${duration}秒)` : "";
    div.innerHTML = `<span class=\"log-time\">[${accumulatedTime}分]</span> <span class=\"log-event\">${location}</span><br>選択: ${choice}${timeStr}`;
    logSection.prepend(div);
}

// --- GAS連携 ---
function sendToGAS(data) {
    fetch(GAS_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        keepalive: true
    }).catch(err => console.error(err));
}

// ★画像送信 (軽量なJPEG形式で送信)
function sendImageToGAS() {
    try {
        var dataURL = canvas.toDataURL("image/jpeg", 0.7);
        var base64 = dataURL.split("base64,")[1]; 

        const payload = {
            type: 'image', 
            playerId: player.id,
            sessionUUID: sessionUUID,
            startTime: sessionStartTime,
            image: base64
        };
        
        console.log("Sending image data...");
        fetch(GAS_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload),
            keepalive: true 
        }).then(()=>console.log("Image sent")).catch(err => console.error("Image Send Error:", err));
    } catch (e) {
        console.error("Canvas is tainted. Cannot export image. (ローカル環境制限):", e);
    }
}

function sendTrajectoryToGAS() {
    if (movementHistory.length === 0) return;
    let historyToSend = movementHistory;
    const MAX_POINTS = 3000;
    if (historyToSend.length > MAX_POINTS) {
        const step = historyToSend.length / MAX_POINTS;
        historyToSend = historyToSend.filter((_, index) => index % Math.ceil(step) === 0);
    }
    const payload = {
        type: 'trajectory',
        playerId: player.id,
        sessionUUID: sessionUUID,
        startTime: sessionStartTime,
        history: historyToSend
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'text/plain' });
    if (navigator.sendBeacon) {
        navigator.sendBeacon(GAS_URL, blob);
    } else {
        fetch(GAS_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload),
            keepalive: true
        });
    }
}

// --- スタートボタン ---
document.getElementById('btn-start').onclick = () => {
    const id = playerIdInput.value;
    if(!id) { alert("IDを入力してください"); return; }
    player.id = id;
    sessionUUID = Date.now().toString(36) + Math.random().toString(36).substr(2);
    sessionStartTime = new Date().toLocaleString();
    
    document.getElementById('top-screen').style.display = 'none';
    isGameRunning = true;
    player.x = 508; player.y = 500;
    movementHistory = [{
        x:508, y:500, time:0, 
        realTime: new Date().toLocaleString()
    }]; 
};

// --- 管理者・DL機能 ---
window.openAdminLogin = () => { document.getElementById('admin-login-overlay').style.display = 'flex'; };
window.closeAdminLogin = () => { document.getElementById('admin-login-overlay').style.display = 'none'; };
window.checkAdminPass = () => {
    if(document.getElementById('admin-pass-input').value === "admin1234") {
        closeAdminLogin();
        renderAdminLogs();
        document.getElementById('admin-screen').style.display = 'flex';
    } else { alert("パスワード不一致"); }
};
window.closeAdminScreen = () => { document.getElementById('admin-screen').style.display = 'none'; };

function renderAdminLogs() {
    const tbody = document.getElementById('admin-log-body');
    tbody.innerHTML = "";
    
    const theadRow = document.querySelector('#admin-table thead tr');
    theadRow.innerHTML = `<th>ID</th><th>日時</th><th>経過</th><th>決断(秒)</th><th>場所</th><th>イベント</th><th>選択</th><th>結果</th>`;

    logs.forEach(log => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${log.playerId}</td><td>${log.timestamp}</td><td>${log.elapsedTime}</td><td>${log.decisionTime}</td><td>${log.location}</td><td>${log.event}</td><td>${log.choice}</td><td>${log.result}</td>`;
        tbody.appendChild(tr);
    });
}
window.clearAllLogs = () => { if(confirm("ログ削除？")) { logs=[]; renderAdminLogs(); }};

window.downloadAllLogs = () => {
    let csvContent = "ID,日時,経過,決断時間(秒),場所,イベント,選択,結果\n" + logs.map(l => 
        `${l.playerId},${l.timestamp},${l.elapsedTime},${l.decisionTime},${l.location},${l.event},${l.choice},${l.result}`
    ).join("\n");
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, csvContent], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "event_logs.csv";
    document.body.appendChild(link);
    link.click();
};

window.downloadPathLogs = () => {
    let csvContent = "PointRealTime,SimTime,X,Y\n" + movementHistory.map(m => 
        `${m.realTime},${m.time},${m.x},${m.y}`
    ).join("\n");
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, csvContent], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "path_logs.csv";
    document.body.appendChild(link);
    link.click();
};