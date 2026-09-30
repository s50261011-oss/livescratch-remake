const app = document.getElementById("app");

const state = {
  screen: "login",
  menu: false,
  language: localStorage.getItem("ls_language") || "ja",
  user: JSON.parse(localStorage.getItem("ls_user") || "null"),
  code: null,
  room: null,
  messages: [{user:"System", text:"ルームへようこそ！"}]
};

const i18n = {
  ja:{login:"ログイン",name:"アカウント名",next:"次へ",code:"認証コード",verify:"認証する",roomSelect:"ルーム選択",publicRooms:"公開ルーム",createRoom:"ルームを作成",joinCode:"コードで参加",menu:"メニュー",search:"ルーム / Userを検索",rooms:"ルーム",videos:"動画",history:"履歴",friends:"友達",extensions:"TurboWarp拡張機能",settings:"アカウント設定",logout:"ログアウト",chat:"チャット",mic:"マイク",speaker:"相手の音声",record:"録音",profile:"プロフィール",bio:"自己紹介",username:"username",language:"言語",delete:"アカウント削除",save:"保存",back:"戻る"},
  en:{login:"Log in",name:"Account name",next:"Next",code:"Verification code",verify:"Verify",roomSelect:"Room selection",publicRooms:"Public rooms",createRoom:"Create room",joinCode:"Join by code",menu:"Menu",search:"Search rooms / users",rooms:"Rooms",videos:"Videos",history:"History",friends:"Friends",extensions:"TurboWarp extensions",settings:"Account settings",logout:"Log out",chat:"Chat",mic:"Microphone",speaker:"Other users' audio",record:"Record",profile:"Profile",bio:"Bio",username:"Username",language:"Language",delete:"Delete account",save:"Save",back:"Back"}
};

function t(k){return (i18n[state.language]||i18n.ja)[k]||k}
function render(){ if(state.screen==="login") return renderLogin(); if(state.screen==="verify") return renderVerify(); if(state.screen==="rooms") return renderRooms(); if(state.screen==="room") return renderRoom(); return renderPage(state.screen); }

function renderLogin(){
  app.innerHTML=`<main class="screen center"><section class="card">
    <h1 class="title">LiveScratch-remake</h1><p class="sub">${t("login")}</p>
    <input id="name" class="field" placeholder="${t("name")}">
    <button class="btn" id="next">${t("next")}</button>
    <p class="hint">Phase 1試作版：認証コードは実際のAPIではなくデモ生成です。</p>
  </section></main>`;
  document.getElementById("next").onclick=()=>{
    const name=document.getElementById("name").value.trim();
    if(!name)return toast("アカウント名を入力してください");
    state.code=String(Math.floor(100000+Math.random()*900000));
    state.user={originalName:name,username:name,avatar:"🙂",bio:""};
    state.screen="verify";render();
    toast("デモ認証コード: "+state.code);
  };
}

function renderVerify(){
  app.innerHTML=`<main class="screen center"><section class="card">
    <h1 class="title">${t("code")}</h1><p class="sub">10分間だけ有効なコード（試作版）</p>
    <input id="code" class="field" inputmode="numeric" placeholder="123456">
    <button class="btn" id="verify">${t("verify")}</button>
    <p id="err" class="error"></p>
  </section></main>`;
  document.getElementById("verify").onclick=()=>{
    if(document.getElementById("code").value!==state.code){document.getElementById("err").textContent="コードが違います。";return}
    localStorage.setItem("ls_user",JSON.stringify(state.user));
    state.screen="rooms";render();
  };
}

function menu(){
  return `<button class="menu-btn" id="menuBtn">☰</button>
  <aside class="sidebar ${state.menu?"open":""}">
    <div class="side-title">${t("menu")}</div>
    ${[
      ["search","🔎"],["rooms","🏠"],["videos","🎬"],["history","📜"],["friends","👥"],["extensions","🧩"],["settings","⚙️"],["logout","🚪"]
    ].map(([x,icon])=>`<button class="menu-item" data-page="${x}">${icon} ${t(x)}</button>`).join("")}
  </aside>`;
}

function bindMenu(){
  document.getElementById("menuBtn").onclick=()=>{state.menu=!state.menu;render()};
  document.querySelectorAll("[data-page]").forEach(b=>b.onclick=()=>{
    const p=b.dataset.page;
    if(p==="logout"){localStorage.removeItem("ls_user");state.user=null;state.screen="login";state.menu=false;render();return}
    state.screen=p;state.menu=false;render();
  });
}

function renderRooms(){
  app.innerHTML=`${menu()}<div class="topbar"><span class="room-name">${t("roomSelect")}</span></div>
  <main>
    <div class="room-actions">
      <button class="btn" id="create">${t("createRoom")}</button>
      <button class="btn secondary" id="join">${t("joinCode")}</button>
    </div>
    <h2 style="padding:0 24px">${t("publicRooms")}</h2>
    <div class="room-grid">
      ${["Scratch雑談ルーム","作品制作ルーム","TurboWarp開発ルーム"].map((r,i)=>`<article class="room-card"><h3>${r}</h3><p>公開ルーム · ${i+2}人参加中</p><button class="btn" data-room="${r}">参加</button></article>`).join("")}
    </div>
  </main>`;
  bindMenu();
  document.getElementById("create").onclick=()=>{const n=prompt("ルーム名");if(n)enterRoom(n)};
  document.getElementById("join").onclick=()=>{const c=prompt("ルームコード");if(c)enterRoom("コード "+c)};
  document.querySelectorAll("[data-room]").forEach(b=>b.onclick=()=>enterRoom(b.dataset.room));
}

function enterRoom(name){state.room=name;state.screen="room";state.messages=[{user:"System",text:`${name} に参加しました。`}];render()}

function renderRoom(){
  app.innerHTML=`${menu()}<div class="topbar"><span class="room-name">🏠 ${escapeHtml(state.room||"Room")}</span></div>
  <main class="room-layout">
    <section class="chat">
      <div class="chat-head">${t("chat")}</div>
      <div class="messages" id="messages">${state.messages.map(m=>`<div class="message"><b>${escapeHtml(m.user)}</b><span>${escapeHtml(m.text)}</span></div>`).join("")}</div>
      <div class="voice">
        <button class="btn secondary" id="mic">🎙️ ${t("mic")} ON</button>
        <button class="btn secondary" id="speaker">🔊 ${t("speaker")} ON</button>
        <button class="btn secondary" id="record">⏺ ${t("record")}</button>
      </div>
      <div class="chat-controls"><input id="msg" class="chat-input" placeholder="メッセージ..."></div>
    </section>
    <section class="tw"><div class="tw-placeholder"><strong>TurboWarp</strong><span>ここにTurboWarpを接続します（Phase 2以降）</span></div></section>
  </main>`;
  bindMenu();
  const msg=document.getElementById("msg");
  msg.addEventListener("keydown",e=>{if(e.key==="Enter"&&msg.value.trim()){state.messages.push({user:state.user?.username||"You",text:msg.value.trim()});msg.value="";render()}});
  let mic=true,speaker=true,recording=false;
  document.getElementById("mic").onclick=()=>{mic=!mic;document.getElementById("mic").textContent=`🎙️ ${t("mic")} ${mic?"ON":"OFF"}`};
  document.getElementById("speaker").onclick=()=>{speaker=!speaker;document.getElementById("speaker").textContent=`🔊 ${t("speaker")} ${speaker?"ON":"OFF"}`};
  document.getElementById("record").onclick=()=>{recording=!recording;document.getElementById("record").textContent=recording?"⏹ 録音停止":"⏺ 録音"};
}

function renderPage(page){
  const title=t(page);
  let body="";
  if(page==="search") body=`<div class="panel"><h2>${title}</h2><input class="field" placeholder="User / ルームを検索"><button class="btn">検索</button></div>`;
  if(page==="videos") body=`<div class="panel"><h2>${title}</h2><p class="sub">Scratchの画面録画を投稿・視聴する場所です。</p><button class="btn">動画を投稿</button></div><div class="video-grid">${["Scratch作品紹介","制作過程","ゲームプレイ"].map(x=>`<article class="video-card"><div class="video-thumb">▶</div><div class="video-info">${x}</div></article>`).join("")}</div>`;
  if(page==="history") body=`<div class="panel"><h2>${title}</h2><h3>入ったルーム</h3><p>まだ履歴はありません。</p><h3>見た動画</h3><p>まだ履歴はありません。</p></div>`;
  if(page==="friends") body=`<div class="panel"><h2>${title}</h2><p>友達がここに表示され、承認済みの友達へDMできます。</p></div>`;
  if(page==="extensions") body=`<div class="panel"><h2>${title}</h2><p>スクラッチャーが作ったTurboWarp拡張機能のJavaScriptを公開する場所です。</p><button class="btn">拡張機能を公開</button></div>`;
  if(page==="settings") body=settingsPage();
  if(page==="rooms") return renderRooms();
  app.innerHTML=`${menu()}<main class="page"><h1>${title}</h1>${body}</main>`;
  bindMenu();
  if(page==="settings")bindSettings();
}

function settingsPage(){
  const u=state.user||{username:"Guest",originalName:"",avatar:"🙂",bio:""};
  return `<div class="panel"><div class="profile"><div class="avatar">${escapeHtml(u.avatar)}</div><div><h2>${escapeHtml(u.username)}</h2><small>${escapeHtml(u.originalName)}</small></div></div></div>
  <div class="panel">
    <div class="setting-row"><div><b>${t("username")}</b><small>LiveScratch-remake上の表示名</small></div><input id="username" class="field" style="max-width:300px;margin:0" value="${escapeAttr(u.username)}"></div>
    <div class="setting-row"><div><b>アイコン</b></div><input id="avatar" class="field" style="max-width:120px;margin:0" value="${escapeAttr(u.avatar)}"></div>
    <div class="setting-row"><div><b>${t("bio")}</b></div><textarea id="bio" class="field" style="max-width:300px;margin:0">${escapeHtml(u.bio)}</textarea></div>
    <div class="setting-row"><div><b>${t("language")}</b></div><select id="language" class="field" style="max-width:180px;margin:0"><option value="ja" ${state.language==="ja"?"selected":""}>日本語</option><option value="en" ${state.language==="en"?"selected":""}>English</option></select></div>
    <button class="btn" id="save">${t("save")}</button>
  </div>
  <div class="panel"><button class="btn danger" id="delete">${t("delete")}</button></div>`;
}
function bindSettings(){
  document.getElementById("save").onclick=()=>{
    state.user.username=document.getElementById("username").value.trim()||state.user.originalName;
    state.user.avatar=document.getElementById("avatar").value||"🙂";
    state.user.bio=document.getElementById("bio").value;
    state.language=document.getElementById("language").value;
    localStorage.setItem("ls_user",JSON.stringify(state.user));
    localStorage.setItem("ls_language",state.language);
    render();toast("設定を保存しました");
  };
  document.getElementById("delete").onclick=()=>{
    if(confirm("試作版：ローカルのアカウント情報を削除します。よろしいですか？")){localStorage.clear();state.user=null;state.screen="login";render()}
  };
}
function toast(s){const x=document.createElement("div");x.className="toast";x.textContent=s;document.body.appendChild(x);setTimeout(()=>x.remove(),3500)}
function escapeHtml(s=""){return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function escapeAttr(s=""){return escapeHtml(s)}
render();
