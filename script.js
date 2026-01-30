const GAS_URL = "https://script.google.com/macros/s/AKfycbwATkMNs5G_V5qde_lG8ch8z3thTfjPvJA_sj5klz-NwHWkwvNMUNVkYnphx6EHpqX_/exec"

// --- 画像ファイル設定 ---
const MAP_SRC = "./map.bmp";
const COLLISION_SRC = "./map_collision.bmp";
const CSV_SRC = "./data.csv";

// --- DOM要素 ---
const canvas = document.getElementById('map-canvas');
const ctx = canvas.getContext('2d');
const statusDiv = document.getElementById('status-message');
const debugCoords = document.getElementById('coord-display');
const playerIdInput = document.getElementById('player-id-input');
const eventPopup = document.getElementById('event-popup');

// 当たり判定用（画面には表示しない）
const collisionCanvas = document.createElement('canvas');
const collisionCtx = collisionCanvas.getContext('2d');

// --- ゲーム状態変数 ---
let mapImage = new Image();
let collisionImage = new Image();
let scaleFactor = 1; // 拡大縮小率
let gameOffsetX = 0; // X方向の余白
let gameOffsetY = 0; // Y方向の余白

// 初期座標はスタート時に上書きされますが、安全のため定義
let player = { x: 542, y: 501, radius: 10, speed: 4, id: "" };
let keys = {};
let roomData = []; // CSVデータ格納用
let logs = [];     // ログ格納用
let gameStartTime = 0;
let isGameRunning = false;

// --- 初期化シーケンス ---
mapImage.src = MAP_SRC;
collisionImage.src = COLLISION_SRC;

let imagesLoaded = 0;
function onImageLoad() {
    imagesLoaded++;
    if (imagesLoaded === 2) {
        // 画像読み込み完了後に実行
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

// --- 画面リサイズ・スケーリング処理 ---
function initGameSize() {
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    // キャンバスを画面いっぱいに設定
    canvas.width = winW;
    canvas.height = winH;

    // 当たり判定用キャンバスは「元画像のサイズ」で固定
    collisionCanvas.width = mapImage.width;
    collisionCanvas.height = mapImage.height;
    collisionCtx.drawImage(collisionImage, 0, 0);

    // 画像が画面に収まる最大サイズを計算 (Contain)
    const scaleW = winW / mapImage.width;
    const scaleH = winH / mapImage.height;
    scaleFactor = Math.min(scaleW, scaleH);

    // 中央寄せのためのオフセット計算
    gameOffsetX = (winW - (mapImage.width * scaleFactor)) / 2;
    gameOffsetY = (winH - (mapImage.height * scaleFactor)) / 2;
}

// ブラウザのサイズが変わったら再計算
window.addEventListener('resize', initGameSize);

// --- 入力ハンドリング ---
window.addEventListener('keydown', e => keys[e.key] = true);
window.addEventListener('keyup', e => keys[e.key] = false);

// マウス移動（座標確認・デバッグ用）
canvas.addEventListener('mousemove', (e) => {
    // 画面上のマウス位置
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // 元画像の座標に変換
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
    if (eventPopup.style.display === 'flex') return; // イベント中は動けない

    // 移動処理
    let dx = 0; let dy = 0;
    if (keys['ArrowUp'] || keys['w']) dy = -player.speed;
    if (keys['ArrowDown'] || keys['s']) dy = player.speed;
    if (keys['ArrowLeft'] || keys['a']) dx = -player.speed;
    if (keys['ArrowRight'] || keys['d']) dx = player.speed;

    // 斜め移動の速度補正
    if (dx !== 0 && dy !== 0) {
        dx *= 0.71;
        dy *= 0.71;
    }

    const nextX = player.x + dx;
    const nextY = player.y + dy;

    // 衝突判定（元画像の座標系で行う）
    if (!checkCollision(nextX, player.y)) player.x = nextX;
    if (!checkCollision(player.x, nextY)) player.y = nextY;

    // イベント発生チェック
    checkEvents();
}

function checkCollision(x, y) {
    if (x < 0 || x > mapImage.width || y < 0 || y > mapImage.height) return true;
    
    // 当たり判定画像のピクセル色を取得
    const p = collisionCtx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    // 黒っぽい色(RGB<50)なら壁とみなす
    if (p[0] < 50 && p[1] < 50 && p[2] < 50) return true;
    return false;
}

function draw() {
    // 背景（黒余白）
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!mapImage.complete) return;

    // マップ描画 (オフセットとスケールを適用)
    ctx.drawImage(
        mapImage, 
        gameOffsetX, gameOffsetY, 
        mapImage.width * scaleFactor, mapImage.height * scaleFactor
    );

    if (isGameRunning) {
        // --- プレイヤー描画 (人型アイコン) ---
        // 元座標 -> 画面座標へ変換
        const sx = gameOffsetX + (player.x * scaleFactor);
        const sy = gameOffsetY + (player.y * scaleFactor);
        const sr = player.radius * scaleFactor;

        // 人型の色設定
        ctx.fillStyle = '#00f0ff'; // シアン色
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;

        // 頭部 (円)
        ctx.beginPath();
        // 頭の位置を少し上にずらす
        ctx.arc(sx, sy - sr * 0.4, sr * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // 体 (半円/釣鐘型)
        ctx.beginPath();
        // 肩のライン
        ctx.moveTo(sx - sr, sy + sr);
        // 滑らかな曲線で肩を描く
        ctx.quadraticCurveTo(sx, sy - sr * 0.5, sx + sr, sy + sr);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 名前表示 (足元)
        ctx.fillStyle = "white";
        ctx.font = `${12 * scaleFactor}px Arial`;
        ctx.textAlign = "center";
        ctx.fillText(player.id, sx, sy + sr + 15);

        // ★ 変更点: イベントの赤い丸を描画するコードを削除しました ★
        // これによりマップ上には何も表示されませんが、
        // 近づくと checkEvents() で感知してイベントが発生します。
    }
}

// --- CSV処理 ---
function parseCSV(text) {
    const lines = text.trim().split('\n');
    roomData = [];
    
    // 1行目はヘッダなのでスキップ
    for (let i = 1; i < lines.length; i++) {
        const row = parseCSVLine(lines[i]);
        if(row.length < 5) continue;

        const roomName = row[2];
        const x = parseInt(row[3]);
        const y = parseInt(row[4]);
        const r = parseInt(row[5]);

        let room = roomData.find(d => d.name === roomName && Math.abs(d.x - x) < 5 && Math.abs(d.y - y) < 5);
        if(!room) {
            room = { name: roomName, x: x, y: y, radius: r, tasks: [] };
            roomData.push(room);
        }

        const task = {
            id: row[0],
            name: row[7],
            description: row[8],
            choices: [],
            status: 'pending'
        };

        if(row[9]) task.choices.push({ text: row[9], result: row[10], time: row[11] });
        if(row[12]) task.choices.push({ text: row[12], result: row[13], time: row[14] });
        if(row[15]) task.choices.push({ text: row[15], result: row[16], time: row[17] });
        if(row[18]) task.choices.push({ text: row[18], result: row[19], time: row[20] });

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

        const pendingTask = room.tasks.find(t => t.status === 'pending');
        if (dist < room.radius && pendingTask) {
            triggerEvent(room, pendingTask);
            break;
        }
    }
}

function triggerEvent(room, task) {
    keys = {}; // 移動停止
    document.getElementById('event-title').textContent = `場所: ${room.name}`;
    document.getElementById('event-desc').innerHTML = `<strong>${task.name}</strong><br>${task.description}`;
    
    const choicesDiv = document.getElementById('event-choices');
    choicesDiv.innerHTML = "";

    task.choices.forEach(c => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.textContent = c.text;
        btn.onclick = () => resolveEvent(room, task, c);
        choicesDiv.appendChild(btn);
    });

    // 保留ボタン
    const holdBtn = document.createElement('button');
    holdBtn.className = 'choice-btn';
    holdBtn.style.backgroundColor = '#777';
    holdBtn.textContent = '保留（後で対応する）';
    holdBtn.onclick = () => {
        eventPopup.style.display = 'none';
        player.y += 20; // 戻る処理
    };
    choicesDiv.appendChild(holdBtn);

    document.getElementById('close-btn').style.display = 'none';
    eventPopup.style.display = 'flex';
}

function resolveEvent(room, task, choice) {
    task.status = 'completed';

    const now = new Date();
    const elapsed = Math.floor((Date.now() - gameStartTime) / 60000);
    const logEntry = {
        playerId: player.id,
        timestamp: now.toLocaleString(),
        elapsedTime: elapsed + "分",
        location: room.name,
        event: task.name,
        choice: choice.text,
        result: choice.result
    };
    logs.push(logEntry);
    
    // GAS送信
    sendToGAS(logEntry);

    // 結果表示
    document.getElementById('event-desc').innerHTML = `
        <div style="color:#5bc0de; font-weight:bold; margin-bottom:10px;">選択結果</div>
        ${choice.result}<br><br>
        <span style="color:#aaa;">経過時間: +${choice.time || 0}分</span>
    `;
    document.getElementById('event-choices').innerHTML = "";
    
    const closeBtn = document.getElementById('close-btn');
    closeBtn.style.display = 'block';
    closeBtn.textContent = "確認";
    closeBtn.onclick = () => {
        eventPopup.style.display = 'none';
        statusDiv.textContent = `✅ ${task.name} 完了`;
        setTimeout(()=>statusDiv.textContent="", 3000);
    };
}

// --- GAS連携 ---
function sendToGAS(data) {
    if(GAS_URL.indexOf("script.google.com") === -1) {
        console.warn("GAS_URLが設定されていません");
        return;
    }
    fetch(GAS_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    })
    .then(() => console.log("Log sent to GAS"))
    .catch(err => console.error("GAS Error:", err));
}

// --- スタートボタン ---
document.getElementById('btn-start').onclick = () => {
    const id = playerIdInput.value;
    if(!id) { alert("IDを入力してください"); return; }
    player.id = id;
    document.getElementById('top-screen').style.display = 'none';
    isGameRunning = true;
    gameStartTime = Date.now();
    statusDiv.textContent = "移動: 矢印キー または WASD";

    // ★ 変更点: 指定された座標からスタート ★
    player.x = 542;
    player.y = 501;
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