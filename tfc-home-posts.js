
/*
 TFC BANDIYOD — Live Posts Reader v1.1
 FIX: Image stays on Loading

 Existing HTML, static posts, animations,
 running news and title sponsor are untouched.

 Admin posts appear before older posts.
 Firebase image data remains unchanged.
*/

import {
  initializeApp,
  getApps
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';

import {
  getDatabase,
  ref,
  get,
  onValue
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';

import { firebaseConfig } from './firebase-config.js';

const feed = document.getElementById('tfcPostFeed');

if (feed) {

  const app = getApps()[0] || initializeApp(firebaseConfig);
  const db = getDatabase(app);

  const cachedImages = new Map();
  const lastVersions = new Map();
  const blobLinks = new Map();
  const pendingImages = new Set();

  const $ = (tag, className, contents) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (contents != null) node.textContent = contents;
    return node;
  };

  const isJpegData = value =>
    typeof value === 'string' &&
    value.length < 400001 &&
    value.startsWith('data:image/jpeg;base64,');

  let observer;

  window.addEventListener('pagehide', () => {
    for (const url of blobLinks.values()) {
      URL.revokeObjectURL(url);
    }
    blobLinks.clear();
  });

  async function loadPicture(wrapper) {

    const key = wrapper.dataset.livePostId;

    if (
      !key ||
      pendingImages.has(key) ||
      wrapper.dataset.photoReady === '1'
    ) return;

    const picture = wrapper.querySelector('.tfc-live-photo');
    const label = wrapper.querySelector('.tfc-live-placeholder');

    if (!picture) return;

    if (cachedImages.has(key)) {
      showPicture(wrapper, cachedImages.get(key));
      return;
    }

    pendingImages.add(key);

    const expectedVersion = lastVersions.get(key);
    let retry = false;

    try {

      const snapshot = await get(
        ref(db, `tfcSitePosts/images/${key}`)
      );

      const data = snapshot.val();

      if (!isJpegData(data)) {
        throw Error('Image unavailable');
      }

      if (lastVersions.get(key) !== expectedVersion) {
        retry = true;
      } else {

        cachedImages.set(key, data);

        feed.querySelectorAll('.tfc-live-post')
          .forEach(current => {

            if (
              current.dataset.livePostId === key &&
              current.dataset.photoReady !== '1'
            ) {
              showPicture(current, data);
            }

          });
      }

    } catch (error) {

      if (label && wrapper.isConnected) {
        label.textContent = 'ചിത്രം ലഭ്യമല്ല';
      }

      console.warn(
        'TFC post image:',
        error.code || error.message
      );

    } finally {

      pendingImages.delete(key);

      if (retry) {

        const current = [
          ...feed.querySelectorAll('.tfc-live-post')
        ].find(el => el.dataset.livePostId === key);

        if (current) loadPicture(current);
      }
    }
  }

  function showPicture(wrapper, data) {

    const place = wrapper.querySelector('.tfc-live-photo');

    if (!place || wrapper.dataset.photoReady === '1') {
      return;
    }

    const img = document.createElement('img');

    img.alt =
      wrapper.dataset.livePostTitle ||
      'TFC Bandiyod update';

    // FIX: Load immediately, even inside scroll panels.
    img.loading = 'eager';
    img.decoding = 'async';

    img.width = 1100;
    img.height = 1400;

    img.style.display = 'block';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'contain';

    img.addEventListener('load', () => {

      const message = place.querySelector(
        '.tfc-live-placeholder'
      );

      if (message) message.remove();

    }, { once: true });

    img.addEventListener('error', () => {

      const message = place.querySelector(
        '.tfc-live-placeholder'
      );

      if (message) {
        message.textContent = 'ചിത്രം ലഭ്യമല്ല';
      }

    }, { once: true });

    // Original poster opens in a separate tab.
    const link = document.createElement('a');

    if (!blobLinks.has(wrapper.dataset.livePostId)) {

      const encoded = data.slice(
        'data:image/jpeg;base64,'.length
      );

      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);

      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      blobLinks.set(
        wrapper.dataset.livePostId,
        URL.createObjectURL(
          new Blob([bytes], { type: 'image/jpeg' })
        )
      );
    }

    link.href = blobLinks.get(wrapper.dataset.livePostId);
    link.target = '_blank';
    link.rel = 'noopener';

    link.setAttribute(
      'aria-label',
      'Open full poster'
    );

    link.append(img);
    place.append(link);

    wrapper.dataset.photoReady = '1';

    // FIX: Set the source only after image is visible.
    img.src = link. href;

    // Handles images loaded instantly from browser cache.
    if (img.complete && img.naturalWidth > 0) {
      const message = place.querySelector(
        '.tfc-live-placeholder'
      );
      if (message) message.remove();
    }
  }

  function makePost(id, post) {

    const wrapper = $(
      'div',
      'tfc-post-item tfc-live-post'
    );

    wrapper.dataset.livePostId = id;
    wrapper.dataset.livePostTitle = post.title;
    wrapper.dataset.postTitle = post.title;

    const article = $('article', 'news-feature');

    const picture = $(
      'div',
      'news-feature-photo tfc-live-photo'
    );

    picture.append(
      $('span',
        'tfc-live-placeholder',
        '🖼️ പോസ്റ്റർ ലോഡ് ചെയ്യുന്നു…'
      )
    );

    const copy = $('div', 'news-feature-copy');

    copy.append(
      $('span',
        'news-feature-tag',
        '📢 TFC BANDIYOD UPDATE'
      )
    );

    copy.append(
      $('h3', '', post.title)
    );

    if (post.body) {
      copy.append(
        $('p', '', post.body)
      );
    }

    const date = Number(post.createdAt || 0);

    if (date > 0) {

      const d = new Intl.DateTimeFormat(
        'en-IN',
        {
          dateStyle: 'medium',
          timeZone: 'Asia/Kolkata'
        }
      ).format(new Date(date));

      copy.append(
        $('small', 'tfc-live-date', d)
      );
    }

    article.append(picture, copy);
    wrapper.append(article);

    return wrapper;
  }

  function installObserver() {

    if (observer) observer.disconnect();

    observer = new IntersectionObserver(entries => {

      for (const entry of entries) {

        if (entry.isIntersecting) {
          loadPicture(entry.target);
        }

      }

    }, {
      root: feed,
      rootMargin: '280px 0px',
      threshold: 0.01
    });

    feed.querySelectorAll('.tfc-live-post')
      .forEach(el => observer.observe(el));
  }

  onValue(
    ref(db, 'tfcSitePosts/meta'),

    snapshot => {

      const data = snapshot.val() || {};

      const published = Object.entries(data)

        .filter(([id, post]) =>
          id &&
          post &&
          post.status === 'published' &&
          typeof post.title === 'string' &&
          post.title.trim()
        )

        .sort((a, b) =>
          (Number(b[1].createdAt) || 0) -
          (Number(a[1].createdAt) || 0) ||
          b[0].localeCompare(a[0])
        );

      const liveIds = new Set(
        published.map(([id]) => id)
      );

      for (const id of [...lastVersions.keys()]) {

        if (!liveIds.has(id)) {

          lastVersions.delete(id);
          cachedImages.delete(id);

          if (blobLinks.has(id)) {

            URL.revokeObjectURL(
              blobLinks.get(id)
            );

            blobLinks.delete(id);
          }
        }
      }

      for (const [id, post] of published) {

        const version = Number(
          post.updatedAt || 0
        );

        if (
          lastVersions.has(id) &&
          lastVersions.get(id) !== version
        ) {

          cachedImages.delete(id);

          if (blobLinks.has(id)) {

            URL.revokeObjectURL(
              blobLinks.get(id)
            );

            blobLinks.delete(id);
          }
        }

        lastVersions.set(id, version);
      }

      feed.querySelectorAll('.tfc-live-post')
        .forEach(node => node.remove());

      const fragment = document.createDocumentFragment();

      for (const [id, post] of published) {
        fragment.append(makePost(id, post));
      }

      feed.prepend(fragment);

      installObserver();

      feed.dispatchEvent(
        new CustomEvent('tfc:posts-updated')
      );
    },

    error => {

      console.warn(
        'TFC live posts not available yet:',
        error.code || error.message
      );

    }
  );
}
