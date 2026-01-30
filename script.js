const GAS_URL = "https://script.google.com/macros/s/AKfycbwATkMNs5G_V5qde_lG8ch8z3thTfjPvJA_sj5klz-NwHWkwvNMUNVkYnphx6EHpqX_/exec"; 

// --- 画像ファイル設定 ---
const MAP_SRC = "./map.bmp";
const COLLISION_SRC = "./map_collision.bmp";
const CSV_SRC = "./data.csv";

// --- 設定値 ---
const MAX_TIME_LIMIT = 30; // ゲージの上限（分）

// --- DOM要素 ---
const canvas = document.getElementById('map-canvas');
const ctx = canvas.getContext('2d');
const statusDiv = document.getElementById('status-message');
const debugCoords = document.getElementById('coord-display');
const playerIdInput = document.getElementById('player-id-input');
const eventPopup = document.getElementById('event-popup');

// タイムゲージ用
const timerContainer = document.getElementById('timer-container');
const timerBarFill = document.getElementById('timer-bar-fill');
const timerText = document.getElementById('timer-text');

// 当たり判定用
const collisionCanvas = document.createElement('canvas');
const collisionCtx = collisionCanvas.getContext('2d');

// --- ゲーム状態変数 ---
let mapImage = new Image();
let collisionImage = new Image();
let scaleFactor = 1;
let gameOffsetX = 0;
let gameOffsetY = 0;

// プレイヤー初期位置（指定の座標に変更）
let player = { x: 508, y: 500, radius: 10, speed: 4, id: "" };
let keys = {};
let roomData = [];
let logs = [];
let isGameRunning = false;

// 時間管理用
let accumulatedTime = 0; // 選択肢によって蓄積されたシミュレーション時間（分）

// --- 初期化シーケンス ---
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
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    canvas.width = winW;
    canvas.height = winH;

    collisionCanvas.width = mapImage.width;
    collisionCanvas.height = mapImage.height;
    collisionCtx.drawImage(collisionImage, 0, 0);

    const scaleW = winW / mapImage.width;
    const scaleH = winH / mapImage.height;
    scaleFactor = Math.min(scaleW, scaleH);

    gameOffsetX = (winW - (mapImage.width * scaleFactor)) / 2;
    gameOffsetY = (winH - (mapImage.height * scaleFactor)) / 2;
}
window.addEventListener('resize', initGameSize);

// --- 入力ハンドリング ---
window.addEventListener('keydown', e => keys[e.key] = true);
window.addEventListener('keyup', e => keys[e.key] = false);

// マウス座標デバッグ
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

    let dx = 0; let dy = 0;
    if (keys['ArrowUp'] || keys['w']) dy = -player.speed;
    if (keys['ArrowDown'] || keys['s']) dy = player.speed;
    if (keys['ArrowLeft'] || keys['a']) dx = -player.speed;
    if (keys['ArrowRight'] || keys['d']) dx = player.speed;

    if (dx !== 0 && dy !== 0) { dx *= 0.71; dy *= 0.71; }

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
    // 背景
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!mapImage.complete) return;

    // マップ
    ctx.drawImage(mapImage, gameOffsetX, gameOffsetY, mapImage.width * scaleFactor, mapImage.height * scaleFactor);

    if (isGameRunning) {
        // --- プレイヤー描画 (人型) ---
        const sx = gameOffsetX + (player.x * scaleFactor);
        const sy = gameOffsetY + (player.y * scaleFactor);
        const sr = player.radius * scaleFactor;

        ctx.fillStyle = '#00f0ff';
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;

        // 頭
        ctx.beginPath();
        ctx.arc(sx, sy - sr * 0.4, sr * 0.6, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        // 体
        ctx.beginPath();
        ctx.moveTo(sx - sr, sy + sr);
        ctx.quadraticCurveTo(sx, sy - sr * 0.5, sx + sr, sy + sr);
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        // 名前
        ctx.fillStyle = "white";
        ctx.font = `${12 * scaleFactor}px Arial`;
        ctx.textAlign = "center";
        ctx.fillText(player.id, sx, sy + sr + 15);

        // --- ピンの描画 ---
        // roomDataのうち、isDiscovered = true のものだけにピンを立てる
        roomData.forEach(room => {
            if (room.isDiscovered) {
                // タスクの状態確認
                const allCompleted = room.tasks.every(t => t.status === 'completed');
                const pinColor = allCompleted ? '#00ccff' : '#ff3333'; // 青(完了) or 赤(未完了)
                
                // ピンの座標
                const px = gameOffsetX + (room.x * scaleFactor);
                const py = gameOffsetY + (room.y * scaleFactor);
                
                drawPin(px, py, pinColor, scaleFactor);
            }
        });
    }
}

// ピンを描画する関数
function drawPin(x, y, color, scale) {
    const size = 15 * scale; // ピンのサイズ
    ctx.fillStyle = color;
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1;

    ctx.beginPath();
    // 逆三角形（ピンの体）
    ctx.moveTo(x, y); 
    ctx.lineTo(x - (size/2), y - size);
    ctx.lineTo(x + (size/2), y - size);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 上の丸
    ctx.beginPath();
    ctx.arc(x, y - size, size/2, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
}

// --- CSV処理 ---
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

        let room = roomData.find(d => d.name === roomName && Math.abs(d.x - x) < 5 && Math.abs(d.y - y) < 5);
        if(!room) {
            room = { 
                name: roomName, x: x, y: y, radius: r, tasks: [], 
                isDiscovered: false // ★発見フラグ（初期値false）
            };
            roomData.push(room);
        }

        const task = {
            id: row[0],
            name: row[7],
            description: row[8],
            choices: [],
            status: 'pending'
        };

        // 選択肢読み込み（経過時間を数値変換）
        if(row[9]) task.choices.push({ text: row[9], result: row[10], time: parseInt(row[11]||0) });
        if(row[12]) task.choices.push({ text: row[12], result: row[13], time: parseInt(row[14]||0) });
        if(row[15]) task.choices.push({ text: row[15], result: row[16], time: parseInt(row[17]||0) });
        if(row[18]) task.choices.push({ text: row[18], result: row[19], time: parseInt(row[20]||0) });

        room.tasks.push(task);
    }
}

function parseCSVLine(line) {
    const res = [];
    let start = 0, inQ = false;
    for(let i=0; i<line.length; i++){
        if(line[i]==='"') inQ = !inQ;
        if(line[i]===',' && !inQ){
            res.push(line.substring(start, i).replace(/^"|"$/g,''));
            start=i+1;
        }
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
            // ★エリア侵入で「発見済み」にする
            room.isDiscovered = true;

            const pendingTask = room.tasks.find(t => t.status === 'pending');
            if (pendingTask) {
                triggerEvent(room, pendingTask);
                break;
            }
        }
    }
}

function triggerEvent(room, task) {
    keys = {}; 
    document.getElementById('event-title').textContent = `場所: ${room.name}`;
    document.getElementById('event-desc').innerHTML = `<strong>${task.name}</strong><br>${task.description}`;
    
    const choicesDiv = document.getElementById('event-choices');
    choicesDiv.innerHTML = "";

    task.choices.forEach(c => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        // ボタンに予想時間も表示
        btn.innerHTML = `${c.text} <span style="font-size:0.8em; color:#ccc;">(+${c.time}分)</span>`;
        btn.onclick = () => resolveEvent(room, task, c);
        choicesDiv.appendChild(btn);
    });

    const holdBtn = document.createElement('button');
    holdBtn.className = 'choice-btn';
    holdBtn.style.backgroundColor = '#777';
    holdBtn.textContent = '保留（後で対応する）';
    holdBtn.onclick = () => {
        eventPopup.style.display = 'none';
        player.y += 20; 
    };
    choicesDiv.appendChild(holdBtn);

    document.getElementById('close-btn').style.display = 'none';
    eventPopup.style.display = 'flex';
}

function resolveEvent(room, task, choice) {
    task.status = 'completed';

    // ★時間を加算
    accumulatedTime += (choice.time || 0);
    updateTimeGauge();

    // ログ記録
    const now = new Date();
    const logEntry = {
        playerId: player.id,
        timestamp: now.toLocaleString(),
        elapsedTime: accumulatedTime + "分", // 累積シミュレーション時間
        location: room.name,
        event: task.name,
        choice: choice.text,
        result: choice.result
    };
    logs.push(logEntry);
    sendToGAS(logEntry);

    // 結果表示
    document.getElementById('event-desc').innerHTML = `
        <div style="color:#5bc0de; font-weight:bold; margin-bottom:10px;">選択結果</div>
        ${choice.result}<br><br>
        <span style="color:#f0ad4e;">経過時間: +${choice.time || 0}分 (計 ${accumulatedTime}分)</span>
    `;
    document.getElementById('event-choices').innerHTML = "";
    
    const closeBtn = document.getElementById('close-btn');
    closeBtn.style.display = 'block';
    closeBtn.textContent = "確認";
    closeBtn.onclick = () => {
        eventPopup.style.display = 'none';
        statusDiv.textContent = `✅ ${task.name} 完了`;
        setTimeout(()=>statusDiv.textContent="", 3000);
        
        // もし30分超えていたら警告など（必要であれば）
        if(accumulatedTime >= MAX_TIME_LIMIT) {
            statusDiv.textContent = "⚠️ 制限時間を超過しました！";
            statusDiv.style.color = "red";
        }
    };
}

// ★タイムゲージ更新関数
function updateTimeGauge() {
    let percent = (accumulatedTime / MAX_TIME_LIMIT) * 100;
    if (percent > 100) percent = 100;

    timerBarFill.style.width = percent + "%";
    timerText.textContent = `経過時間: ${accumulatedTime} / ${MAX_TIME_LIMIT} 分`;

    // 色変化 (緑 -> 黄 -> 赤)
    if (percent < 50) {
        timerBarFill.style.backgroundColor = "#00ff00"; // Green
    } else if (percent < 80) {
        timerBarFill.style.backgroundColor = "#ffcc00"; // Yellow
    } else {
        timerBarFill.style.backgroundColor = "#ff3333"; // Red
    }
}

// --- GAS連携 ---
function sendToGAS(data) {
    if(GAS_URL.indexOf("script.google.com") === -1) return;
    fetch(GAS_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }).catch(err => console.error(err));
}

// --- スタートボタン ---
document.getElementById('btn-start').onclick = () => {
    const id = playerIdInput.value;
    if(!id) { alert("IDを入力してください"); return; }
    player.id = id;
    document.getElementById('top-screen').style.display = 'none';
    timerContainer.style.display = 'block'; // ゲージ表示
    isGameRunning = true;
    statusDiv.textContent = "移動: 矢印キー または WASD";

    // ★指定の座標へ
    player.x = 508;
    player.y = 500;
};

// --- 管理者機能 ---
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
    logs.forEach(log => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${log.playerId}</td><td>${log.timestamp}</td><td>${log.elapsedTime}</td><td>${log.location}</td><td>${log.event}</td><td>${log.choice}</td><td>${log.result}</td>`;
        tbody.appendChild(tr);
    });
}
window.clearAllLogs = () => { if(confirm("ログ削除？")) { logs=[]; renderAdminLogs(); }};
window.downloadAllLogs = () => {
    let csv = "ID,日時,経過,場所,イベント,選択,結果\n" + logs.map(l => 
        `${l.playerId},${l.timestamp},${l.elapsedTime},${l.location},${l.event},${l.choice},${l.result}`
    ).join("\n");
    const link = document.createElement("a");
    link.href = "data:text/csv;charset=utf-8," + encodeURI(csv);
    link.download = "logs.csv";
    document.body.appendChild(link);
    link.click();
};