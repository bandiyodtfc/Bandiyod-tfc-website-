import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getDatabase, ref, get, set, remove, onValue } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

// TFC BANDIYOD — MEMBER PHOTOS v1.0
// Firebase Realtime Database, no Storage billing.
// Admin: manage any active member photo.
// Approved active member: manage own photo.
// Approved active members can view all photos.

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const MAX_IMAGE_LENGTH = 100000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PHOTO_SIZE = 300;

let session = 0;
let user = null;
let admin = false;
let ownNumber = null;
let members = {};
let photos = {};
let stopPhotos = null;
let stopMembers = null;
let busy = false;

const el = id => document.getElementById(id);

function message(text, error = false) {
  const target = el('msg');
  if (!target) return;
  target.textContent = text;
  target.className = error ? 'error' : 'ok';
}

function validNumber(n) {
  return /^[1-9]\d{0,4}$/.test(String(n));
}

function photoImage(src, size = 65) {
  const img = document.createElement('img');
  img.src = src;
  img.alt = 'Member profile photo';
  img.width = size;
  img.height = size;
  img.style.objectFit = 'cover';
  img.style.borderRadius = '50%';
  img.style.border = '1px solid #ddd';
  return img;
}

function stop() {
  if (stopPhotos) stopPhotos();
  if (stopMembers) stopMembers();
  stopPhotos = null;
  stopMembers = null;
  members = {};
  photos = {};
  ownNumber = null;
  admin = false;
  busy = false;
  renderOwnPhoto();
  renderAdminPhotos();
}

function imageFromFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(Error('Select an image file.'));
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      reject(Error('Image must be under 10 MB.'));
      return;
    }

    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = PHOTO_SIZE;
        canvas.height = PHOTO_SIZE;

        const ctx = canvas.getContext('2d');
        if (!ctx) throw Error('Canvas unavailable.');

        const side = Math.min(img.width, img.height);
        const x = (img.width - side) / 2;
        const y = (img.height - side) / 2;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
        ctx.drawImage(
          img, x, y, side, side,
          0, 0, PHOTO_SIZE, PHOTO_SIZE
        );

        let result = null;
        for (const quality of [0.8, 0.65, 0.5, 0.35, 0.2]) {
          result = canvas.toDataURL('image/jpeg', quality);
          if (result.length <= MAX_IMAGE_LENGTH) break;
        }

        if (!result || result.length > MAX_IMAGE_LENGTH) {
          throw Error('Photo too large after compression.');
        }

        resolve(result);
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(Error('Could not read image.'));
    };

    img.src = url;
  });
}

async function savePhoto(number, file) {
  if (busy || !user || !validNumber(number)) return;

  const uid = user.uid;
  const generation = session;

  if (!admin && String(ownNumber) !== String(number)) {
    return message('You can change only your own photo.', true);
  }

  busy = true;

  try {
    const image = await imageFromFile(file);

    if (session !== generation || auth.currentUser?.uid !== uid) {
      throw Error('Login session changed.');
    }

    const member = (await get(ref(db, `members/${number}`))).val();

    if (!member || member.status !== 'active') {
      throw Error('Active member required.');
    }

    if (!admin && member.uid !== uid) {
      throw Error('Member identity mismatch.');
    }

    await set(ref(db, `memberPhotos/${number}`), {
      image,
      updatedAt: Date.now(),
      updatedBy: uid
    });

    message(`Member #${number} photo saved successfully.`);
  } catch (e) {
    message('Photo upload failed: ' + e.message, true);
  } finally {
    busy = false;
  }
}

async function deletePhoto(number) {
  if (busy || !user || !validNumber(number)) return;

  if (!admin && String(ownNumber) !== String(number)) {
    return message('Permission denied.', true);
  }

  if (!confirm(`Delete photo for member #${number}?`)) return;

  busy = true;

  try {
    await remove(ref(db, `memberPhotos/${number}`));
    message(`Member #${number} photo deleted.`);
  } catch (e) {
    message('Photo deletion failed: ' + e.message, true);
  } finally {
    busy = false;
  }
}

function selectPhoto(number) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) savePhoto(number, file);
  };
  input.click();
}

function renderOwnPhoto() {
  const button = el('memberPhotoUpload');
  if (!button) return;

  const container = button.parentElement;
  if (!container) return;

  let preview = el('ownPhotoPreview');
  if (!preview) {
    preview = document.createElement('div');
    preview.id = 'ownPhotoPreview';
    preview.style.marginBottom = '12px';
    container.insertBefore(preview, button);
  }

  preview.replaceChildren();

  const allowed = !!user && !admin && validNumber(ownNumber);
  button.disabled = !allowed || busy;
  button.textContent = photos[String(ownNumber)]?.image
    ? 'Change My Photo'
    : 'Upload My Photo';

  if (!allowed) return;

  const record = photos[String(ownNumber)];

  if (record?.image) {
    preview.append(photoImage(record.image, 120));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'danger';
    del.style.marginLeft = '12px';
    del.textContent = 'Delete My Photo';
    del.disabled = busy;
    del.onclick = () => deletePhoto(ownNumber);
    preview.append(del);
  } else {
    preview.textContent = 'No profile photo uploaded.';
  }

  button.onclick = () => selectPhoto(ownNumber);
}

function renderAdminPhotos() {
  const root = el('photoMembersList');
  if (!root || !admin || !user) return;

  root.replaceChildren();

  const search = (el('photoMemberSearch')?.value || '')
    .trim().toLowerCase();

  const entries = Object.entries(members)
    .filter(([number, m]) =>
      `${number} ${m?.name || ''}`.toLowerCase().includes(search)
    )
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .slice(0, 300);

  const table = document.createElement('table');
  const head = document.createElement('thead');
  head.innerHTML =
    '<tr><th>#</th><th>Name</th><th>Photo</th><th>Actions</th></tr>';

  const body = document.createElement('tbody');

  for (const [number, m] of entries) {
    const tr = document.createElement('tr');

    const no = document.createElement('td');
    no.textContent = number;

    const name = document.createElement('td');
    name.textContent = m?.name || '';

    const photo = document.createElement('td');
    const record = photos[number];

    if (record?.image) {
      photo.append(photoImage(record.image));
    } else {
      photo.textContent = 'No photo';
    }

    const actions = document.createElement('td');

    const upload = document.createElement('button');
    upload.type = 'button';
    upload.textContent = record?.image ? 'Change' : 'Upload';
    upload.disabled = busy || m?.status !== 'active';
    upload.onclick = () => selectPhoto(number);
    actions.append(upload);

    if (record?.image) {
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = 'Delete';
      del.className = 'danger';
      del.style.marginLeft = '6px';
      del.disabled = busy;
      del.onclick = () => deletePhoto(number);
      actions.append(del);
    }

    tr.append(no, name, photo, actions);
    body.append(tr);
  }

  table.append(head, body);
  root.append(table);
}

function setupInterface() {
  const own = el('memberPhotoUpload');
  if (own) own.disabled = true;

  const adminUpload = el('adminPhotoUpload');
  if (adminUpload) adminUpload.style.display = 'none';

  const search = el('photoMemberSearch');
  if (search) {
    search.addEventListener('input', renderAdminPhotos);
  }

  // Existing app.js also renders this table.
  // Re-render photo table after its synchronous render.
  const tab = el('tabMemberPhotos');
  if (tab) {
    tab.addEventListener('click', () => {
      queueMicrotask(renderAdminPhotos);
    });
  }
}

setupInterface();

onAuthStateChanged(auth, async signedIn => {
  const generation = ++session;
  stop();
  user = signedIn;

  if (!signedIn) return;

  try {
    const adminSnapshot = await get(
      ref(db, `admins/${signedIn.uid}`)
    );

    if (generation !== session) return;

    admin = adminSnapshot.val() === true;

    if (!admin) {
      const u = (await get(
        ref(db, `users/${signedIn.uid}`)
      )).val();

      if (generation !== session) return;

      if (u?.status !== 'approved' || !validNumber(u.memberNumber)) {
        return;
      }

      ownNumber = String(u.memberNumber);

      const m = (await get(
        ref(db, `members/${ownNumber}`)
      )).val();

      if (generation !== session) return;

      if (!m || m.status !== 'active' || m.uid !== signedIn.uid) {
        ownNumber = null;
        return;
      }
    }

    stopPhotos = onValue(
      ref(db, 'memberPhotos'),
      snapshot => {
        photos = snapshot.val() || {};
        renderOwnPhoto();
        renderAdminPhotos();
      },
      error => message('Photo loading failed: ' + error.message, true)
    );

    if (admin) {
      stopMembers = onValue(
        ref(db, 'members'),
        snapshot => {
          members = snapshot.val() || {};
          renderAdminPhotos();
        },
        error => message(error.message, true)
      );
    }

    renderOwnPhoto();
  } catch (e) {
    message('Photo access failed: ' + e.message, true);
  }
});
