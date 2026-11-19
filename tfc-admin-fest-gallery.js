/* TFC BANDIYOD | Fest Memories gallery publisher v1.0
   Completely separate from ordinary admin News posts.
   Uses RTDB, no Cloud Storage or billing required. */
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getDatabase, ref, get, onValue, push, update, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

const panel = document.getElementById('tfcGalleryPanel');
if (panel) {
  const app = getApps()[0] || initializeApp(firebaseConfig);
  const auth = getAuth(app), db = getDatabase(app);
  const el = id => document.getElementById(id);
  let authorized = false, busy = false, editId = null, saved = {};
  let authSeq = 0, unsubscribe = null;
  const form = el('galleryForm'), choose = el('galleryPhotos');

  function notice(msg, error = false) {
    el('galleryStatus').textContent = msg;
    el('galleryStatus').dataset.error = error ? 'true' : 'false';
  }
  function waiting(yes) {
    busy = yes;
    el('gallerySave').disabled = yes;
    el('galleryCancel').disabled = yes;
    el('gallerySave').textContent = yes ? 'അപ്‌ലോഡ് ചെയ്യുന്നു…' : editId ? 'ഫോട്ടോകൾ ചേർത്ത് Save' : '📸 Slideshow Publish';
  }
  function reset() {
    editId = null;
    form.reset();
    el('galleryEditNote').hidden = true;
    el('galleryCancel').hidden = true;
    el('galleryPhotoHelp').textContent = 'ഒരു തവണ ഒന്നിലധികം ഫോട്ടോകൾ തിരഞ്ഞെടുക്കാം. ഓരോന്നും 3 സെക്കൻഡ് വീതം മാറും.';
    waiting(false);
  }
  function button(text, fn, danger = false) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'small-btn' + (danger ? ' danger' : '');
    b.textContent = text; b.addEventListener('click',fn); return b;
  }
  function idsOf(record) {
    const x = record?.photoIds;
    return Array.isArray(x) ? x.filter(v => typeof v === 'string') :
      x && typeof x === 'object' ? Object.keys(x).sort((a,b)=>Number(a)-Number(b)).map(k=>x[k]).filter(v=>typeof v==='string') : [];
  }
  function render() {
    const list = el('galleryList');
    list.replaceChildren();
    const rows = Object.entries(saved).sort((a,b)=>Number(b[1].createdAt||0)-Number(a[1].createdAt||0));
    if (!rows.length) { const p = document.createElement('p'); p.className='muted'; p.textContent='ഇതുവരെ Gallery Post ഒന്നുമില്ല.';list.append(p);return; }
    for (const [id,p] of rows) {
      const card = document.createElement('article');card.className='saved-post';
      const heading=document.createElement('div');heading.className='saved-header';
      const title=document.createElement('strong');title.textContent=p.title||'Fest Memories';
      const badge=document.createElement('span');badge.className=p.status==='published'?'state live':'state';
      badge.textContent=p.status==='published'?'പ്രസിദ്ധീകരിച്ചു':'മറച്ചു';heading.append(title,badge);
      const desc=document.createElement('p');desc.textContent=(p.body||'')+`\n📷 ${idsOf(p).length} ഫോട്ടോകൾ · 3 സെക്കൻഡ്`;
      const actions=document.createElement('div');actions.className='saved-actions';
      actions.append(button('➕ Edit / Add Photos',()=>edit(id)),button(p.status==='published'?'👁 Hide':'👁 Publish',()=>toggle(id)),button('🗑 Delete',()=>erase(id),true));
      card.append(heading,desc,actions);list.append(card);
    }
  }
  function edit(id) {
    if (busy || !saved[id]) return;
    editId=id;
    el('galleryTitle').value=saved[id].title||'';
    el('galleryBody').value=saved[id].body||'';
    choose.value='';
    el('galleryEditNote').hidden=false;
    el('galleryCancel').hidden=false;
    el('galleryPhotoHelp').textContent=`നിലവിൽ ${idsOf(saved[id]).length} ഫോട്ടോകൾ ഉണ്ട്. പുതിയവ ചേർക്കണമെങ്കിൽ തിരഞ്ഞെടുക്കുക.`;
    waiting(false);
    panel.scrollIntoView({behavior:'smooth',block:'start'});
  }
  async function toggle(id) {
    if (!authorized || busy || !saved[id]) return;
    const next = saved[id].status === 'published' ? 'hidden':'published';
    if (!confirm(next==='hidden'?'Gallery വെബ്സൈറ്റിൽ നിന്ന് മറയ്ക്കണോ?':'Gallery വീണ്ടും പ്രസിദ്ധീകരിക്കണോ?'))return;
    waiting(true);
    try {await update(ref(db,`tfcFestGalleries/meta/${id}`),{status:next,updatedAt:serverTimestamp()});notice('✅ Gallery status മാറ്റി.');}
    catch(e){notice(`പിശക്: ${e.message}`,true);}
    finally {waiting(false);}
  }
  async function erase(id) {
    if (!authorized || busy || !saved[id]) return;
    if (!confirm('ഈ Gallery-യും എല്ലാ ഫോട്ടോകളും സ്ഥിരമായി Delete ചെയ്യണോ?'))return;
    waiting(true);
    try {
      await update(ref(db),{[`tfcFestGalleries/meta/${id}`]:null,[`tfcFestGalleries/photos/${id}`]:null});
      if (editId===id) reset();notice('✅ Gallery Delete ചെയ്തു.');
    } catch(e){notice(`Delete ചെയ്യാനായില്ല: ${e.message}`,true);}
    finally {waiting(false);}
  }
  async function jpeg(file) {
    if(!file.type.startsWith('image/'))throw Error(`${file.name}: ഇത് ഫോട്ടോ അല്ല.`);
    if(file.size>15*1024*1024)throw Error(`${file.name}: 15 MB-ൽ കൂടുതൽ വലുപ്പമുണ്ട്.`);
    const link=URL.createObjectURL(file), img=new Image();
    try {
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error(file.name+' തുറക്കാനായില്ല.'));img.src=link;});
      const w=img.naturalWidth,h=img.naturalHeight;
      if(w<180||h<180)throw Error(`${file.name}: കുറഞ്ഞത് 180px വേണം.`);
      const canvas=document.createElement('canvas'), ctx=canvas.getContext('2d',{alpha:false});
      if(!ctx)throw Error('ബ്രൗസറിൽ image compression ലഭ്യമല്ല.');
      for(const limit of [1600,1400,1200,1000,850,700]) {
        const ratio=Math.min(1,limit/Math.max(w,h));
        canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);
        ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img,0,0,canvas.width,canvas.height);
        for(const quality of [.83,.75,.67,.57,.48]){
          const data=canvas.toDataURL('image/jpeg',quality);
          if(data.startsWith('data:image/jpeg;base64,')&&data.length<=280000)return data;
        }
      }
      throw Error(`${file.name}: ചിത്രം compress ചെയ്യാനായില്ല.`);
    } finally {URL.revokeObjectURL(link);}
  }
  choose.addEventListener('change',()=>{
    const n=choose.files?.length||0;
    el('galleryPhotoHelp').textContent = n ? `${n} ഫോട്ടോകൾ തിരഞ്ഞെടുത്തു. പരമാവധി 30 ഫോട്ടോകൾ ഒരു Gallery-യിൽ.` : 'ഫോട്ടോകൾ തിരഞ്ഞെടുക്കുക.';
  });
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(!authorized||busy)return;
    const title=el('galleryTitle').value.trim(),body=el('galleryBody').value.trim();
    const files=[...(choose.files||[])],before=editId?saved[editId]:null;
    const existing=idsOf(before);
    if(!title||title.length>110||body.length>600){notice('Title/description നീളം ശരിയല്ല.',true);return;}
    if(!before && !files.length){notice('പുതിയ Gallery-ക്ക് ഒരു ഫോട്ടോയെങ്കിലും വേണം.',true);return;}
    if(files.length+existing.length>30){notice('ഒരു Gallery-യിൽ പരമാവധി 30 ഫോട്ടോകളാണ് അനുവദിക്കുന്നത്.',true);return;}
    if(files.some(f=>f.size>15*1024*1024||!f.type.startsWith('image/'))){notice('ഫോട്ടോകൾ മാത്രം (ഒന്നിന് പരമാവധി 15 MB) തിരഞ്ഞെടുക്കുക.',true);return;}
    const id=editId||push(ref(db,'tfcFestGalleries/meta')).key;
    const uploaded=[];let committed=false;
    waiting(true);
    try {
      for(let i=0;i<files.length;i++) {
        notice(`📷 ${i+1} / ${files.length}: ${files[i].name} compress ചെയ്ത് upload ചെയ്യുന്നു…`);
        const data=await jpeg(files[i]);
        const photoId=push(ref(db,`tfcFestGalleries/photos/${id}`)).key;
        await update(ref(db),{[`tfcFestGalleries/photos/${id}/${photoId}`]:data});
        uploaded.push(photoId);
      }
      const payload={
        title,body,status:before?.status||'published',
        createdAt:before?.createdAt||serverTimestamp(),updatedAt:serverTimestamp(),
        photoIds:[...existing,...uploaded]
      };
      await update(ref(db),{[`tfcFestGalleries/meta/${id}`]:payload});
      committed=true;reset();
      notice('✅ Fest Memories Gallery പ്രസിദ്ധീകരിച്ചു! ഇത് Latest News-ൽ കാണിക്കില്ല.');
    }catch(error){
      notice('Gallery save പരാജയപ്പെട്ടു: '+error.message,true);
    }finally{
      if(!committed && uploaded.length){
        const garbage={};for(const photoId of uploaded)garbage[`tfcFestGalleries/photos/${id}/${photoId}`]=null;
        try{await update(ref(db),garbage);}catch(e){console.warn('Gallery upload cleanup failed',e);}
      }
      waiting(false);
    }
  });
  el('galleryCancel').addEventListener('click',reset);
  onAuthStateChanged(auth,async user=>{
    const token=++authSeq;authorized=false;
    if(unsubscribe){unsubscribe();unsubscribe=null;}
    panel.hidden=true; saved={};render();reset();
    if(!user)return;
    try{
      const snap=await get(ref(db,`admins/${user.uid}`));
      if(token!==authSeq||snap.val()!==true)return;
      authorized=true;panel.hidden=false;
      unsubscribe=onValue(ref(db,'tfcFestGalleries/meta'),snap=>{saved=snap.val()||{};render();},error=>notice('Firebase Gallery rules പരിശോധിക്കുക: '+error.message,true));
    }catch(error){console.warn('Gallery admin permission',error);}
  });
}
