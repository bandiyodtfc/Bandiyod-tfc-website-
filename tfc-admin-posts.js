/* TFC BANDIYOD — daily post publisher v1.0
   Authorized admin UIDs come from /admins/{uid}===true (existing portal).
   Images are compressed to JPEG data URLs and stored in RTDB, NOT Cloud Storage.
   Firebase security rules MUST be merged before enabling publish/edit/delete. */
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged,
  signInWithPopup, signInWithRedirect, getRedirectResult, signOut
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  getDatabase, ref, get, onValue, push, update, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';
import { archiveAt, archiveDate, isArchived } from './tfc-fest-archive.js?v=92.0';

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const $ = id => document.getElementById(id);
const picker = $('postPhoto');
const form = $('postForm');
const provider = new GoogleAuthProvider();
let editingId = null;
let posts = {};
let selectedFile = null;
let ready = false;
let busy = false;
let authToken = 0;
let stopPosts = null;
let photoObjectURL = null;

function show(id, visible) { $(id).hidden = !visible; }
function message(value, error = false) {
  const target = $('status');
  target.textContent = value;
  target.dataset.error = error ? 'true' : 'false';
}
function setBusy(value) {
  busy = value;
  $('publishBtn').disabled = value;
  $('cancelEdit').disabled = value;
  $('publishBtn').textContent = value ? 'സേവ് ചെയ്യുന്നു…' : (editingId ? 'മാറ്റങ്ങൾ സേവ് ചെയ്യുക' : 'പോസ്റ്റ് പ്രസിദ്ധീകരിക്കുക');
}
function showImage(file) {
  if (photoObjectURL) URL.revokeObjectURL(photoObjectURL);
  photoObjectURL = file ? URL.createObjectURL(file) : null;
  const preview = $('photoPreview');
  preview.hidden = !photoObjectURL;
  if (photoObjectURL) preview.src = photoObjectURL;
  else preview.removeAttribute('src');
  $('photoHelp').textContent = file
    ? `${file.name} · ${(file.size/1024/1024).toFixed(2)} MB · അപ്‌ലോഡിന് മുമ്പ് കംപ്രസ് ചെയ്യും`
    : editingId ? 'ഫോട്ടോ മാറ്റണമെങ്കിൽ മാത്രം പുതിയ ഫോട്ടോ തിരഞ്ഞെടുക്കുക' : 'പോസ്റ്ററിന്റെ ഫോട്ടോ തിരഞ്ഞെടുക്കുക';
}
function resetForm() {
  editingId = null;
  selectedFile = null;
  form.reset();
  $('editNote').hidden = true;
  $('cancelEdit').hidden = true;
  showImage(null);
  setBusy(false);
}
function render() {
  const list = $('postList');
  list.replaceChildren();
  const sorted = Object.entries(posts).sort((a,b)=>
    (Number(b[1].createdAt)||0)-(Number(a[1].createdAt)||0) || b[0].localeCompare(a[0]));
  $('postTotal').textContent = `${sorted.length} പോസ്റ്റുകൾ`;
  if (!sorted.length) {
    const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'ഇതുവരെ പുതിയ അഡ്മിൻ പോസ്റ്റുകൾ ഒന്നുമില്ല. പഴയ ഹോം പേജ് പോസ്റ്റുകൾ നിലനിൽക്കും.';
    list.appendChild(p); return;
  }
  const btn = (text, action, className = '') => {
    const b = document.createElement('button'); b.type = 'button';
    b.className = 'small-btn '+className; b.textContent = text; b.addEventListener('click', action); return b;
  };
  for (const [id, data] of sorted) {
    const card = document.createElement('article'); card.className = 'saved-post';
    const header = document.createElement('div'); header.className = 'saved-header';
    const title = document.createElement('strong'); title.textContent = data.title || 'Untitled';
    const badge = document.createElement('span');
    badge.className = data.status === 'published' ? 'state live' : 'state';
    badge.textContent = data.status === 'published' ? (isArchived(data,Date.now()) ? 'Best Memories' : 'പ്രസിദ്ധീകരിച്ചു') : 'മറച്ചിരിക്കുന്നു';
    header.append(title, badge);
    if (data.archiveAt) { const end = document.createElement('small'); end.textContent = 'Fest ends (IST): ' + archiveDate(data.archiveAt); header.append(end); }
    const desc = document.createElement('p'); desc.textContent = data.body || 'വിവരണം നൽകിയിട്ടില്ല';
    const date = document.createElement('small');
    date.textContent = data.createdAt ?
      new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date(data.createdAt)) : '';
    const actions = document.createElement('div'); actions.className = 'saved-actions';
    actions.append(
      btn('✏️ Edit', () => edit(id)),
      btn(data.status === 'published' ? '👁️ Hide' : '👁️ Publish', () => toggleVisibility(id)),
      btn('🗑 Delete', () => erase(id), 'danger')
    );
    card.append(header, desc, date, actions); list.appendChild(card);
  }
}
function edit(id) {
  if (busy || !posts[id]) return;
  editingId = id;
  selectedFile = null;
  picker.value = '';
  $('postTitle').value = posts[id].title || '';
  $('postBody').value = posts[id].body || '';
  $('festEndDate').value = archiveDate(posts[id].archiveAt);
  $('editNote').hidden = false;
  $('cancelEdit').hidden = false;
  showImage(null);
  setBusy(false);
  form.scrollIntoView({behavior:'smooth',block:'start'});
  $('postTitle').focus({preventScroll:true});
}
async function toggleVisibility(id) {
  if (!ready || busy || !posts[id]) return;
  const newStatus = posts[id].status === 'published' ? 'hidden' : 'published';
  if (!confirm(newStatus === 'hidden' ? 'ഈ പോസ്റ്റ് ഹോം പേജിൽനിന്ന് മറയ്ക്കണോ?' : 'വീണ്ടും പ്രസിദ്ധീകരിക്കണോ?')) return;
  setBusy(true);
  try {
    await update(ref(db, `tfcSitePosts/meta/${id}`), {status:newStatus, updatedAt:serverTimestamp()});
    message(newStatus === 'hidden' ? 'പോസ്റ്റ് മറച്ചു.' : 'പോസ്റ്റ് പ്രസിദ്ധീകരിച്ചു.');
  } catch(error) { message(`സേവ് ചെയ്യാനായില്ല: ${error.message}`, true); }
  finally { setBusy(false); }
}
async function erase(id) {
  if (!ready || busy || !posts[id]) return;
  if (!confirm('ഈ പോസ്റ്റും അതിന്റെ ചിത്രവും സ്ഥിരമായി ഡിലീറ്റ് ചെയ്യണോ? തിരികെ കിട്ടില്ല.')) return;
  setBusy(true);
  try {
    await update(ref(db), {
      [`tfcSitePosts/meta/${id}`]:null,
      [`tfcSitePosts/images/${id}`]:null
    });
    if (editingId === id) resetForm();
    message('പോസ്റ്റും ചിത്രവും ഡിലീറ്റ് ചെയ്തു.');
  } catch(error) { message(`ഡിലീറ്റ് ചെയ്യാനായില്ല: ${error.message}`, true); }
  finally { setBusy(false); }
}

async function fileToImage(file) {
  if (!file.type.startsWith('image/')) throw Error('ഫോട്ടോ ഫയൽ മാത്രം തിരഞ്ഞെടുക്കുക.');
  if (file.size > 12*1024*1024) throw Error('12 MB-യിൽ കൂടുതൽ ഉള്ള ഫോട്ടോ അനുവദിക്കില്ല.');
  const original = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise((resolve,reject)=>{
      image.onload=resolve; image.onerror=()=>reject(Error('ഈ ചിത്രം വായിക്കാൻ സാധിച്ചില്ല.'));
      image.src=original;
    });
    const w = image.naturalWidth, h = image.naturalHeight;
    if (w < 180 || h < 180) throw Error('കുറഞ്ഞത് 180px വലുപ്പമുള്ള ചിത്രം വേണം.');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', {alpha:false});
    if (!ctx) throw Error('ഈ ബ്രൗസറിൽ ചിത്രം തയ്യാറാക്കാനായില്ല.');
    // Aim for <= 400,000 data URL characters (about 300 KB encoded).
    for (const maxSide of [1800,1600,1450,1300,1150,1000,900]) {
      const ratio = Math.min(1,maxSide/Math.max(w,h));
      canvas.width = Math.max(1,Math.round(w*ratio));
      canvas.height = Math.max(1,Math.round(h*ratio));
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(image,0,0,canvas.width,canvas.height);
      for (const quality of [.86,.80,.74,.67,.60,.53]) {
        const result = canvas.toDataURL('image/jpeg',quality);
        if (result.startsWith('data:image/jpeg;base64,') && result.length <= 400000) return result;
      }
    }
    throw Error('ചിത്രം വളരെ സങ്കീർണമാണ്; മറ്റൊരു ഫോട്ടോ തിരഞ്ഞെടുക്കുക.');
  } finally { URL.revokeObjectURL(original); }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!ready || busy) return;
  const title = $('postTitle').value.trim();
  const body = $('postBody').value.trim();
  const endDate = $('festEndDate').value;
  const archiveTime = archiveAt(endDate);
  if (endDate && (!archiveTime || endDate < '2000-01-01' || endDate > '2100-12-31')) return message('ഫെസ്റ്റ് അവസാന തീയതി ശരിയല്ല.',true);
  if (!title || title.length > 110 || body.length > 600) return message('പേരോ വിവരണത്തിന്റെ നീളമോ ശരിയല്ല.',true);
  if (!editingId && !selectedFile) return message('പുതിയ പോസ്റ്റിന് ഫോട്ടോ ആവശ്യമാണ്.',true);
  if (editingId && !posts[editingId]) return message('ഈ പോസ്റ്റ് ഇപ്പോൾ നിലവിലില്ല.',true);
  setBusy(true);
  message('ചിത്രം തയ്യാറാക്കി Firebase-ൽ സേവ് ചെയ്യുന്നു…');
  try {
    const imageData = selectedFile ? await fileToImage(selectedFile) : null;
    const id = editingId || push(ref(db,'tfcSitePosts/meta')).key;
    const previous = posts[id];
    const payload = {
      title, body,
      status: previous?.status || 'published',
      createdAt: previous?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    if (archiveTime) payload.archiveAt = archiveTime;
    const changes = {[`tfcSitePosts/meta/${id}`]: payload};
    if (imageData) changes[`tfcSitePosts/images/${id}`] = imageData;
    await update(ref(db),changes);
    resetForm();
    message(archiveTime && Date.now() >= archiveTime ? '✅ Best Memories-ൽ പോസ്റ്റ് സേവ് ചെയ്തു!' : '✅ പോസ്റ്റ് സേവ് ചെയ്തു! ഹോം പേജിൽ ഉടനെ കാണാം.');
  } catch (error) {
    message(`പോസ്റ്റ് സേവ് ചെയ്യാനായില്ല: ${error.message}`,true);
  } finally { setBusy(false); }
});

picker.addEventListener('change', () => {
  selectedFile = picker.files?.[0] || null;
  showImage(selectedFile);
});
$('cancelEdit').addEventListener('click', resetForm);
$('signin').addEventListener('click',async()=>{
  message('Google Login തുറക്കുന്നു…');
  try { await signInWithPopup(auth,provider); }
  catch(error) {
    if (['auth/popup-blocked','auth/operation-not-supported-in-this-environment'].includes(error.code)) {
      await signInWithRedirect(auth,provider).catch(e=>message('Login പിശക്: '+e.message,true));
    } else { message('Login പിശക്: '+error.message,true); }
  }
});
$('signout').addEventListener('click',async()=>{
  await signOut(auth); resetForm(); message('ലോഗൗട്ട് ചെയ്തു.');
});
getRedirectResult(auth).catch(error=>message('Login പിശക്: '+error.message,true));

onAuthStateChanged(auth,async user=>{
  const token = ++authToken;
  ready = false;
  if (stopPosts) {stopPosts();stopPosts=null;}
  posts = {}; render(); resetForm();
  show('signin',!user); show('signout',!!user); show('editor',false); show('denied',false);
  if (!user) { $('identity').textContent='അഡ്മിൻ Google അക്കൗണ്ട് ഉപയോഗിച്ച് Login ചെയ്യുക.'; return; }
  $('identity').textContent=user.email || 'Google Account';
  try {
    const snap=await get(ref(db, `admins/${user.uid}`));
    if (token!==authToken) return;
    if (snap.val()!==true) {
      show('denied',true);
      message('ഈ അക്കൗണ്ടിന് TFC Admin അനുമതിയില്ല.',true);
      return;
    }
    ready=true;
    show('editor',true); message('✅ Admin Login വിജയിച്ചു. പുതിയ പോസ്റ്റ് പ്രസിദ്ധീകരിക്കാം.');
    stopPosts=onValue(ref(db,'tfcSitePosts/meta'), snap=>{
      posts=snap.val() || {};render();
    },error=>message('Firebase Rules പരിശോധിക്കുക: '+error.message,true));
  } catch(error) {message('അഡ്മിൻ പരിശോധിക്കാനായില്ല: '+error.message,true);}
});
