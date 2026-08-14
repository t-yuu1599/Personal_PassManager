import { authenticateGoogle, googleConfigured, microsoftConfigured, getMicrosoftAccessToken, clearMicrosoftAccessToken } from './auth.js';

const DB_NAME = 'kagicho-vault';
const DB_VERSION = 1;
const STORE = 'secure';
const DEFAULT_CATEGORIES = ['通販','金融','保険','ソフトウェア','通信','公共料金','行政','仕事','SNS','動画・配信','ゲーム','ショッピング','その他'];
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const SERVICE_RULES = [
  {match:/amazon/i,name:'Amazon',reading:'アマゾン',category:'通販',tags:['EC','買い物','配送','ショッピング']},
  {match:/github/i,name:'GitHub',reading:'ギットハブ',category:'ソフトウェア',tags:['開発','Git']},
  {match:/google/i,name:'Google',reading:'グーグル',category:'ソフトウェア',tags:['検索','クラウド']},
  {match:/microsoft/i,name:'Microsoft',reading:'マイクロソフト',category:'ソフトウェア',tags:['Windows','Office','PC']},
  {match:/apple/i,name:'Apple',reading:'アップル',category:'ソフトウェア',tags:['iPhone','Mac']},
  {match:/netflix/i,name:'Netflix',reading:'ネットフリックス',category:'動画・配信',tags:['動画','映画']},
  {match:/youtube/i,name:'YouTube',reading:'ユーチューブ',category:'動画・配信',tags:['動画','Google']},
  {match:/(x\.com|twitter)/i,name:'X',reading:'エックス',category:'SNS',tags:['SNS']},
  {match:/instagram/i,name:'Instagram',reading:'インスタグラム',category:'SNS',tags:['SNS','写真']},
  {match:/rakuten/i,name:'楽天',reading:'ラクテン',category:'通販',tags:['EC','買い物']},
  {match:/yahoo/i,name:'Yahoo!',reading:'ヤフー',category:'通信',tags:['検索','メール']}
];

const $ = id => document.getElementById(id);
const ui = Object.fromEntries(['searchInput','clearSearch','categoryChips','resultTitle','resultCount','credentialList','emptyState','emptyTitle','emptyMessage','addButton','editorDialog','editorForm','editorTitle','recordId','serviceName','userId','password','generatePassword','url','category','tags','reading','memo','advancedFields','deleteButton','settingsButton','settingsDialog','closeSettings','lockTimeout','exportButton','importButton','importFile','lockButton','lockDialog','unlockButton','toast','syncButton','syncStatus','categoryOptions','googleAccountText','googleConnectButton','oneDriveAccountText','oneDriveConnectButton','authDialog','googleSignInButton','authError'].map(id => [id,$(id)]));

let db;
let vaultKey = null;
let state = freshState();
let selectedCategory = '';
let lockTimer;
let revealTimers = new Map();
let saveQueue = Promise.resolve();
let currentGoogleUser = null;
let syncInProgress = false;
let syncProblem = '';

function freshState(){return {formatVersion:1,revision:0,updatedAt:new Date(0).toISOString(),deviceId:crypto.randomUUID(),records:[],categories:[...DEFAULT_CATEGORIES],settings:{lockMinutes:15,google:null,microsoft:null},dirty:false};}
function bytesToBase64(bytes){let s=''; for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000)); return btoa(s);}
function base64ToBytes(value){const s=atob(value), out=new Uint8Array(s.length); for(let i=0;i<s.length;i++)out[i]=s.charCodeAt(i); return out;}
function request(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}

async function openDatabase(){
  db=await new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>req.result.createObjectStore(STORE);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
}
async function dbGet(key){return request(db.transaction(STORE).objectStore(STORE).get(key));}
async function dbPut(key,value){return request(db.transaction(STORE,'readwrite').objectStore(STORE).put(value,key));}

async function initializeKeys(){
  let deviceKey=await dbGet('deviceKey');
  let wrapped=await dbGet('wrappedVaultKey');
  if(!deviceKey || !wrapped){
    deviceKey=await crypto.subtle.generateKey({name:'AES-KW',length:256},false,['wrapKey','unwrapKey']);
    vaultKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
    wrapped=await crypto.subtle.wrapKey('raw',vaultKey,deviceKey,'AES-KW');
    await dbPut('deviceKey',deviceKey); await dbPut('wrappedVaultKey',wrapped);
  }else{
    vaultKey=await crypto.subtle.unwrapKey('raw',wrapped,deviceKey,'AES-KW',{name:'AES-GCM',length:256},true,['encrypt','decrypt']);
  }
}

async function encryptState(value){
  if(!vaultKey)throw new Error('Vault is locked');
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},vaultKey,encoder.encode(JSON.stringify(value)));
  return {version:1,algorithm:'AES-GCM',iv:bytesToBase64(iv),ciphertext:bytesToBase64(new Uint8Array(ciphertext))};
}
async function decryptState(blob){
  const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:base64ToBytes(blob.iv)},vaultKey,base64ToBytes(blob.ciphertext));
  return JSON.parse(decoder.decode(clear));
}
async function loadState(){
  const encrypted=await dbGet('vault');
  if(!encrypted){state=freshState();await persistState(false);return;}
  const defaults=freshState(),loaded=await decryptState(encrypted);
  state={...defaults,...loaded,settings:{...defaults.settings,...loaded.settings}};
  state.categories=[...new Set([...DEFAULT_CATEGORIES,...(state.categories||[])])];
}
async function persistState(markDirty=true){
  state.revision+=1;state.updatedAt=new Date().toISOString();state.dirty=markDirty;
  const snapshot=JSON.parse(JSON.stringify(state));
  saveQueue=saveQueue.then(async()=>dbPut('vault',await encryptState(snapshot))).catch(error=>{console.error('Vault save failed',error);showToast('保存に失敗しました');});
  await saveQueue;updateSyncStatus();
}
async function storeStateWithoutRevision(){
  const snapshot=JSON.parse(JSON.stringify(state));
  saveQueue=saveQueue.then(async()=>dbPut('vault',await encryptState(snapshot)));
  await saveQueue;
}

function normalize(value=''){
  return value.normalize('NFKC').toLowerCase().replace(/[\s\-_.・／/\\:：,，。!！?？'"「」『』【】()[\]{}]/g,'').replace(/[ぁ-ゖ]/g,ch=>String.fromCharCode(ch.charCodeAt(0)+0x60));
}
function levenshtein(a,b){
  if(a===b)return 0;if(!a.length)return b.length;if(!b.length)return a.length;
  let prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const curr=[i];for(let j=1;j<=b.length;j++)curr[j]=Math.min(curr[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=curr;}return prev[b.length];
}
function fieldScore(field,query,weight=1){
  const value=normalize(field);if(!value)return 0;if(value===query)return 100*weight;if(value.startsWith(query))return 75*weight;if(value.includes(query))return 55*weight;
  const distance=levenshtein(value,query);const limit=Math.max(1,Math.floor(Math.max(value.length,query.length)*.34));return distance<=limit?(35-distance*5)*weight:0;
}
function scoreRecord(record,rawQuery){
  const query=normalize(rawQuery);if(!query)return 1+(record.favorite?1000:0)+(record.useCount||0);
  const scores=[fieldScore(record.serviceName,query,1.2),fieldScore(record.reading,query,1.05),fieldScore(record.userId,query,.9),fieldScore(record.url,query,.75),fieldScore(record.category,query,.8),...(record.tags||[]).map(x=>fieldScore(x,query,.85)),fieldScore(record.memo,query,.55)];
  const best=Math.max(...scores);return best?best+(record.favorite?3:0)+Math.min(record.useCount||0,20)/10:0;
}
function filteredRecords(){
  const query=ui.searchInput.value;return state.records.map(record=>({record,score:scoreRecord(record,query)})).filter(x=>x.score>0&&(!selectedCategory||x.record.category===selectedCategory)).sort((a,b)=>b.score-a.score||new Date(b.record.updatedAt)-new Date(a.record.updatedAt)).map(x=>x.record);
}

function escapeHtml(value=''){const el=document.createElement('span');el.textContent=value;return el.innerHTML;}
function render(){
  renderCategories();const records=filteredRecords();ui.credentialList.replaceChildren();
  records.forEach(record=>ui.credentialList.append(cardFor(record)));
  const query=ui.searchInput.value.trim();ui.resultTitle.textContent=selectedCategory|| (query?`「${query}」の結果`:'すべて');ui.resultCount.textContent=`${records.length}件`;
  ui.emptyState.hidden=records.length!==0;ui.emptyTitle.textContent=state.records.length?(query||selectedCategory?'見つかりませんでした':'表示できる項目がありません'):'まだ登録がありません';
  ui.emptyMessage.textContent=state.records.length?'検索語やカテゴリを変えてみてください。':'右下の＋から、最初のログイン情報を登録できます。';
  ui.clearSearch.hidden=!query;updateCategoryOptions();updateAccountUI();updateSyncStatus();
}
function updateAccountUI(){
  if(!googleConfigured()){ui.googleAccountText.textContent='Google Client IDが未設定';ui.googleConnectButton.disabled=true;}
  else if(currentGoogleUser||state.settings.google){ui.googleAccountText.textContent=(currentGoogleUser||state.settings.google).email||'接続済み';ui.googleConnectButton.textContent='再確認';ui.googleConnectButton.disabled=false;}
  else{ui.googleAccountText.textContent='未接続';ui.googleConnectButton.textContent='接続';ui.googleConnectButton.disabled=false;}
  if(!microsoftConfigured()){ui.oneDriveAccountText.textContent='Microsoft Client IDが未設定';ui.oneDriveConnectButton.disabled=true;}
  else if(state.settings.microsoft){ui.oneDriveAccountText.textContent=state.settings.microsoft.account||'接続済み';ui.oneDriveConnectButton.textContent='再接続';ui.oneDriveConnectButton.disabled=false;}
  else{ui.oneDriveAccountText.textContent='未接続';ui.oneDriveConnectButton.textContent='接続';ui.oneDriveConnectButton.disabled=false;}
}
function renderCategories(){
  const used=[...new Set(state.records.map(x=>x.category).filter(Boolean))];ui.categoryChips.replaceChildren();
  const all=document.createElement('button');all.className=`chip ${selectedCategory?'':'active'}`;all.textContent='すべて';all.onclick=()=>{selectedCategory='';render();};ui.categoryChips.append(all);
  used.forEach(category=>{const button=document.createElement('button');button.className=`chip ${selectedCategory===category?'active':''}`;button.textContent=category;button.onclick=()=>{selectedCategory=selectedCategory===category?'':category;render();};ui.categoryChips.append(button);});
}
function cardFor(record){
  const article=document.createElement('article');article.className='credential-card';article.dataset.id=record.id;
  article.innerHTML=`<div class="card-top"><div class="service-avatar">${escapeHtml((record.serviceName||'?').slice(0,1).toUpperCase())}</div><div class="card-main"><h3 class="service-name">${escapeHtml(record.serviceName)}</h3><p class="user-id">${escapeHtml(record.userId)}</p></div><button class="favorite ${record.favorite?'active':''}" aria-label="お気に入り">★</button></div><div class="card-actions"><button data-copy="id">ID コピー</button><button data-copy="password"><span class="pw-label">PW コピー</span></button><button class="edit" aria-label="編集">•••</button></div>`;
  article.querySelector('.favorite').onclick=async()=>{record.favorite=!record.favorite;await persistState();render();};
  article.querySelector('[data-copy="id"]').onclick=()=>copyValue(record,record.userId,'ID');
  const pwButton=article.querySelector('[data-copy="password"]');pwButton.onclick=()=>copyValue(record,record.password,'パスワード');
  let pressTimer;const reveal=()=>{pressTimer=setTimeout(()=>temporarilyReveal(record,pwButton),450);};const stop=()=>clearTimeout(pressTimer);pwButton.addEventListener('pointerdown',reveal);pwButton.addEventListener('pointerup',stop);pwButton.addEventListener('pointerleave',stop);
  article.querySelector('.edit').onclick=()=>{record.useCount=(record.useCount||0)+1;persistState();openEditor(record);};return article;
}
async function copyValue(record,value,label){
  try{await navigator.clipboard.writeText(value);}catch{const input=document.createElement('textarea');input.value=value;input.style.position='fixed';input.style.opacity='0';document.body.append(input);input.select();document.execCommand('copy');input.remove();}
  record.useCount=(record.useCount||0)+1;await persistState();showToast(`${label}をコピーしました`);
}
function temporarilyReveal(record,button){
  const label=button.querySelector('.pw-label');label.textContent=record.password;label.className='pw-label password-preview';clearTimeout(revealTimers.get(record.id));revealTimers.set(record.id,setTimeout(()=>{label.textContent='PW コピー';label.className='pw-label';},3000));
}

function infer(inputName,inputUrl=''){
  let host='';try{host=new URL(inputUrl.includes('://')?inputUrl:`https://${inputUrl}`).hostname.replace(/^www\./,'');}catch{}
  const haystack=`${inputName} ${host}`;const rule=SERVICE_RULES.find(x=>x.match.test(haystack));
  if(rule)return {...rule};
  const stem=host.split('.')[0];return {name:inputName||(stem?stem.charAt(0).toUpperCase()+stem.slice(1):''),reading:'',category:'その他',tags:[]};
}
function openEditor(record=null){
  ui.editorForm.reset();ui.advancedFields.open=false;ui.recordId.value=record?.id||'';ui.editorTitle.textContent=record?'編集':'新規登録';ui.deleteButton.hidden=!record;
  for(const key of ['serviceName','userId','password','url','category','reading','memo'])ui[key].value=record?.[key]||'';
  ui.tags.value=(record?.tags||[]).join(', ');ui.editorDialog.showModal();setTimeout(()=>ui.serviceName.focus(),50);
}
async function saveEditor(){
  const now=new Date().toISOString(), id=ui.recordId.value;let record=id?state.records.find(x=>x.id===id):null;const inferred=infer(ui.serviceName.value,ui.url.value);
  const values={serviceName:ui.serviceName.value.trim()||inferred.name,userId:ui.userId.value.trim(),password:ui.password.value,url:ui.url.value.trim(),category:ui.category.value.trim()||inferred.category,tags:ui.tags.value.trim()?ui.tags.value.split(/[、,，]/).map(x=>x.trim()).filter(Boolean):inferred.tags,reading:ui.reading.value.trim()||inferred.reading,memo:ui.memo.value.trim(),updatedAt:now};
  if(record)Object.assign(record,values);else state.records.push({id:crypto.randomUUID(),...values,favorite:false,useCount:0,createdAt:now});
  if(values.category&&!state.categories.includes(values.category))state.categories.push(values.category);await persistState();ui.editorDialog.close();render();showToast('ローカルに保存しました');
}
async function deleteCurrent(){
  const id=ui.recordId.value;if(!id||!confirm('このログイン情報を削除しますか？'))return;state.records=state.records.filter(x=>x.id!==id);await persistState();ui.editorDialog.close();render();showToast('削除しました');
}
function generatePassword(){
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*+-_';const values=crypto.getRandomValues(new Uint32Array(20));ui.password.value=Array.from(values,x=>alphabet[x%alphabet.length]).join('');ui.password.type='text';setTimeout(()=>ui.password.type='password',2500);showToast('パスワードを生成しました');
}
function updateCategoryOptions(){ui.categoryOptions.innerHTML=state.categories.map(x=>`<option value="${escapeHtml(x)}">`).join('');}
function updateSyncStatus(){
  if(syncInProgress){ui.syncStatus.className='status status-local';ui.syncStatus.textContent='↻ 同期中';return;}
  if(syncProblem){ui.syncStatus.className='status status-offline';ui.syncStatus.textContent='! '+syncProblem;return;}
  if(state.settings.microsoft){ui.syncStatus.className=`status ${state.dirty?'status-offline':'status-local'}`;ui.syncStatus.textContent=state.dirty?'● 未同期':'✓ 同期済み';return;}
  ui.syncStatus.className=`status ${state.dirty?'status-offline':'status-local'}`;ui.syncStatus.textContent=state.dirty?'● ローカル変更あり':'✓ ローカル保存済み';
}
function showToast(message){ui.toast.textContent=message;ui.toast.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>ui.toast.classList.remove('show'),1800);}

function resetLockTimer(){
  clearTimeout(lockTimer);if(!vaultKey)return;const minutes=Number(state.settings.lockMinutes);if(minutes>0)lockTimer=setTimeout(lockVault,minutes*60*1000);
}
function lockVault(){vaultKey=null;clearMicrosoftAccessToken();state=freshState();clearTimeout(lockTimer);ui.settingsDialog.close();render();if(!ui.lockDialog.open)ui.lockDialog.showModal();}
async function unlockVault(){
  ui.unlockButton.disabled=true;try{await initializeKeys();await loadState();ui.lockDialog.close();render();resetLockTimer();showToast('ロックを解除しました');}catch(error){console.error('Unlock failed',error);showToast('ロック解除に失敗しました');}finally{ui.unlockButton.disabled=false;}
}
async function exportBackup(){
  await saveQueue;const encrypted=await dbGet('vault');const wrapped=await dbGet('wrappedVaultKey');const payload={format:'kagicho-device-backup',version:1,createdAt:new Date().toISOString(),note:'This backup is bound to this browser profile device key.',vault:encrypted,wrappedVaultKey:bytesToBase64(new Uint8Array(wrapped))};
  const blob=new Blob([JSON.stringify(payload)],{type:'application/octet-stream'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`password-vault-backup-${new Date().toISOString().slice(0,10)}.enc`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast('暗号化バックアップを書き出しました');
}
async function importBackup(file){
  try{const payload=JSON.parse(await file.text());if(payload.format!=='kagicho-device-backup'||!payload.vault)throw new Error('Unsupported backup');
    const currentWrapped=new Uint8Array(await dbGet('wrappedVaultKey')),incoming=base64ToBytes(payload.wrappedVaultKey);if(bytesToBase64(currentWrapped)!==bytesToBase64(incoming))throw new Error('This backup belongs to another browser profile');
    const restored=await decryptState(payload.vault);if(!confirm(`${restored.records?.length||0}件のバックアップで現在の内容を置き換えますか？`))return;await dbPut('vault',payload.vault);await loadState();render();showToast('バックアップを復元しました');
  }catch(error){console.error('Import failed',error);showToast('この端末で作成したバックアップではありません');}
}

async function graphRequest(path,token,options={}){
  const response=await fetch(`https://graph.microsoft.com/v1.0${path}`,{...options,headers:{Authorization:`Bearer ${token}`,...options.headers}});
  if(response.status===404)return null;
  if(!response.ok){let detail='';try{detail=(await response.json()).error?.message||'';}catch{}throw new Error(detail||`Microsoft Graph error ${response.status}`);}
  return response;
}
async function getOneDriveSession(interactive=false){
  if(!microsoftConfigured())throw new Error('Microsoft Client IDが未設定です');
  const refreshToken=state.settings.microsoft?.refreshToken||'';
  if(!interactive&&!refreshToken)throw new Error('OneDriveは未接続です');
  const session=await getMicrosoftAccessToken(refreshToken);
  if(!state.settings.microsoft||session.refreshToken!==refreshToken){
    state.settings.microsoft={account:'OneDrive App Folder',refreshToken:session.refreshToken,connectedAt:new Date().toISOString()};
    await persistState(true);
  }
  return session;
}
async function readCloudVault(token){
  const response=await graphRequest('/me/drive/special/approot:/vault.enc:/content',token);
  if(!response)return null;
  const remote=await response.json();
  if(remote.formatVersion!==1||!remote.encryptedPayload)throw new Error('クラウドVaultの形式が不明です');
  return remote;
}
async function applyCloudVault(remote){
  const localMicrosoft=state.settings.microsoft;
  const restored=await decryptState(remote.encryptedPayload);
  const defaults=freshState();
  state={...defaults,...restored,revision:Number(remote.revision)||restored.revision||0,updatedAt:remote.updatedAt||restored.updatedAt,dirty:false,settings:{...defaults.settings,...restored.settings,microsoft:localMicrosoft||restored.settings?.microsoft||null}};
  state.categories=[...new Set([...DEFAULT_CATEGORIES,...(state.categories||[])])];
  await storeStateWithoutRevision();render();
}
async function uploadCloudVault(token){
  const syncSnapshot=JSON.parse(JSON.stringify({...state,dirty:false}));
  const payload={formatVersion:1,revision:syncSnapshot.revision,updatedAt:syncSnapshot.updatedAt,deviceId:syncSnapshot.deviceId,encryptedPayload:await encryptState(syncSnapshot)};
  await graphRequest('/me/drive/special/approot:/vault.enc:/content',token,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const wrapped=await dbGet('wrappedVaultKey');
  await graphRequest('/me/drive/special/approot:/wrapped-key.bin:/content',token,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:wrapped});
  state.dirty=false;await storeStateWithoutRevision();
}
async function syncOneDrive({interactive=false}={}){
  if(syncInProgress)return;
  if(!navigator.onLine){syncProblem='オフライン';updateSyncStatus();if(interactive)showToast('オフラインでは同期できません');return;}
  syncInProgress=true;syncProblem='';updateSyncStatus();
  try{
    const session=await getOneDriveSession(interactive);
    const remote=await readCloudVault(session.accessToken);
    if(remote&&Number(remote.revision)>Number(state.revision)){
      if(state.dirty){
        const useCloud=confirm('別の端末に新しい変更があります。\n\nOK: クラウド版を使用\nキャンセル: この端末版を使用');
        if(useCloud)await applyCloudVault(remote);else{state.revision=Number(remote.revision)+1;await uploadCloudVault(session.accessToken);}
      }else await applyCloudVault(remote);
    }else if(!remote||state.dirty||Number(remote.revision)<Number(state.revision))await uploadCloudVault(session.accessToken);
    else{state.dirty=false;await storeStateWithoutRevision();}
    syncProblem='';showToast('OneDriveと同期しました');
  }catch(error){
    console.error('OneDrive sync failed',error);syncProblem=state.settings.microsoft?'再接続が必要':'未接続';
    if(interactive)showToast(error.message||'OneDrive同期に失敗しました');
  }finally{syncInProgress=false;updateAccountUI();updateSyncStatus();}
}
async function connectGoogleAccount(){
  if(!googleConfigured()){showToast('Google Client IDが未設定です');return;}
  try{currentGoogleUser=await authenticateGoogle(null,{prompt:true});state.settings.google={sub:currentGoogleUser.sub,email:currentGoogleUser.email,name:currentGoogleUser.name};await persistState(true);updateAccountUI();showToast('Googleアカウントを確認しました');}
  catch(error){console.error('Google authentication failed',error);showToast('Google認証に失敗しました');}
}
async function requireGoogleIdentity(){
  if(!googleConfigured())return;
  ui.authDialog.showModal();ui.authError.textContent='';
  try{currentGoogleUser=await authenticateGoogle(ui.googleSignInButton,{prompt:true});ui.authDialog.close();}
  catch(error){console.error('Google authentication failed',error);ui.authError.textContent='Google認証を完了できませんでした。';throw error;}
}

function bindEvents(){
  ui.searchInput.addEventListener('input',render);ui.clearSearch.onclick=()=>{ui.searchInput.value='';ui.searchInput.focus();render();};ui.addButton.onclick=()=>openEditor();
  ui.editorForm.addEventListener('submit',event=>{event.preventDefault();if(event.submitter?.value==='cancel'){ui.editorDialog.close();return;}if(!ui.editorForm.reportValidity())return;saveEditor();});
  ui.deleteButton.onclick=deleteCurrent;ui.generatePassword.onclick=generatePassword;
  ui.url.addEventListener('blur',()=>{const guess=infer(ui.serviceName.value,ui.url.value);if(!ui.serviceName.value)ui.serviceName.value=guess.name;if(!ui.category.value)ui.category.value=guess.category;if(!ui.reading.value)ui.reading.value=guess.reading;if(!ui.tags.value)ui.tags.value=guess.tags.join(', ');});
  ui.serviceName.addEventListener('blur',()=>{const guess=infer(ui.serviceName.value,ui.url.value);if(!ui.category.value)ui.category.value=guess.category;if(!ui.reading.value)ui.reading.value=guess.reading;if(!ui.tags.value)ui.tags.value=guess.tags.join(', ');});
  ui.settingsButton.onclick=()=>ui.settingsDialog.showModal();ui.closeSettings.onclick=()=>ui.settingsDialog.close();ui.lockTimeout.onchange=async()=>{state.settings.lockMinutes=Number(ui.lockTimeout.value);await persistState();resetLockTimer();};
  ui.lockButton.onclick=lockVault;ui.unlockButton.onclick=unlockVault;ui.exportButton.onclick=exportBackup;ui.importButton.onclick=()=>ui.importFile.click();ui.importFile.onchange=()=>ui.importFile.files[0]&&importBackup(ui.importFile.files[0]);
  ui.googleConnectButton.onclick=connectGoogleAccount;ui.oneDriveConnectButton.onclick=()=>syncOneDrive({interactive:true});ui.syncButton.onclick=()=>syncOneDrive({interactive:true});
  for(const event of ['pointerdown','keydown','touchstart'])document.addEventListener(event,resetLockTimer,{passive:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)resetLockTimer();});
  window.addEventListener('online',()=>{syncProblem='';if(state.dirty&&state.settings.microsoft)syncOneDrive();});
  window.addEventListener('offline',()=>{syncProblem='オフライン';updateSyncStatus();});
}

async function start(){
  bindEvents();try{
    await openDatabase();await requireGoogleIdentity();await initializeKeys();await loadState();
    if(currentGoogleUser&&state.settings.google&&state.settings.google.sub!==currentGoogleUser.sub)throw new Error('登録済みとは異なるGoogleアカウントです');
    if(currentGoogleUser&&!state.settings.google){state.settings.google={sub:currentGoogleUser.sub,email:currentGoogleUser.email,name:currentGoogleUser.name};await persistState(true);}
    ui.lockTimeout.value=String(state.settings.lockMinutes??15);render();resetLockTimer();
    if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
    if(state.settings.microsoft&&navigator.onLine)setTimeout(()=>syncOneDrive(),500);
  }catch(error){console.error('Startup failed',error);ui.emptyState.hidden=false;ui.emptyTitle.textContent='起動できませんでした';ui.emptyMessage.textContent=error.message||'このブラウザでIndexedDBとWeb Cryptoを利用できるか確認してください。';}
}
start();
