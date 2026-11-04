/**
 * File Dock — glass circular launcher (bottom-right) + curved dock + explorer panel.
 *
 * Lets the user pick a local folder (File System Access API, with a
 * <input webkitdirectory> fallback), browse it, and open files in the existing
 * WorkspaceViewer (viewer.js). Self-contained; adds no dependencies and does not
 * modify viewer internals. Public API: window.FileDock { open, close, destroy }.
 */
(function () {
  'use strict';
  if (window.FileDock) return;

  // ---------------------------------------------------------------------------
  // Constants & helpers
  // ---------------------------------------------------------------------------
  const EXT = {
    image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'],
    text: ['md', 'markdown', 'txt', 'json', 'csv', 'js', 'ts', 'html', 'css', 'py', 'java', 'c', 'cpp', 'h', 'cs',
      'go', 'rs', 'sql', 'xml', 'yaml', 'yml', 'env', 'sh', 'bat', 'log'],
    media: ['mp4', 'webm', 'ogg', 'mp3', 'wav', 'm4a']
  };
  const ARC_MAX = 5;
  const ARC_RADIUS = 112;
  const ARC_START_DEG = 92;   // nearly straight up
  const ARC_STEP_DEG = 21;    // sweeps toward the left
  const CLOSE_DELAY = 450;    // ms grace period when pointer leaves
  const OPEN_INTENT = 70;     // ms hover intent before opening
  const PAGE_SIZE = 300;      // rows rendered per chunk
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  const ICONS = {
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 17v-4h1.4a1.2 1.2 0 0 1 0 2.4H8.5M13 17v-4M13 13h2M13 15h1.6"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.6"/><path d="m21 15-4.5-4.5L5 21"/>',
    media: '<circle cx="12" cy="12" r="9"/><path d="m10 8.5 5.5 3.5-5.5 3.5z"/>',
    text: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 6l-3 12"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    pin: '<path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    note: '<path d="M5 4h14v11l-5 5H5z"/><path d="M14 20v-5h5M8 9h8M8 13h4"/>',
    folderOpen: '<path d="M3 8a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1H7.4a2 2 0 0 0-1.9 1.4L3 18z"/><path d="M3 18l2.5-6.6A2 2 0 0 1 7.4 10H21l-2.4 7.1A2 2 0 0 1 16.7 18.4H5"/>'
  };
  const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const extOf = (n) => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1).toLowerCase() : ''; };
  const kindOf = (entry) => {
    if (entry.kind === 'dir') return 'dir';
    if (entry.vkind) return entry.vkind; // dashboard items carry their own kind
    const e = extOf(entry.name);
    if (e === 'pdf') return 'pdf';
    if (EXT.image.includes(e)) return 'image';
    if (EXT.media.includes(e)) return 'media';
    if (EXT.text.includes(e)) return 'text';
    return 'other';
  };
  const isSupported = (entry) => typeof entry.open === 'function' || kindOf(entry) !== 'other';
  const formatBytes = (n) => {
    if (!Number.isFinite(n)) return '';
    if (n < 1024) return `${n} B`;
    const u = ['KB', 'MB', 'GB']; let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
  };
  const toast = (msg, type) => {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
    else console.log(`[FileDock:${type || 'info'}] ${msg}`);
  };

  // ---------------------------------------------------------------------------
  // Directory abstraction — one interface over FSA handles and the fallback tree
  //   dir  = { name, list(): Promise<entry[]> }
  //   entry= { kind:'dir'|'file', name, dir?, size?, getFile?(): Promise<File> }
  // Directory handles / file handles never leak outside these closures.
  // ---------------------------------------------------------------------------
  function fsaDir(handle) {
    return {
      name: handle.name,
      src: 'fsa',
      handle,
      async list() {
        const out = [];
        for await (const [name, h] of handle.entries()) {
          if (h.kind === 'directory') out.push({ kind: 'dir', name, dir: fsaDir(h) });
          else out.push({ kind: 'file', name, getFile: () => h.getFile() });
        }
        return out;
      }
    };
  }

  function buildTree(files) {
    const root = { name: '', dirs: new Map(), files: [] };
    for (const file of files) {
      const parts = (file.webkitRelativePath || file.name).split('/');
      if (!root.name) root.name = parts[0];
      let node = root;
      for (let i = 1; i < parts.length - 1; i++) {
        if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { name: parts[i], dirs: new Map(), files: [] });
        node = node.dirs.get(parts[i]);
      }
      node.files.push({ name: parts[parts.length - 1], size: file.size, file });
    }
    return root;
  }
  function treeDir(node) {
    return {
      name: node.name,
      src: 'fallback',
      async list() {
        const dirs = [...node.dirs.values()].map((n) => ({ kind: 'dir', name: n.name, dir: treeDir(n) }));
        const files = node.files.map((f) => ({ kind: 'file', name: f.name, size: f.size, getFile: async () => f.file }));
        return dirs.concat(files);
      }
    };
  }

  // --- Current workspace (server-side uploads) ---
  function wsId() {
    try { if (typeof activeWorkspaceId === 'string' && activeWorkspaceId) return activeWorkspaceId; } catch (e) { /* not defined yet */ }
    return localStorage.getItem('activeWorkspaceId') || 'default';
  }
  async function wsFetchTree(id) {
    const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}/folders`);
    if (!res.ok) throw new Error(`Workspace request failed (${res.status})`);
    return res.json();
  }
  async function wsFetchFile(id, f) {
    const url = `/uploads/${encodeURIComponent(id)}/${f.path.split('/').map(encodeURIComponent).join('/')}`;
    const res = await fetch(url);
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.name = res.status === 404 ? 'NotFoundError' : 'NetworkError';
      throw err;
    }
    const blob = await res.blob();
    return new File([blob], f.name, { type: blob.type, lastModified: Date.parse(f.modifiedAt) || Date.now() });
  }
  function wsEntries(node, id) {
    const dirs = (node.folders || []).map((f) => ({ kind: 'dir', name: f.name, dir: wsDir(f.name, f.path) }));
    const files = (node.files || []).map((f) => ({ kind: 'file', name: f.name, size: f.size, getFile: () => wsFetchFile(id, f) }));
    return dirs.concat(files);
  }
  // relPath '' = workspace root; re-fetched on every listing so it is never stale
  function wsDir(name, relPath) {
    return {
      name,
      src: 'workspace',
      async list() {
        const id = wsId();
        let node = await wsFetchTree(id);
        for (const seg of relPath ? relPath.split('/') : []) {
          node = (node.folders || []).find((f) => f.name === seg);
          if (!node) { const e = new Error('Folder not found'); e.name = 'NotFoundError'; throw e; }
        }
        return wsEntries(node, id);
      }
    };
  }

  // --- Dashboard items (notes, links, PDFs & files, categories) from the app's in-memory data ---
  function dashData() {
    try { if (typeof dbData === 'object' && dbData) return dbData; } catch (e) { /* not defined yet */ }
    return { categories: [], items: [] };
  }
  function itemEntry(item) {
    const name = (item.type === 'file' ? (item.title || item.fileName) : item.title) || 'Untitled';
    const base = { kind: 'file', name, id: item.id, tag: null };
    if (item.type === 'link') {
      return Object.assign(base, { vkind: 'link', tag: 'Link', open: () => window.open(item.url, '_blank', 'noopener,noreferrer') });
    }
    if (item.type === 'note') {
      return Object.assign(base, {
        vkind: 'note', tag: 'Note',
        open: () => { if (typeof openNotePreview === 'function') openNotePreview(item); else toast('Note preview is not available.', 'error'); }
      });
    }
    const ext = extOf(item.fileName || name);
    return Object.assign(base, {
      vkind: ext === 'pdf' ? 'pdf' : EXT.image.includes(ext) ? 'image' : EXT.media.includes(ext) ? 'media' : EXT.text.includes(ext) ? 'text' : 'file',
      tag: ext ? ext.toUpperCase() : 'File',
      open: () => {
        if (window.WorkspaceViewer) return window.WorkspaceViewer.open(item);
        window.open(item.filePath, '_blank');
      }
    });
  }
  const catName = (c) => (typeof c === 'string' ? c : c && c.name);
  function itemsDir(name, pick) {
    return {
      name,
      src: 'items',
      async list() { return dashData().items.filter(pick).map(itemEntry); }
    };
  }
  const itemsRoot = {
    name: 'Dashboard Items',
    src: 'items',
    keepOrder: true,
    async list() {
      const d = dashData();
      const count = (t) => d.items.filter((i) => i.type === t).length;
      const cats = {
        name: 'Categories', src: 'items', keepOrder: true,
        async list() {
          const dd = dashData();
          return (dd.categories || []).map((c) => {
            const cn = catName(c);
            return { kind: 'dir', name: cn, tag: String(dd.items.filter((i) => i.category === cn).length), dir: itemsDir(cn, (i) => i.category === cn) };
          });
        }
      };
      return [
        { kind: 'dir', name: 'All Items', tag: String(d.items.length), dir: itemsDir('All Items', () => true) },
        { kind: 'dir', name: 'Notes', tag: String(count('note')), dir: itemsDir('Notes', (i) => i.type === 'note') },
        { kind: 'dir', name: 'Links', tag: String(count('link')), dir: itemsDir('Links', (i) => i.type === 'link') },
        { kind: 'dir', name: 'PDFs & Files', tag: String(count('file')), dir: itemsDir('PDFs & Files', (i) => i.type === 'file') },
        { kind: 'dir', name: 'Categories', tag: String((d.categories || []).length), dir: cats }
      ];
    }
  };

  // --- Library: virtual root combining the workspace, dashboard items and chosen local folders ---
  const sources = []; // local dirs (fsa / fallback) chosen this session
  const library = {
    name: 'Library',
    src: 'library',
    keepOrder: true,
    async list() {
      return [
        { kind: 'dir', name: 'Workspace', tag: 'Workspace', dir: wsDir('Workspace', '') },
        { kind: 'dir', name: 'Dashboard Items', tag: 'Notes, links & files', dir: itemsRoot }
      ].concat(sources.map((d) => ({ kind: 'dir', name: d.name, tag: d.src === 'fsa' ? 'This device' : 'Snapshot', dir: d })));
    }
  };

  // ---------------------------------------------------------------------------
  // State (explorer navigation, viewer document, and UI kept separate)
  // ---------------------------------------------------------------------------
  const nav = {
    mode: 'library',     // explorer is always available (workspace + local folders)
    started: false,
    stack: [library],    // [library, source, ...subDirs]
    entries: [],         // sorted entries of current dir
    query: '',
    loading: false,
    error: null,         // { title, message, canRetry }
    limit: PAGE_SIZE,
    token: 0
  };
  const doc = {
    selectedKey: null,   // path key of the file currently shown in the viewer
    openingKey: null,
    activeUrl: null,     // object URL of the document currently in the viewer
    openToken: 0
  };
  const ui = { open: false, pinned: false, hoverOpenedAt: 0, closeTimer: 0, openTimer: 0, visible: [] };

  const hasFsa = () => typeof window.showDirectoryPicker === 'function' && window.isSecureContext;

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------
  const abort = new AbortController();
  const on = (target, type, fn, opts) => target.addEventListener(type, fn, Object.assign({ signal: abort.signal }, opts));

  const root = document.createElement('div');
  root.className = 'fxd';
  root.id = 'file-dock';
  root.innerHTML = `
    <div class="fxd-bridge" aria-hidden="true"></div>
    <div class="fxd-arc" role="group" aria-label="Quick shortcuts"></div>
    <section class="fxd-panel" id="file-dock-panel" role="dialog" aria-label="File explorer" data-view="start">
      <div class="fxd-head">
        <button type="button" class="fxd-ibtn" data-act="up" aria-label="Go to parent folder" title="Parent folder">${svg('up')}</button>
        <div class="fxd-titlewrap">
          <div class="fxd-title" id="file-dock-title">Files</div>
          <nav class="fxd-crumbs" aria-label="Folder path"></nav>
        </div>
        <button type="button" class="fxd-ibtn" data-act="pin" aria-pressed="false" aria-label="Keep explorer open" title="Keep open">${svg('pin')}</button>
        <button type="button" class="fxd-ibtn" data-act="close" aria-label="Close file explorer" title="Close (Esc)">${svg('close')}</button>
      </div>
      <div class="fxd-tools">
        <label class="fxd-search">${svg('search')}
          <input type="search" id="file-dock-search" placeholder="Filter this folder" aria-label="Filter files and folders in the current folder" autocomplete="off" spellcheck="false">
        </label>
        <button type="button" class="fxd-btn" data-act="choose" title="Add a folder from this device">${svg('folder')}<span>Add folder</span></button>
      </div>
      <div class="fxd-notice" hidden></div>
      <div class="fxd-body" tabindex="-1"></div>
      <div class="fxd-foot"><span class="fxd-count"></span><span class="fxd-status" aria-live="polite"></span></div>
    </section>
    <button type="button" class="fxd-fab fxd-glass" aria-label="Open file explorer" aria-haspopup="dialog"
            aria-expanded="false" aria-controls="file-dock-panel" title="Files">
      <span class="fxd-fab-icon">${svg('folderOpen')}</span>
    </button>`;

  const el = {
    fab: root.querySelector('.fxd-fab'),
    arc: root.querySelector('.fxd-arc'),
    panel: root.querySelector('.fxd-panel'),
    title: root.querySelector('.fxd-title'),
    crumbs: root.querySelector('.fxd-crumbs'),
    search: root.querySelector('#file-dock-search'),
    notice: root.querySelector('.fxd-notice'),
    body: root.querySelector('.fxd-body'),
    count: root.querySelector('.fxd-count'),
    status: root.querySelector('.fxd-status'),
    up: root.querySelector('[data-act="up"]'),
    pin: root.querySelector('[data-act="pin"]')
  };
  el.panel.classList.add('fxd-glass');

  // ---------------------------------------------------------------------------
  // Open / close
  // ---------------------------------------------------------------------------
  function setOpen(next, opts) {
    opts = opts || {};
    if (ui.open === next) return;
    ui.open = next;
    clearTimeout(ui.closeTimer);
    clearTimeout(ui.openTimer);
    root.classList.toggle('is-open', next);
    el.fab.setAttribute('aria-expanded', String(next));
    el.fab.setAttribute('aria-label', next ? 'Close file explorer' : 'Open file explorer');
    if (next) {
      if (opts.byHover) ui.hoverOpenedAt = Date.now();
      if (!nav.started) { nav.started = true; loadCurrent(); }
      else if (currentDir().src === 'workspace' || currentDir().src === 'items') loadCurrent(true); // pick up new uploads/items
      if (opts.focus) setTimeout(() => focusPrimary(), 180);
    } else {
      ui.pinned = false;
      syncPin();
      if (root.contains(document.activeElement) && document.activeElement !== el.fab) el.fab.focus({ preventScroll: true });
    }
  }
  function scheduleClose() {
    clearTimeout(ui.closeTimer);
    clearTimeout(ui.openTimer);
    if (!ui.open || ui.pinned) return;
    ui.closeTimer = setTimeout(() => { if (!ui.pinned) setOpen(false); }, CLOSE_DELAY);
  }
  function focusPrimary() {
    const t = el.search;
    if (t) t.focus({ preventScroll: true });
  }
  function syncPin() {
    el.pin.setAttribute('aria-pressed', String(ui.pinned));
    el.pin.title = ui.pinned ? 'Unpin (allow auto-close)' : 'Keep open';
    el.pin.setAttribute('aria-label', ui.pinned ? 'Unpin explorer' : 'Keep explorer open');
  }

  // Hover (mouse only), with grace period so small gaps never cause flicker
  on(root, 'pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(ui.closeTimer);
    if (!ui.open) {
      clearTimeout(ui.openTimer);
      ui.openTimer = setTimeout(() => setOpen(true, { byHover: true }), OPEN_INTENT);
    }
  });
  on(root, 'pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    scheduleClose();
  });

  on(el.fab, 'click', () => {
    // A click right after a hover-open should confirm, not immediately collapse
    if (ui.open && Date.now() - ui.hoverOpenedAt < 500) { ui.hoverOpenedAt = 0; return; }
    setOpen(!ui.open, { focus: true });
  });

  // Escape (always closes, even when pinned) — captured so the viewer doesn't also close
  on(window, 'keydown', (e) => {
    if (e.key === 'Escape' && ui.open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }, { capture: true });
  // Keys typed inside the dock must not trigger viewer shortcuts (f, r, arrows, +/-…)
  on(root, 'keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });

  // Outside click / tap closes (unless pinned)
  on(document, 'pointerdown', (e) => {
    if (ui.open && !ui.pinned && !root.contains(e.target)) setOpen(false);
  }, { capture: true });

  // ---------------------------------------------------------------------------
  // Choosing a directory
  // ---------------------------------------------------------------------------
  let fallbackInput = null;

  async function chooseFolder() {
    if (hasFsa()) {
      try {
        const handle = await window.showDirectoryPicker({ mode: 'read', id: 'workspace-pdf-dock' });
        await startBrowsing('fsa', fsaDir(handle));
      } catch (err) {
        if (err && err.name === 'AbortError') return; // user cancelled — silent
        if (err && err.name === 'SecurityError') {
          setError('Folder access blocked',
            'The browser blocked the folder picker (the page may be embedded or lack permission). Use the fallback instead.',
            { fallback: true });
        } else if (err && err.name === 'NotAllowedError') {
          setError('Permission denied', 'Access to the folder was not granted. Choose the folder again and allow access.', {});
        } else {
          setError('Could not open folder', (err && err.message) || 'Unexpected filesystem error.', {});
        }
        render();
      }
    } else {
      chooseViaInput();
    }
  }

  function chooseViaInput() {
    if (!fallbackInput) {
      fallbackInput = document.createElement('input');
      fallbackInput.type = 'file';
      fallbackInput.multiple = true;
      fallbackInput.setAttribute('webkitdirectory', '');
      fallbackInput.setAttribute('directory', '');
      fallbackInput.hidden = true;
      fallbackInput.tabIndex = -1;
      fallbackInput.setAttribute('aria-hidden', 'true');
      root.appendChild(fallbackInput);
      on(fallbackInput, 'change', async () => {
        const files = Array.from(fallbackInput.files || []);
        fallbackInput.value = '';
        if (!files.length) {
          setError('No files received',
            'The selected folder is empty, or the browser did not provide any files. Try another folder.', {});
          render();
          return;
        }
        if (!files[0].webkitRelativePath) {
          setError('Folder selection not supported',
            'This browser did not return folder structure. Use a desktop Chromium, Firefox, or Safari browser.', {});
          render();
          return;
        }
        const tree = buildTree(files);
        await startBrowsing('fallback', treeDir(tree));
      });
    }
    fallbackInput.click();
  }

  // Register a chosen local folder as a source (replacing the same folder if re-picked) and open it
  async function startBrowsing(mode, rootDir) {
    let idx = -1;
    for (let i = 0; i < sources.length; i++) {
      const a = sources[i];
      try {
        if (a.handle && rootDir.handle ? await a.handle.isSameEntry(rootDir.handle) : (a.src === rootDir.src && a.name === rootDir.name && mode === 'fallback')) { idx = i; break; }
      } catch (e) { /* ignore */ }
    }
    if (idx >= 0) sources[idx] = rootDir; else sources.push(rootDir);
    nav.started = true;
    nav.stack = [library, rootDir];
    nav.query = '';
    el.search.value = '';
    nav.error = null;
    await loadCurrent();
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------
  const currentDir = () => nav.stack[nav.stack.length - 1];
  const pathNames = () => nav.stack.map((d) => d.name);
  const keyFor = (entry) => `${pathNames().join('/')}/${entry.id != null ? entry.id : entry.name}`;

  function setError(title, message, extra) {
    nav.error = Object.assign({ title, message }, extra || {});
    nav.loading = false;
  }

  // silent = refresh in place (keep current rows, no spinner / scroll reset)
  async function loadCurrent(silent) {
    const token = ++nav.token;
    nav.loading = true;
    nav.error = null;
    if (!silent) {
      nav.limit = PAGE_SIZE;
      nav.entries = [];
      render();
    }
    let entries;
    try {
      entries = await listWithPermission(currentDir());
    } catch (err) {
      if (token !== nav.token) return;
      const name = err && err.name;
      const ws = currentDir().src === 'workspace';
      if (name === 'NotFoundError') {
        setError('Folder not found', ws ? 'This workspace folder was moved or deleted.' : 'This folder was moved or deleted since it was chosen.', { canRetry: true, fromLoad: true });
      } else if (name === 'NotAllowedError' || name === 'SecurityError') {
        setError('Permission needed', 'The browser no longer allows access to this folder. Add it again to continue.', { fromLoad: true });
      } else {
        setError(ws ? 'Could not load workspace' : 'Could not read folder', (err && err.message) || 'Unexpected error.', { canRetry: true, fromLoad: true });
      }
      nav.entries = [];
      render();
      return;
    }
    if (token !== nav.token) return;
    if (!currentDir().keepOrder) {
      entries.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'dir' ? -1 : 1) || collator.compare(a.name, b.name));
    }
    nav.entries = entries;
    nav.loading = false;
    render();
    if (!silent) el.body.scrollTop = 0;
  }

  // Re-prompt for read permission (only reachable from a user click) if it lapsed
  async function listWithPermission(dir) {
    try {
      return await dir.list();
    } catch (err) {
      const h = dir.handle;
      if (err && err.name === 'NotAllowedError' && h && typeof h.requestPermission === 'function') {
        const state = await h.requestPermission({ mode: 'read' });
        if (state === 'granted') return dir.list();
      }
      throw err;
    }
  }

  function enter(dir) { nav.stack.push(dir); resetFilter(); loadCurrent(); }
  function goUp() { if (nav.stack.length > 1) { nav.stack.pop(); resetFilter(); loadCurrent(); } }
  function goTo(depth) {
    if (depth >= 0 && depth < nav.stack.length - 1) { nav.stack.length = depth + 1; resetFilter(); loadCurrent(); }
  }
  function resetFilter() { nav.query = ''; el.search.value = ''; }

  // ---------------------------------------------------------------------------
  // Opening documents in the existing viewer
  // ---------------------------------------------------------------------------
  function revoke(url) { if (url) { try { URL.revokeObjectURL(url); } catch (e) { /* noop */ } } }

  async function openEntry(entry) {
    if (entry.kind === 'dir') return enter(entry.dir);
    if (typeof entry.open === 'function') { // dashboard item: delegate to the app's own handler
      try { await entry.open(); doc.selectedKey = keyFor(entry); }
      catch (err) { toast(`Failed to open "${entry.name}": ${(err && err.message) || 'unknown error'}`, 'error'); }
      render();
      if (!ui.pinned) setOpen(false);
      return;
    }
    if (!isSupported(entry)) {
      toast(`"${entry.name}" can't be previewed. Supported: PDF, images, text/code, audio/video.`, 'error');
      return;
    }
    const viewer = window.WorkspaceViewer;
    if (!viewer || typeof viewer.open !== 'function') {
      toast('The document viewer is not available.', 'error');
      return;
    }
    const key = keyFor(entry);
    const myToken = ++doc.openToken;
    doc.openingKey = key;
    setStatus(`Opening ${entry.name}…`);
    renderListOnly();

    let file;
    try {
      file = await entry.getFile();
    } catch (err) {
      if (myToken === doc.openToken) { doc.openingKey = null; setStatus(''); renderListOnly(); }
      const msg = err && err.name === 'NotFoundError' ? 'The file was moved or deleted.'
        : err && err.name === 'NotAllowedError' ? 'Permission to read this file was denied.'
          : `The file could not be read${err && err.message ? ` (${err.message})` : ''}.`;
      toast(`Couldn't open "${entry.name}": ${msg}`, 'error');
      return;
    }
    if (myToken !== doc.openToken) return; // a newer click superseded this one

    const url = URL.createObjectURL(file);
    const prevUrl = doc.activeUrl;
    doc.activeUrl = url;
    try {
      await viewer.open({
        // Stable id => viewer persists reading position & annotations per document
        id: `fxd:${pathNames().join('/')}/${entry.name}|${file.size}`,
        title: file.name,
        fileName: file.name,
        name: file.name,
        size: file.size,
        type: 'file',
        rawFile: file,
        filePath: url
      });
      doc.selectedKey = key;
    } catch (err) {
      toast(`Failed to open "${entry.name}": ${(err && err.message) || 'unknown error'}`, 'error');
    } finally {
      revoke(prevUrl);
      if (myToken === doc.openToken) { doc.openingKey = null; setStatus(''); }
      render();
    }
    if (!ui.pinned) setOpen(false);
  }

  // Free the object URL when the viewer is closed; track viewer state for layout
  const overlay = document.getElementById('docviewer-overlay');
  if (overlay) {
    const sync = () => {
      const openNow = overlay.classList.contains('active');
      root.classList.toggle('fxd--viewer', openNow);
      if (!openNow && doc.activeUrl) { revoke(doc.activeUrl); doc.activeUrl = null; }
    };
    const mo = new MutationObserver(sync);
    mo.observe(overlay, { attributes: true, attributeFilter: ['class'] });
    on(window, 'pagehide', () => mo.disconnect());
    abort.signal.addEventListener('abort', () => mo.disconnect());
    sync();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function setStatus(text) { el.status.textContent = text || ''; }

  function visibleEntries() {
    const q = nav.query.trim().toLowerCase();
    return q ? nav.entries.filter((e) => e.name.toLowerCase().includes(q)) : nav.entries;
  }

  function render() {
    el.panel.dataset.view = 'browse';
    ui.visible = visibleEntries();

    // Header: current folder name + breadcrumb + parent control
    const names = pathNames();
    el.title.textContent = names[names.length - 1];
    el.title.title = names.join(' / ');
    el.up.disabled = nav.stack.length < 2;
    el.crumbs.innerHTML = names.map((n, i) => {
      const last = i === names.length - 1;
      return (i ? `<span class="fxd-crumb-sep" aria-hidden="true">/</span>` : '') +
        `<button type="button" class="fxd-crumb" data-crumb="${i}" title="${esc(n)}"${last ? ' aria-current="location"' : ''}>${esc(n)}</button>`;
    }).join('');
    const lastCrumb = el.crumbs.lastElementChild;
    if (lastCrumb) lastCrumb.scrollIntoView({ inline: 'end', block: 'nearest' });

    // Fallback limitation notice
    if (nav.stack.some((d) => d.src === 'fallback')) {
      el.notice.hidden = false;
      el.notice.textContent = 'Compatibility mode: this browser shares a one-time snapshot of the folder. ' +
        'Changes on disk won\u2019t appear until you choose the folder again. Nothing is uploaded.';
    } else {
      el.notice.hidden = true;
    }

    renderBody();
    renderArc();
  }

  function renderListOnly() { renderBody(); renderArc(); }

  function renderBody() {
    // Error / loading / start states
    if (nav.loading && !nav.entries.length) {
      el.body.innerHTML = `<div class="fxd-state" role="status"><div class="fxd-spinner"></div><p>Reading folder…</p></div>`;
      el.count.textContent = '';
      return;
    }
    if (nav.error) {
      const e = nav.error;
      el.body.innerHTML = `
        <div class="fxd-state fxd-state--error" role="alert">
          <div class="fxd-state-icon">${svg('alert')}</div>
          <h3>${esc(e.title)}</h3><p>${esc(e.message)}</p>
          <div class="fxd-state-actions">
            ${e.canRetry ? `<button type="button" class="fxd-btn" data-act="retry">Retry</button>` : ''}
            <button type="button" class="fxd-btn" data-act="dismiss">Back</button>
            <button type="button" class="fxd-btn fxd-btn--primary" data-act="choose">${svg('folder')}Add Folder</button>
            ${e.fallback ? `<button type="button" class="fxd-btn" data-act="fallback">Use compatibility mode</button>` : ''}
          </div>
        </div>`;
      el.count.textContent = '';
      return;
    }

    const list = ui.visible;
    if (!list.length) {
      el.body.innerHTML = nav.query.trim()
        ? `<div class="fxd-state"><div class="fxd-state-icon">${svg('search')}</div><h3>No matches</h3><p>Nothing in this folder matches \u201c${esc(nav.query.trim())}\u201d.</p></div>`
        : `<div class="fxd-state"><div class="fxd-state-icon">${svg('folder')}</div><h3>This folder is empty</h3><p>There are no files or folders here.</p></div>`;
      el.count.textContent = nav.query.trim() ? `0 of ${nav.entries.length}` : '0 items';
      return;
    }

    const shown = list.slice(0, nav.limit);
    const rows = shown.map((entry, i) => {
      const kind = kindOf(entry);
      const key = keyFor(entry);
      const selected = key === doc.selectedKey;
      const loading = key === doc.openingKey;
      const meta = entry.tag ? esc(entry.tag) : entry.kind === 'dir' ? svg('chevron') : (entry.size != null ? esc(formatBytes(entry.size)) : esc(extOf(entry.name).toUpperCase()));
      const cls = ['fxd-row', selected && 'is-selected', loading && 'is-loading', !isSupported(entry) && entry.kind === 'file' && 'is-unsupported']
        .filter(Boolean).join(' ');
      const label = entry.kind === 'dir' ? `Folder ${entry.name}` : entry.name;
      return `<li><button type="button" class="${cls}" data-i="${i}" data-kind="${kind}" title="${esc(entry.name)}"
        aria-label="${esc(label)}"${selected ? ' aria-current="true"' : ''}${loading ? ' aria-busy="true"' : ''}>
        <span class="fxd-ico" data-kind="${kind}">${svg(kind === 'dir' ? 'folder' : (kind === 'other' || !ICONS[kind]) ? 'file' : kind)}</span>
        <span class="fxd-name">${esc(entry.name)}</span><span class="fxd-meta">${meta}</span></button></li>`;
    }).join('');
    const more = list.length > shown.length
      ? `<button type="button" class="fxd-btn fxd-more" data-act="more">Show ${Math.min(PAGE_SIZE, list.length - shown.length)} more (${list.length - shown.length} hidden)</button>` : '';
    const hint = currentDir() === library
      ? `<div class="fxd-state"><p>${sources.length ? 'Add another folder from this device to browse it here too.' : (hasFsa()
        ? 'Browse a folder from your computer alongside the workspace. Access is read-only and only granted when you choose.'
        : 'Add a folder from this device. This browser shares a one-time snapshot of its files (nothing is uploaded).')}</p>
        <div class="fxd-state-actions"><button type="button" class="fxd-btn fxd-btn--primary" data-act="choose">${svg('folder')}Add Folder from Device</button></div></div>`
      : '';
    el.body.innerHTML = `<ul class="fxd-list" role="list">${rows}</ul>${more}${hint}`;
    const folders = list.filter((e) => e.kind === 'dir').length;
    el.count.textContent = nav.query.trim()
      ? `${list.length} of ${nav.entries.length} match`
      : `${folders} folder${folders === 1 ? '' : 's'}, ${list.length - folders} file${list.length - folders === 1 ? '' : 's'}`;
  }

  function renderArc() {
    // Manageable preview: folders first, then PDFs, then other supported files
    const rank = (e) => (e.kind === 'dir' ? 0 : extOf(e.name) === 'pdf' ? 1 : isSupported(e) ? 2 : 3);
    let items = ui.visible.map((e, idx) => ({ e, idx }))
      .filter((x) => rank(x.e) < 3)
      .sort((a, b) => rank(a.e) - rank(b.e) || a.idx - b.idx)
      .slice(0, ARC_MAX);
    if (nav.error) items = [{ choose: true }];
    else if (currentDir() === library) items = items.slice(0, ARC_MAX - 1).concat([{ choose: true }]);
    const n = items.length;
    const start = n === 1 ? 135 : ARC_START_DEG;
    el.arc.innerHTML = items.map((it, i) => {
      const deg = start + i * ARC_STEP_DEG;
      const rad = (deg * Math.PI) / 180;
      const tx = (ARC_RADIUS * Math.cos(rad)).toFixed(1);
      const ty = (-ARC_RADIUS * Math.sin(rad)).toFixed(1);
      const style = `--tx:${tx}px;--ty:${ty}px;--i:${i}`;
      if (it.choose) {
        return `<button type="button" class="fxd-arc-item fxd-glass" data-kind="choose" data-act="choose" style="${style}"
          aria-label="Add folder from this device" title="Add folder from this device" tabindex="${ui.open ? 0 : -1}">${svg('folder')}</button>`;
      }
      const kind = kindOf(it.e);
      const selected = keyFor(it.e) === doc.selectedKey;
      return `<button type="button" class="fxd-arc-item fxd-glass${selected ? ' is-selected' : ''}" data-kind="${kind}" data-arc="${it.idx}"
        style="${style}" aria-label="${esc(it.e.kind === 'dir' ? 'Open folder ' + it.e.name : 'Open ' + it.e.name)}" title="${esc(it.e.name)}">${svg(kind === 'dir' ? 'folder' : ICONS[kind] ? kind : 'file')}</button>`;
    }).join('');
  }

  // ---------------------------------------------------------------------------
  // Events inside the dock
  // ---------------------------------------------------------------------------
  on(root, 'click', (e) => {
    const crumb = e.target.closest('[data-crumb]');
    if (crumb) return goTo(parseInt(crumb.dataset.crumb, 10));
    const arcBtn = e.target.closest('[data-arc]');
    if (arcBtn) { const entry = ui.visible[parseInt(arcBtn.dataset.arc, 10)]; if (entry) openEntry(entry); return; }
    const row = e.target.closest('.fxd-row');
    if (row) { const entry = ui.visible[parseInt(row.dataset.i, 10)]; if (entry) openEntry(entry); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    switch (act.dataset.act) {
      case 'close': setOpen(false); break;
      case 'pin': ui.pinned = !ui.pinned; syncPin(); break;
      case 'up': goUp(); break;
      case 'choose': chooseFolder(); break;
      case 'fallback': chooseViaInput(); break;
      case 'retry': loadCurrent(); break;
      case 'dismiss':
        if (nav.error && nav.error.fromLoad && nav.stack.length > 1) goUp();
        else { nav.error = null; render(); }
        break;
      case 'more': nav.limit += PAGE_SIZE; renderBody(); break;
      default: break;
    }
  });

  let searchTimer = 0;
  on(el.search, 'input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { nav.query = el.search.value; nav.limit = PAGE_SIZE; render(); }, 110);
  });
  on(el.search, 'keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); const r = el.body.querySelector('.fxd-row'); if (r) r.focus(); }
    else if (e.key === 'Enter') { const first = ui.visible[0]; if (first) openEntry(first); }
  });
  // Arrow-key navigation within the list
  on(el.body, 'keydown', (e) => {
    const row = e.target.closest('.fxd-row');
    if (!row) return;
    const rows = Array.from(el.body.querySelectorAll('.fxd-row'));
    const idx = rows.indexOf(row);
    if (e.key === 'ArrowDown') { e.preventDefault(); (rows[idx + 1] || row).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (idx === 0) el.search.focus(); else rows[idx - 1].focus(); }
    else if (e.key === 'ArrowRight' && row.dataset.kind === 'dir') { e.preventDefault(); row.click(); }
    else if (e.key === 'ArrowLeft' || e.key === 'Backspace') { e.preventDefault(); goUp(); }
  });

  // Compact layout on short / narrow viewports (panel hugs the circle, arc hidden)
  const mq = window.matchMedia('(max-height: 639px), (max-width: 479px)');
  const syncCompact = () => root.classList.toggle('fxd--compact', mq.matches);
  if (mq.addEventListener) on(mq, 'change', syncCompact); else if (mq.addListener) mq.addListener(syncCompact);
  syncCompact();

  // ---------------------------------------------------------------------------
  // Mount
  // ---------------------------------------------------------------------------
  function mount() { document.body.appendChild(root); render(); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });

  function destroy() {
    clearTimeout(ui.closeTimer); clearTimeout(ui.openTimer); clearTimeout(searchTimer);
    abort.abort();
    revoke(doc.activeUrl); doc.activeUrl = null;
    nav.stack = []; nav.entries = [];
    root.remove();
    delete window.FileDock;
  }

  window.FileDock = {
    open: () => setOpen(true, { focus: true }),
    close: () => setOpen(false),
    destroy
  };
})();
