/* TFC BANDIYOD | Separate Fest Memories reader v1.0
   Does NOT insert posts into Latest Updates, Sponsor or running NEWS. */
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getDatabase, ref, get, onValue } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

const section=document.getElementById('tfcFestMemorySection');
if(section){
  const app=getApps()[0]||initializeApp(firebaseConfig);
  const db=getDatabase(app), list=document.getElementById('tfcFestGalleries');
  const modal=document.getElementById('tfcGalleryModal');
  const modalImg=document.getElementById('tfcGalleryModalPhoto');
  document.getElementById('tfcGalleryModalClose').addEventListener('click',()=>modal.close());
  modal.addEventListener('click',e=>{if(e.target===modal)modal.close();});
  const sessions=[];
  const galleryText={
    en:{loading:'📷 Loading photo…',prev:'‹ Previous',next:'Next ›',pause:'Ⅱ Pause',play:'▶ Play',expand:'⛶ Fullscreen',unavailable:'Photo unavailable. Try another.',missing:'Photo unavailable.'},
    ml:{loading:'📷 ഫോട്ടോ ലോഡ് ചെയ്യുന്നു…',prev:'‹ മുമ്പത്തെ',next:'അടുത്തത് ›',pause:'Ⅱ Pause',play:'▶ Play',expand:'⛶ Fullscreen',unavailable:'ചിത്രം ലഭ്യമല്ല. അടുത്തത് നോക്കുക.',missing:'ചിത്രം ലഭ്യമല്ല.'}
  };
  const msg=key=>galleryText[document.documentElement.lang==='en'?'en':'ml'][key];
  const languageObserver=new MutationObserver(()=>{for(const s of sessions)s.updateText?.();});
  languageObserver.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  const idsOf = p => Array.isArray(p.photoIds)?p.photoIds.filter(v=>typeof v==='string'):
    p.photoIds&&typeof p.photoIds==='object' ? Object.keys(p.photoIds).sort((a,b)=>Number(a)-Number(b)).map(k=>p.photoIds[k]).filter(v=>typeof v==='string'):[];
  const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  function dispose(){for(const s of sessions){clearInterval(s.timer);s.observer?.disconnect();}sessions.length=0;}
  function create(id,p){
    const ids=idsOf(p);if(!ids.length)return null;
    const card=node('article','tfc-gallery-card');
    const stage=node('div','tfc-gallery-photo-stage');
    const label=node('div','tfc-gallery-placeholder',msg('loading'));
    const img=node('img');img.alt=p.title||'TFC Fest Memories';img.loading='lazy';img.hidden=true;
    stage.append(label,img);
    const info=node('div','tfc-gallery-card-content');
    info.append(node('h3','',p.title||'Fest Memories'));
    if(p.body)info.append(node('p','',p.body));
    const bar=node('div','tfc-gallery-controls');
    const prev=node('button','',msg('prev')),next=node('button','',msg('next')),pause=node('button','',msg('pause')),expand=node('button','',msg('expand'));
    for(const btn of [prev,next,pause,expand])btn.type='button';
    const count=node('span','tfc-gallery-count');bar.append(prev,next,pause,expand,count);info.append(bar);card.append(stage,info);
    const state={id,ids,index:0,paused:false,visible:false,hover:false,timer:null,observer:null,cache:new Map(),sequence:0,labelKind:'loading'};
    state.updateText=()=>{
      prev.textContent=msg('prev');next.textContent=msg('next');
      pause.textContent=msg(state.paused?'play':'pause');expand.textContent=msg('expand');
      if(!label.hidden)label.textContent=msg(state.labelKind);
    };
    function displayCount(){count.textContent=`${state.index+1} / ${ids.length}`;}
    async function fetchPhoto(photoId){
      if(state.cache.has(photoId))return state.cache.get(photoId);
      const snapshot=await get(ref(db,`tfcFestGalleries/photos/${id}/${photoId}`));
      const data=snapshot.val();
      if(typeof data!=='string'||!data.startsWith('data:image/jpeg;base64,')||data.length>350000)throw Error('Photo unavailable');
      state.cache.set(photoId,data);return data;
    }
    async function show(position){
      state.index=(position+ids.length)%ids.length;
      displayCount();const version=++state.sequence;
      state.labelKind='loading';label.textContent=msg('loading');label.hidden=false;img.hidden=true;
      try{
        const src=await fetchPhoto(ids[state.index]);
        if(version!==state.sequence||!card.isConnected)return;
        img.src=src;img.hidden=false;label.hidden=true;
        // Preload the next frame on demand without downloading the full gallery.
        if(ids.length>1)fetchPhoto(ids[(state.index+1)%ids.length]).catch(()=>{});
      }catch(e){if(version===state.sequence){state.labelKind='unavailable';label.textContent=msg('unavailable');}}
    }
    prev.addEventListener('click',()=>show(state.index-1));
    next.addEventListener('click',()=>show(state.index+1));
    pause.addEventListener('click',()=>{state.paused=!state.paused;state.updateText();});
    expand.addEventListener('click',async()=>{
      try {modalImg.src=await fetchPhoto(ids[state.index]);modalImg.alt=p.title||'Festival photo';if(!modal.open)modal.showModal();}
      catch(e){state.labelKind='missing';label.textContent=msg('missing');label.hidden=false;}
    });
    card.addEventListener('mouseenter',()=>state.hover=true);
    card.addEventListener('mouseleave',()=>state.hover=false);
    card.addEventListener('focusin',()=>state.hover=true);
    card.addEventListener('focusout',()=>state.hover=false);
    displayCount();
    if('IntersectionObserver' in window){
      state.observer=new IntersectionObserver(entries=>{
        for(const e of entries)if(e.target===card){
          const wasVisible=state.visible;state.visible=e.isIntersecting;
          if(state.visible&&!wasVisible&&!img.src)show(state.index);
        }
      },{rootMargin:'150px',threshold:0.01});state.observer.observe(card);
    } else {state.visible=true;show(0);}
    state.timer=setInterval(()=>{
      if(!state.visible||state.paused||state.hover||document.hidden||modal.open||ids.length<2)return;
      show(state.index+1);
    },3000);
    sessions.push(state);
    return card;
  }
  onValue(ref(db,'tfcFestGalleries/meta'),snapshot=>{
    dispose();list.replaceChildren();
    const rows=Object.entries(snapshot.val()||{})
      .filter(([id,p])=>id&&p&&p.status==='published'&&typeof p.title==='string'&&idsOf(p).length)
      .sort((a,b)=>(Number(b[1].createdAt)||0)-(Number(a[1].createdAt)||0));
    const fragment=document.createDocumentFragment();
    for(const [id,p] of rows){const card=create(id,p);if(card)fragment.append(card);}
    list.append(fragment);section.hidden=!rows.length;
  },error=>console.warn('TFC Gallery not available:',error.code||error.message));
  window.addEventListener('pagehide',()=>{dispose();languageObserver.disconnect();});
}
