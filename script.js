// doPost関数：ゲーム側からデータが送られてきたときに自動で実行される処理
function doPost(e) {
  var json;
  try {
    json = JSON.parse(e.postData.contents);
  } catch(error) {
    // データがない（手動で実行したなど）場合のエラー回避
    console.error("JSON Parse Error: " + error.message);
    return ContentService.createTextOutput("JSON Error").setMimeType(ContentService.MimeType.TEXT);
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // セッション情報（全体回数、個人回数など）の取得・生成
  var sessionInfo = getSessionInfo(ss, json.playerId, json.sessionUUID, json.startTime);

  // ■ 1. 画像データの場合
  if (json.type === 'image') {
    var folderName = "TrajectoryImages"; // Googleドライブに作られるフォルダ名
    var folder;
    
    // フォルダがなければ作成、あれば取得
    var folders = DriveApp.getFoldersByName(folderName);
    if (folders.hasNext()) {
      folder = folders.next();
    } else {
      folder = DriveApp.createFolder(folderName);
    }

    // Base64文字列をデコードして画像ファイル(JPEG)を作成
    var decoded = Utilities.base64Decode(json.image);
    var fileName = sessionInfo.dateStr.replace(/[\/:\s]/g, '_') + "_" + json.playerId + ".jpg";
    var blob = Utilities.newBlob(decoded, MimeType.JPEG, fileName);
    
    // ドライブに保存し、URLを取得
    var file = folder.createFile(blob);
    var fileUrl = file.getUrl(); 

    // シートに書き込み
    var sheet = ss.getSheetByName('Images');
    if (!sheet) {
      sheet = ss.insertSheet('Images');
    }
    // シートが空ならヘッダー追加
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['ID', 'Global_No', 'Personal_No', 'Date', 'Image URL']);
    }

    sheet.appendRow([
      json.playerId,
      sessionInfo.globalCount,
      sessionInfo.personalCount,
      sessionInfo.dateStr,
      fileUrl
    ]);
  } 

  // ■ 2. 軌跡データの場合
  else if (json.type === 'trajectory') {
    var sheet = ss.getSheetByName('Trajectory');
    if (!sheet) {
      sheet = ss.insertSheet('Trajectory');
    }
    
    // シートが空ならヘッダー再生成
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['ID', 'Global_No', 'Personal_No', 'SessionStart', 'PointRealTime', 'SimTime(min)', 'X', 'Y']);
    }

    if (json.history && json.history.length > 0) {
      var rows = json.history.map(function(point) {
        return [
          json.playerId,
          sessionInfo.globalCount,
          sessionInfo.personalCount,
          sessionInfo.dateStr,
          point.realTime,
          point.time,
          point.x,
          point.y
        ];
      });

      // 2000行ずつ分割して書き込む（データ量超過エラー防止）
      var batchSize = 2000;
      for (var i = 0; i < rows.length; i += batchSize) {
        var batch = rows.slice(i, i + batchSize);
        sheet.getRange(sheet.getLastRow() + 1, 1, batch.length, 8).setValues(batch);
      }
    }
  } 

  // ■ 3. イベントログの場合
  else {
    var sheet = ss.getSheetByName('Log');
    if (!sheet) {
      sheet = ss.insertSheet('Log');
    }

    // シートが空ならヘッダー再生成
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        'ID', 'Global_No', 'Personal_No', 'SessionStart', 
        'EventRealTime', 'SimTime', 'DecisionTime(sec)', 
        'Location', 'Event', 'Choice', 'Result'
      ]);
    }

    sheet.appendRow([
      json.playerId,
      sessionInfo.globalCount,
      sessionInfo.personalCount,
      sessionInfo.dateStr,
      json.timestamp,
      json.elapsedTime,
      json.decisionTime,
      json.location,
      json.event,
      json.choice,
      json.result
    ]);
  }
  
  return ContentService.createTextOutput("Success").setMimeType(ContentService.MimeType.TEXT);
}

// --------------------------------------------------------
// ヘルパー関数: セッションID（訓練1回ごとの一意のID）で回数を管理
function getSessionInfo(ss, playerId, uuid, dateStr) {
  var manageSheet = ss.getSheetByName('SessionList');
  if (!manageSheet) {
    manageSheet = ss.insertSheet('SessionList');
  }
  
  if (manageSheet.getLastRow() === 0) {
    manageSheet.appendRow(['SessionUUID', 'PlayerID', 'Date', 'Global_No', 'Personal_No']);
  }

  // 既にこのセッションIDが登録されているか探す
  var found = manageSheet.getRange("A:A").createTextFinder(uuid).matchEntireCell(true).findNext();

  if (found) {
    // 登録済みなら過去のデータをそのまま使う
    var row = found.getRow();
    var values = manageSheet.getRange(row, 1, 1, 5).getValues()[0];
    return { globalCount: values[3], personalCount: values[4], dateStr: values[2] };
  } else {
    // 未登録なら新しくカウントアップする
    var lastRow = manageSheet.getLastRow();
    var globalCount = lastRow; // データの行数をそのまま全体回数とする
    if(globalCount === 0) globalCount = 1;

    var personalCount = 1;
    if (lastRow > 1) {
        var data = manageSheet.getRange(2, 1, lastRow - 1, 5).getValues();
        for (var i = 0; i < data.length; i++) {
          if (data[i][1] == playerId) personalCount++;
        }
    }

    manageSheet.appendRow([uuid, playerId, dateStr, globalCount, personalCount]);
    return { globalCount: globalCount, personalCount: personalCount, dateStr: dateStr };
  }
}

// --------------------------------------------------------
// ★強制的に権限承認画面を出すためのテスト関数（初回のみ使用）
function testAuth() {
  var folder = DriveApp.createFolder("TestFolder_DeleteMe");
  folder.setTrashed(true); // すぐにゴミ箱に移動します
  console.log("ドライブへのアクセス承認が完了しました。");
}