// script.js - 完全版（イベント循環・軌跡記録・GAS連携・30分制限）

// ★指定のGAS URL
const GAS_URL = "https://script.google.com/macros/s/AKfycbwATkMNs5G_V5qde_lG8ch8z3thTfjPvJA_sj5klz-NwHWkwvNMUNVkYnphx6EHpqX_/exec";

// --- 画像・データファイルパス ---
const MAP_SRC = "./map.bmp";
const COLLISION_SRC = "./map_collision.bmp";
const CSV_SRC = "./data.csv";

// --- 設定値 ---
const MAX_TIME_LIMIT = 30; // 制限時間（分）
const MOVE_FRAMES_PER_MINUTE = 120; // 移動による時間経過（60fps想定で約2秒移動=1分）

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

// タイムゲージ用
const timerBarFill = document.getElementById('timer-bar-fill');
const timerText = document.getElementById('timer-text');

// 当たり判定用（不可視キャンバス）
const collisionCanvas = document.createElement('canvas');
const collisionCtx = collisionCanvas.getContext('2d');

// --- ゲーム状態変数 ---
let mapImage = new Image();
let collisionImage = new Image();
let scaleFactor = 1;
let gameOffsetX = 0;
let gameOffsetY = 0;

// プレイヤー設定 (初期位置 X:508, Y:500)
let player = { x: 508, y: 500, radius: 10, speed: 4, id: "" };
let keys = {}; // キー入力状態
let roomData = []; // CSVから読み込んだ部屋・タスクデータ
let logs = []; // イベントログ記録用
let movementHistory = []; // 移動軌跡記録用
let isGameRunning = false; // ゲーム実行フラグ

// 時間管理
let accumulatedTime = 0; // 累積経過時間（分）
let moveFrameCount = 0;  // 移動フレームカウンタ

// --- 初期化シーケンス ---
mapImage.src = MAP_SRC;
collisionImage.src = COLLISION_SRC;

let imagesLoaded = 0;
function onImageLoad() {
    imagesLoaded++;
    if (imagesLoaded === 2) {
        // 画像が2枚とも読み込まれたら開始
        initGameSize();
        // CSV読み込み
        fetch(CSV_SRC)
            .then(r => r.text())
            .then(parseCSV)
            .catch(e => console.error("CSV Load Error:", e));
        
        // ゲームループ開始
        requestAnimationFrame(gameLoop);
    }
}
mapImage.onload = onImageLoad;
collisionImage.onload = onImageLoad;

// --- 画面リサイズ処理 ---
function initGameSize() {
    // 親要素のサイズに合わせてキャンバスをリサイズ
    const w = gameArea.clientWidth;
    const h = gameArea.clientHeight;

    canvas.width = w;
    canvas.height = h;

    // 当たり判定用は元画像サイズで固定
    collisionCanvas.width = mapImage.width;
    collisionCanvas.height = mapImage.height;
    collisionCtx.drawImage(collisionImage, 0, 0);

    // マップが画面に収まる最大スケールを計算 (Contain)
    const scaleW = w / mapImage.width;
    const scaleH = h / mapImage.height;
    scaleFactor = Math.min(scaleW, scaleH);

    // 中央寄せのためのオフセット
    gameOffsetX = (w - (mapImage.width * scaleFactor)) / 2;
    gameOffsetY = (h - (mapImage.height * scaleFactor)) / 2;
}
window.addEventListener('resize', initGameSize);

// --- 入力ハンドリング ---
window.addEventListener('keydown', e => keys[e.key] = true);
window.addEventListener('keyup', e => keys[e.key] = false);

// マウス移動（デバッグ用座標表示）
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    // 画面座標 -> 元画像座標への変換
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

// 状態更新
function update() {
    if (!isGameRunning) return;
    // ポップアップやリザルト画面表示中は停止
    if (eventPopup.style.display === 'flex') return;
    if (resultScreen.style.display === 'flex') return; 

    // 移動方向の計算
    let dx = 0; let dy = 0;
    if (keys['ArrowUp'] || keys['w']) dy = -player.speed;
    if (keys['ArrowDown'] || keys['s']) dy = player.speed;
    if (keys['ArrowLeft'] || keys['a']) dx = -player.speed;
    if (keys['ArrowRight'] || keys['d']) dx = player.speed;

    // 斜め移動の速度補正
    if (dx !== 0 && dy !== 0) { dx *= 0.71; dy *= 0.71; }

    // 移動処理 & 軌跡記録 & 時間経過
    if (dx !== 0 || dy !== 0) {
        moveFrameCount++;

        // 一定間隔（10フレーム毎）で軌跡を記録
        if (moveFrameCount % 10 === 0) {
            movementHistory.push({ x: Math.floor(player.x), y: Math.floor(player.y), time: accumulatedTime });
        }

        // 移動による時間経過判定
        if (moveFrameCount >= MOVE_FRAMES_PER_MINUTE) {
            addTime(1); // 1分加算
            moveFrameCount = 0;
            statusDiv.textContent = "移動により時間が経過しました";
            setTimeout(() => { if(isGameRunning) statusDiv.textContent = ""; }, 2000);
            
            // 時間制限チェック
            if(checkTimeLimit()) return; 
        }
    }

    const nextX = player.x + dx;
    const nextY = player.y + dy;

    // 衝突判定（壁でなければ移動）
    if (!checkCollision(nextX, player.y)) player.x = nextX;
    if (!checkCollision(player.x, nextY)) player.y = nextY;

    // イベント発生チェック
    checkEvents();
}

// 衝突判定（黒いピクセルは壁）
function checkCollision(x, y) {
    if (x < 0 || x > mapImage.width || y < 0 || y > mapImage.height) return true;
    const p = collisionCtx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    // RGBすべてが50未満なら「黒」とみなす
    if (p[0] < 50 && p[1] < 50 && p[2] < 50) return true;
    return false;
}

// 描画処理
function draw() {
    // 背景クリア
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!mapImage.complete) return;

    // マップ描画
    ctx.drawImage(mapImage, gameOffsetX, gameOffsetY, mapImage.width * scaleFactor, mapImage.height * scaleFactor);

    if (isGameRunning) {
        // --- 軌跡の描画 ---
        if (movementHistory.length > 1) {
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(0, 255, 255, 0.6)'; // 水色
            ctx.lineWidth = 3;
            const startX = gameOffsetX + (movementHistory[0].x * scaleFactor);
            const startY = gameOffsetY + (movementHistory[0].y * scaleFactor);
            ctx.moveTo(startX, startY);

            for (let i = 1; i < movementHistory.length; i++) {
                const px = gameOffsetX + (movementHistory[i].x * scaleFactor);
                const py = gameOffsetY + (movementHistory[i].y * scaleFactor);
                ctx.lineTo(px, py);
            }
            // 現在位置まで線を引く
            ctx.lineTo(gameOffsetX + (player.x * scaleFactor), gameOffsetY + (player.y * scaleFactor));
            ctx.stroke();
        }

        // --- プレイヤー描画 ---
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

        // 名前表示
        ctx.fillStyle = "white";
        ctx.font = `${12 * scaleFactor}px Meiryo`;
        ctx.textAlign = "center";
        ctx.fillText(player.id, sx, sy + sr + 15);

        // --- イベントピン描画 ---
        roomData.forEach(room => {
            // 発見済みならピンを表示
            if (room.isDiscovered) {
                // すべてのタスクが完了していれば青、そうでなければ赤
                const allCompleted = room.tasks.every(t => t.status === 'completed');
                const pinColor = allCompleted ? '#00ccff' : '#ff3333'; 
                const px = gameOffsetX + (room.x * scaleFactor);
                const py = gameOffsetY + (room.y * scaleFactor);
                drawPin(px, py, pinColor, scaleFactor);
            }
        });
    }
}

// ピン描画関数
function drawPin(x, y, color, scale) {
    const size = 15 * scale;
    ctx.fillStyle = color;
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1;
    // 逆三角形
    ctx.beginPath();
    ctx.moveTo(x, y); 
    ctx.lineTo(x - (size/2), y - size);
    ctx.lineTo(x + (size/2), y - size);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // 上の丸
    ctx.beginPath();
    ctx.arc(x, y - size, size/2, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();
}

// --- 時間管理 ---
function addTime(minutes) {
    accumulatedTime += minutes;
    updateTimeGauge();
}

function updateTimeGauge() {
    let percent = (accumulatedTime / MAX_TIME_LIMIT) * 100;
    if (percent > 100) percent = 100;

    timerBarFill.style.width = percent + "%";
    timerText.textContent = `${accumulatedTime} / ${MAX_TIME_LIMIT} 分`;

    // ゲージの色変化
    if (percent < 50) timerBarFill.style.backgroundColor = "#00ff00"; // 緑
    else if (percent < 80) timerBarFill.style.backgroundColor = "#ffcc00"; // 黄
    else timerBarFill.style.backgroundColor = "#ff3333"; // 赤
}

// 制限時間チェック
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

    // 終了時に軌跡データを送信
    sendTrajectoryToGAS();

    // リザルトログの生成
    resultLogBody.innerHTML = "";
    logs.forEach(log => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${log.elapsedTime}</td><td>${log.location}</td><td>${log.event}</td><td>${log.choice}</td><td>${log.result}</td>`;
        resultLogBody.appendChild(tr);
    });

    resultScreen.style.display = 'flex';
}

// 終了画面へ（「終了する」ボタン）
window.showEndScreen = () => {
    resultScreen.style.display = 'none';
    endScreen.style.display = 'flex';
};

// --- CSVパース処理 ---
function parseCSV(text) {
    const lines = text.trim().split('\n');
    roomData = [];
    
    // 1行目はヘッダなのでスキップ
    for (let i = 1; i < lines.length; i++) {
        const row = parseCSVLine(lines[i]);
        if(row.length < 5) continue;

        // CSV列: 2:部屋名, 3:X, 4:Y, 5:半径, 6:順序
        const roomName = row[2];
        const x = parseInt(row[3]);
        const y = parseInt(row[4]);
        const r = parseInt(row[5]);
        const order = parseInt(row[6]); 

        // 部屋データを検索または作成
        let room = roomData.find(d => d.name === roomName && Math.abs(d.x - x) < 5 && Math.abs(d.y - y) < 5);
        if(!room) {
            room = { 
                name: roomName, x: x, y: y, radius: r, tasks: [], 
                isDiscovered: false,
                ignoreUntilExit: false, // 一時的な保留フラグ
                currentTaskIndex: 0     // 現在のタスク順序ポインタ
            };
            roomData.push(room);
        }

        // タスクデータの作成
        const task = {
            id: row[0],
            name: row[7],
            description: row[8],
            order: order, // ソート用順序
            choices: [],
            status: 'pending'
        };

        // 選択肢の読み込み (最大4つ)
        // [名称, 結果テキスト, 時間]
        if(row[9]) task.choices.push({ text: row[9], result: row[10], time: parseInt(row[11]||0) });
        if(row[12]) task.choices.push({ text: row[12], result: row[13], time: parseInt(row[14]||0) });
        if(row[15]) task.choices.push({ text: row[15], result: row[16], time: parseInt(row[17]||0) });
        if(row[18]) task.choices.push({ text: row[18], result: row[19], time: parseInt(row[20]||0) });

        room.tasks.push(task);
    }

    // ★重要: 各部屋のタスクを「イベント順序」で昇順ソート
    roomData.forEach(room => {
        room.tasks.sort((a, b) => a.order - b.order);
    });
}

// CSV行分割（引用符対応）
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

// --- イベント発生チェック ---
function checkEvents() {
    if(eventPopup.style.display === 'flex') return;

    for (let i = 0; i < roomData.length; i++) {
        const room = roomData[i];
        const dist = Math.hypot(player.x - room.x, player.y - room.y);

        if (dist < room.radius) {
            room.isDiscovered = true;
            if (room.ignoreUntilExit) continue; // 「保留」で範囲外に出るまで無視

            // すべて完了していれば何もしない
            const pendingCount = room.tasks.filter(t => t.status === 'pending').length;
            if(pendingCount === 0) continue;

            // ★循環・スキップロジック
            // ポインタが範囲外なら先頭(0)に戻す（循環）
            if(room.currentTaskIndex >= room.tasks.length) {
                room.currentTaskIndex = 0;
            }
            
            // 現在のポインタから順に「未完了(pending)」のタスクを探す
            let foundTask = null;
            let startIndex = room.currentTaskIndex;
            let count = 0;
            while(count < room.tasks.length) {
                let idx = (startIndex + count) % room.tasks.length;
                if(room.tasks[idx].status === 'pending') {
                    room.currentTaskIndex = idx; // 見つかった位置へポインタ更新
                    foundTask = room.tasks[idx];
                    break;
                }
                count++;
            }

            if (foundTask) {
                triggerEvent(room, foundTask);
                break; // 1フレームに1イベントのみ発生
            }
        } else {
            // 範囲外に出たら「保留」フラグ解除
            room.ignoreUntilExit = false;
        }
    }
}

// イベント表示処理
function triggerEvent(room, task) {
    keys = {}; // 移動停止
    document.getElementById('event-title').textContent = `場所: ${room.name}`;
    document.getElementById('event-desc').innerHTML = `<strong>${task.name}</strong><br>${task.description}`;
    
    const choicesDiv = document.getElementById('event-choices');
    choicesDiv.innerHTML = "";

    // 選択肢ボタン生成
    task.choices.forEach((c, index) => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.innerHTML = c.text; // 時間表示は削除
        // indexを渡す（選択肢4の判定用）
        btn.onclick = () => resolveEvent(room, task, c, index);
        choicesDiv.appendChild(btn);
    });

    // グローバル保留ボタン
    const holdBtn = document.createElement('button');
    holdBtn.className = 'choice-btn';
    holdBtn.style.backgroundColor = '#777';
    holdBtn.textContent = '保留（対応せず通過する）';
    holdBtn.onclick = () => {
        room.ignoreUntilExit = true; // 範囲外に出るまで無視
        eventPopup.style.display = 'none';
        
        // 保留もログに記録する
        recordLog(room, task, "保留", "対応を後回しにした");
    };
    choicesDiv.appendChild(holdBtn);

    document.getElementById('close-btn').style.display = 'none';
    eventPopup.style.display = 'flex';
}

// イベント結果処理
function resolveEvent(room, task, choice, choiceIndex) {
    // ★重要: 選択肢4 (index=3) が選ばれた場合は「pending」のままにする
    // これにより、次周回ってきたときに再度選択可能になる
    if(choiceIndex === 3) {
        task.status = 'pending';
    } else {
        task.status = 'completed';
    }

    // 時間加算
    addTime(choice.time || 0);
    // ログ記録
    recordLog(room, task, choice.text, choice.result);

    // 結果表示（時間表示は削除）
    document.getElementById('event-desc').innerHTML = `
        <div style="color:#5bc0de; font-weight:bold; margin-bottom:10px;">選択結果</div>
        ${choice.result}
    `;
    document.getElementById('event-choices').innerHTML = "";
    
    const closeBtn = document.getElementById('close-btn');
    closeBtn.style.display = 'block';
    closeBtn.textContent = "確認";
    closeBtn.onclick = () => {
        eventPopup.style.display = 'none';
        
        // 時間チェック
        if(checkTimeLimit()) return;
        
        // ★重要: 次のタスクへ進めるためにポインタをインクリメント
        room.currentTaskIndex++;
        
        if(task.status === 'completed') {
            statusDiv.textContent = `✅ ${task.name} 完了`;
        } else {
            statusDiv.textContent = `⏭️ ${task.name} 次へ`;
        }
    };
}

// ログ記録・送信・表示共通関数
function recordLog(room, task, choiceText, resultText) {
    const now = new Date();
    const logEntry = {
        type: 'event', // イベントログ識別子
        playerId: player.id,
        timestamp: now.toLocaleString(),
        elapsedTime: accumulatedTime + "分",
        location: room.name,
        event: task.name,
        choice: choiceText,
        result: resultText
    };
    logs.push(logEntry);
    sendToGAS(logEntry);
    addLogToScreen(room.name, task.name, choiceText);
}

// 画面右側のログ表示
function addLogToScreen(location, event, choice) {
    const div = document.createElement('div');
    div.className = 'log-item';
    div.innerHTML = `
        <span class="log-time">[${accumulatedTime}分]</span>
        <span class="log-event">${location}</span><br>
        選択: ${choice}
    `;
    logSection.prepend(div);
}

// --- GAS連携 ---
function sendToGAS(data) {
    fetch(GAS_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }).catch(err => console.error(err));
}

// 軌跡データの送信（ゲーム終了時）
function sendTrajectoryToGAS() {
    if (movementHistory.length === 0) return;
    const payload = {
        type: 'trajectory', // 軌跡データ識別子
        playerId: player.id,
        history: movementHistory
    };
    sendToGAS(payload);
}

// --- スタートボタン ---
document.getElementById('btn-start').onclick = () => {
    const id = playerIdInput.value;
    if(!id) { alert("IDを入力してください"); return; }
    player.id = id;
    document.getElementById('top-screen').style.display = 'none';
    isGameRunning = true;
    
    // 初期位置設定
    player.x = 508;
    player.y = 500;
    movementHistory = [{x:508, y:500, time:0}]; 
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
    logs.forEach(log => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${log.playerId}</td><td>${log.timestamp}</td><td>${log.elapsedTime}</td><td>${log.location}</td><td>${log.event}</td><td>${log.choice}</td><td>${log.result}</td>`;
        tbody.appendChild(tr);
    });
}
window.clearAllLogs = () => { if(confirm("ログ削除？")) { logs=[]; renderAdminLogs(); }};

// ログCSVダウンロード（BOM付き）
window.downloadAllLogs = () => {
    let csvContent = "ID,日時,経過,場所,イベント,選択,結果\n" + logs.map(l => 
        `${l.playerId},${l.timestamp},${l.elapsedTime},${l.location},${l.event},${l.choice},${l.result}`
    ).join("\n");
    
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, csvContent], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "event_logs.csv";
    document.body.appendChild(link);
    link.click();
};

// 軌跡CSVダウンロード（BOM付き）
window.downloadPathLogs = () => {
    let csvContent = "Time,X,Y\n" + movementHistory.map(m => 
        `${m.time},${m.x},${m.y}`
    ).join("\n");

    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, csvContent], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "path_logs.csv";
    document.body.appendChild(link);
    link.click();
};