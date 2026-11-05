/**
 * Browse — unified folders + files view for the dashboard.
 *
 * Pure view layer over data app.js already loads (dbData, workspaceFolders,
 * workspaceRootFiles), so it works for both backends:
 *   - filesystem: folders come from the server tree, files from db items + untracked files
 *   - Supabase:   folders come from `folders` rows (path = parent + '/' + name), items use `item.folder`
 * Unfiled items keep rendering through app.js's createCardElement (card design unchanged).
 * Public API: window.Browse { handles, render, hide, navigate, invalidate }
 */
(function () {
  'use strict';
  if (window.Browse) return;

  const $ = (id) => document.getElementById(id);
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const PPT = ['ppt', 'pptx', 'pps', 'ppsx', 'potx', 'odp'];
  const ICON = { folder: 'folder', pdf: 'file-text', ppt: 'presentation', note: 'sticky-note', link: 'link-2', other: 'file' };

  const st = {
    path: '',
    view: localStorage.getItem('browseView') === 'list' ? 'list' : 'grid',
    sort: { key: 'name', dir: 1 },
    sel: null,
    open: new Set(),
    ws: null,
    rows: new Map(),
    bound: false
  };

  // ---------------------------------------------------------------- helpers
  // app.js declares these with top-level `let`, which other classic scripts can read by bare name
  const READ = {
    dbData: () => dbData, workspaceFolders: () => workspaceFolders, activeTypeFilter: () => activeTypeFilter,
    activeCategoryFilter: () => activeCategoryFilter, searchQuery: () => searchQuery
  };
  const g = (name) => { try { return READ[name](); } catch (e) { return undefined; } };
  const esc = (s) => (typeof escapeHTML === 'function' ? escapeHTML(String(s)) : String(s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';'));
  const icons = () => { if (typeof safeCreateIcons === 'function') safeCreateIcons(); else if (window.lucide) window.lucide.createIcons(); };
  const extOf = (n) => { n = String(n || ''); const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1).toLowerCase() : ''; };
  const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

  function fmtSize(n) {
    if (!Number.isFinite(n) || n == null) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    return `${(n / 1024 ** 3).toFixed(1)} GB`;
  }
  const rtf = typeof Intl.RelativeTimeFormat === 'function' ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null;
  function fmtRel(ms) {
    if (!ms) return '—';
    const s = Math.round((ms - Date.now()) / 1000), a = Math.abs(s);
    if (a < 60) return 'just now';
    if (!rtf) return new Date(ms).toLocaleDateString();
    if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
    if (a < 86400 * 365) return rtf.format(Math.round(s / (86400 * 30)), 'month');
    return rtf.format(Math.round(s / (86400 * 365)), 'year');
  }

  function classify(item) {
    if (item.type === 'note') return { label: 'NOTE', cls: 'note' };
    if (item.type === 'link') return { label: 'LINK', cls: 'link' };
    const ext = extOf(item.fileName || item.title);
    if (ext === 'pdf') return { label: 'PDF', cls: 'pdf' };
    if (PPT.includes(ext)) return { label: ext.toUpperCase(), cls: 'ppt' };
    return { label: ext ? ext.toUpperCase() : 'FILE', cls: 'other' };
  }

  // ------------------------------------------------------------------ model
  function buildModel() {
    const ws = typeof activeWorkspaceId === 'string' ? activeWorkspaceId : 'default';
    const items = (g('dbData') && g('dbData').items) || [];
    const rows = g('workspaceFolders') || [];
    const folders = new Map();
    const filesIn = new Map();

    rows.forEach((r) => {
      if (!r) return;
      if (r.path !== undefined) {
        const walkNode = (node, parent) => {
          folders.set(node.path, { name: node.name, path: node.path, parent: parent || '' });
          filesIn.set(node.path, node.files || []);
          (node.folders || []).forEach((c) => walkNode(c, node.path));
        };
        walkNode(r, r.parent || '');
      } else {
        const parent = r.parent || '';
        const path = parent ? `${parent}/${r.name}` : r.name;
        folders.set(path, { name: r.name, path, parent, id: r.id });
      }
    });
    filesIn.set('', window.workspaceRootFiles || []);

    const registerFolderPath = (fPath) => {
      if (!fPath) return;
      const parts = fPath.split('/').filter(Boolean);
      let curr = '';
      parts.forEach((p) => {
        const parent = curr;
        curr = curr ? `${curr}/${p}` : p;
        if (!folders.has(curr)) {
          folders.set(curr, { name: p, path: curr, parent });
        }
      });
    };

    // Auto-discover folders from items
    items.forEach((it) => {
      if (it.folder) registerFolderPath(it.folder);
      else if (it.type === 'file' && typeof it.filePath === 'string' && it.filePath.includes('/uploads/')) {
        const after = it.filePath.split('/uploads/')[1];
        if (after) {
          const segs = after.split('/').filter(Boolean);
          if (segs.length > 2) {
            registerFolderPath(segs.slice(1, -1).map(decodeURIComponent).join('/'));
          }
        }
      }
    });

    const prefix = `/uploads/${ws}/`;
    const tracked = new Set();
    const entries = [];
    const mk = (item, folder, mod, size) => {
      if (folder) registerFolderPath(folder);
      const c = classify(item);
      return {
        item, folder, id: item.id, name: item.title || item.fileName || 'Untitled',
        size: item.type === 'file' && size != null && Number.isFinite(Number(size)) ? Number(size) : null,
        mod: Date.parse(mod) || 0, label: c.label, cls: c.cls
      };
    };

    items.forEach((it) => {
      let folder = it.folder || '';
      if (it.type === 'file' && typeof it.filePath === 'string') {
        if (it.filePath.startsWith(prefix)) {
          let rel = it.filePath.slice(prefix.length);
          try { rel = decodeURIComponent(rel); } catch (e) { /* keep raw */ }
          tracked.add(rel);
          if (!it.folder) folder = parentOf(rel);
        } else if (it.filePath.includes('/uploads/')) {
          const after = it.filePath.split('/uploads/')[1];
          if (after) {
            const segs = after.split('/').filter(Boolean);
            if (segs.length > 2 && !it.folder) {
              folder = segs.slice(1, -1).map(decodeURIComponent).join('/');
            }
          }
        }
      }
      entries.push(mk(it, folder, it.updatedAt || it.createdAt, it.fileSize));
    });

    filesIn.forEach((files, dir) => {
      files.forEach((f) => {
        if (tracked.has(f.path)) return;
        const url = `/uploads/${encodeURIComponent(ws)}/${f.path.split('/').map(encodeURIComponent).join('/')}`;
        const item = { id: `fs:${f.path}`, type: 'file', title: f.name, fileName: f.name, filePath: url, path: f.path,
          fileSize: f.size, category: 'General', createdAt: f.modifiedAt };
        entries.push(mk(item, dir, f.modifiedAt, f.size));
      });
    });

    const count = (path) => {
      let n = 0;
      folders.forEach((f) => { if (f.parent === path) n++; });
      entries.forEach((e) => { if (e.folder === path) n++; });
      return n;
    };
    return { ws, folders, entries, count };
  }

  function matchEntry(e, q) {
    const it = e.item;
    return [it.title, it.description, it.category, it.url, it.content, it.fileName]
      .some((v) => v && String(v).toLowerCase().includes(q));
  }

  // ----------------------------------------------------------------- chrome
  function wsName() {
    const sel = $('workspace-select');
    return (sel && sel.selectedOptions[0] && sel.selectedOptions[0].textContent) || 'Workspace';
  }

  function renderSwitcher() {
    const name = $('br-ws-name');
    if (name) name.textContent = wsName();
  }

  function renderCrumbs(q) {
    const el = $('br-crumbs');
    if (q) { el.innerHTML = `<span class="br-crumb" aria-current="location">Search results for “${esc(q)}” in ${esc(wsName())}</span>`; return; }
    const parts = st.path ? st.path.split('/') : [];
    let acc = '';
    const html = [`<button type="button" class="br-crumb" data-path=""${parts.length ? '' : ' aria-current="location"'}>${esc(wsName())}</button>`];
    parts.forEach((p, i) => {
      acc = acc ? `${acc}/${p}` : p;
      html.push('<span class="br-crumb-sep" aria-hidden="true">/</span>');
      html.push(`<button type="button" class="br-crumb" data-path="${esc(acc)}"${i === parts.length - 1 ? ' aria-current="location"' : ''}>${esc(p)}</button>`);
    });
    el.innerHTML = html.join('');
  }

  function renderTree(m) {
    const root = $('browse-tree');
    if (!root) return;
    // keep the active branch expanded
    let acc = '';
    (st.path ? st.path.split('/') : []).slice(0, -1).forEach((p) => { acc = acc ? `${acc}/${p}` : p; st.open.add(acc); });

    const kids = (p) => [...m.folders.values()].filter((f) => f.parent === p).sort((a, b) => collator.compare(a.name, b.name));
    const node = (f) => {
      const sub = kids(f.path);
      const open = st.open.has(f.path);
      return `<li role="treeitem" aria-expanded="${sub.length ? open : 'false'}">
        <div class="br-trow${f.path === st.path ? ' is-active' : ''}" tabindex="0" data-path="${esc(f.path)}" title="${esc(f.path)}">
          <button type="button" class="br-tchev${sub.length ? '' : ' is-leaf'}" data-toggle="${esc(f.path)}" aria-expanded="${open}" aria-label="Toggle ${esc(f.name)}" tabindex="-1"><i data-lucide="chevron-right"></i></button>
          <i data-lucide="folder" class="br-tfolder"></i><span class="br-tlabel">${esc(f.name)}</span><span class="br-tcount">${m.count(f.path)}</span>
        </div>${sub.length ? `<ul role="group"${open ? '' : ' hidden'}>${sub.map(node).join('')}</ul>` : ''}</li>`;
    };
    root.setAttribute('role', 'tree');
    root.className = 'br-tree';
    root.innerHTML = `<li role="treeitem"><div class="br-trow${st.path === '' ? ' is-active' : ''}" tabindex="0" data-path="">
        <button type="button" class="br-tchev is-leaf" tabindex="-1" aria-hidden="true"><i data-lucide="chevron-right"></i></button>
        <i data-lucide="layout-grid"></i><span class="br-tlabel">${esc(wsName())}</span><span class="br-tcount">${m.count('')}</span></div>
        <ul role="group">${kids('').map(node).join('')}</ul></li>`;

    const badge = $('count-folders');
    if (badge) badge.textContent = m.folders.size;
  }

  function syncToggle() {
    document.querySelectorAll('.br-toggle button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === st.view)));
  }

  // ------------------------------------------------------------------ views
  function openEntry(e) {
    const it = e.item;
    if (it.type === 'link') window.open(it.url, '_blank', 'noopener,noreferrer');
    else if (it.type === 'note') { if (typeof openNotePreview === 'function') openNotePreview(it); }
    else if (window.WorkspaceViewer) window.WorkspaceViewer.open(it);
    else window.open(it.filePath, '_blank');
  }

  function ctxAt(anchor, target, type) {
    const r = anchor.getBoundingClientRect();
    if (typeof openContextMenu === 'function') openContextMenu({ clientX: r.left, clientY: r.bottom }, target, type);
  }

  function emptyHTML() {
    return `<div class="br-empty"><i data-lucide="folder-open"></i><p>This folder is empty. Upload files or drag them here.</p></div>`;
  }

  function renderGrid(folders, entries, m) {
    const grid = $('items-grid');
    $('br-list').hidden = true;
    grid.style.display = 'grid';
    grid.innerHTML = '';
    st.rows.clear();

    if (!folders.length && !entries.length) { grid.innerHTML = emptyHTML(); return; }

    if (folders.length) {
      const strip = document.createElement('div');
      strip.className = 'br-folders';
      strip.setAttribute('role', 'list');
      folders.forEach((f) => {
        const n = m.count(f.path);
        const t = document.createElement('div');
        t.className = 'br-folder';
        t.tabIndex = 0;
        t.setAttribute('role', 'listitem');
        t.dataset.path = f.path;
        t.title = f.path;
        t.setAttribute('aria-label', `Folder ${f.name}, ${n} item${n === 1 ? '' : 's'}`);
        t.innerHTML = `<span class="br-fico"><i data-lucide="folder"></i></span><span class="br-fname">${esc(f.name)}</span><span class="br-fcount">${n} item${n === 1 ? '' : 's'}</span>
          <button type="button" class="br-fmore" aria-label="Actions for ${esc(f.name)}" title="Rename, move, delete">⋯</button>`;
        t._folder = f;
        strip.appendChild(t);
      });
      grid.appendChild(strip);
    }

    entries
      .slice()
      .sort((a, b) => (Date.parse(b.item.createdAt) || 0) - (Date.parse(a.item.createdAt) || 0))
      .forEach((e) => grid.appendChild(createCardElement(e.item))); // existing card design, untouched
  }

  function cmp(a, b) {
    const { key, dir } = st.sort;
    let r = 0;
    if (key === 'date') r = a.mod - b.mod;
    else if (key === 'type') r = collator.compare(a.label, b.label);
    else if (key === 'size') r = (a.size == null ? -1 : a.size) - (b.size == null ? -1 : b.size);
    return (r || collator.compare(a.name, b.name)) * dir;
  }

  function renderList(folders, entries, m) {
    $('items-grid').style.display = 'none';
    const box = $('br-list');
    box.hidden = false;
    st.rows.clear();

    const rp = typeof window.ReadingProgressManager !== 'undefined' ? window.ReadingProgressManager : null;
    const rows = [];
    // Folders always on top
    const fRows = folders.map((f) => ({ f, name: f.name, n: m.count(f.path), mod: 0, label: 'FOLDER', size: m.count(f.path) }));
    const k = st.sort.key;
    fRows.sort((a, b) => (k === 'name' ? collator.compare(a.name, b.name) * st.sort.dir : k === 'size' ? (a.n - b.n) * st.sort.dir || collator.compare(a.name, b.name) : collator.compare(a.name, b.name)));
    fRows.forEach((r) => {
      const key = `d:${r.f.path}`;
      st.rows.set(key, { kind: 'folder', ref: r.f });
      rows.push(`<tr class="t-folder${st.sel === key ? ' is-selected' : ''}" tabindex="0" data-key="${esc(key)}">
        <td><div class="br-name"><i data-lucide="folder"></i><span class="br-title">${esc(r.name)}</span><button type="button" class="br-rmore" aria-label="Actions for ${esc(r.name)}">⋯</button></div></td>
        <td class="c-date">—</td><td class="c-type"><span class="br-pill">FOLDER</span></td><td class="c-size">${r.n} item${r.n === 1 ? '' : 's'}</td></tr>`);
    });
    entries.slice().sort(cmp).forEach((e) => {
      const key = `e:${e.id}`;
      st.rows.set(key, { kind: 'entry', ref: e });
      let prog = '';
      if (rp && e.item.type === 'file') {
        const p = rp.getProgress(e.item);
        if (p && (p.page > 1 || p.percentage > 0)) prog = `<span class="br-prog" title="Reading progress">${p.percentage}% · Pg ${p.page}</span>`;
      }
      const full = e.mod ? new Date(e.mod).toLocaleString() : '';
      rows.push(`<tr class="t-${e.cls}${st.sel === key ? ' is-selected' : ''}" tabindex="0" data-key="${esc(key)}">
        <td><div class="br-name"><i data-lucide="${ICON[e.cls]}"></i><span class="br-title" title="${esc(e.name)}">${esc(e.name)}</span>${prog}<button type="button" class="br-rmore" aria-label="Actions for ${esc(e.name)}">⋯</button></div></td>
        <td class="c-date" title="${esc(full)}">${fmtRel(e.mod)}</td><td class="c-type"><span class="br-pill">${esc(e.label)}</span></td><td class="c-size">${fmtSize(e.size)}</td></tr>`);
    });

    const th = (key, label, cls) => {
      const on = st.sort.key === key;
      return `<th class="${cls}" data-sort="${key}" scope="col"${on ? ` aria-sort="${st.sort.dir === 1 ? 'ascending' : 'descending'}"` : ''}>${label}<span class="br-arrow">${on ? (st.sort.dir === 1 ? '▲' : '▼') : '▲'}</span></th>`;
    };
    box.innerHTML = `<div class="br-scroll"><table class="br-table" role="grid">
      <thead><tr>${th('name', 'Name', 'c-name')}${th('date', 'Date modified', 'c-date')}${th('type', 'Type', 'c-type')}${th('size', 'Size', 'c-size')}</tr></thead>
      <tbody>${rows.join('') || `<tr><td colspan="4" style="height:auto;padding:0;white-space:normal">${emptyHTML()}</td></tr>`}</tbody></table></div>`;
  }

  // ------------------------------------------------------------------- core
  function handles() {
    return g('activeTypeFilter') === 'all' && !g('activeCategoryFilter');
  }

  function render() {
    bind();
    const m = buildModel();
    if (st.ws !== m.ws) { st.ws = m.ws; st.path = ''; st.sel = null; st.open.clear(); }
    if (st.path && !m.folders.has(st.path)) st.path = '';

    const es = $('empty-state');
    if (es) es.style.display = 'none';
    $('br-bar').hidden = false;

    const q = String(g('searchQuery') || '').trim().toLowerCase();
    let folders, entries;
    if (q) {
      folders = [...m.folders.values()].filter((f) => f.name.toLowerCase().includes(q));
      entries = m.entries.filter((e) => matchEntry(e, q));
    } else {
      folders = [...m.folders.values()].filter((f) => f.parent === st.path);
      entries = m.entries.filter((e) => e.folder === st.path);
    }
    folders.sort((a, b) => collator.compare(a.name, b.name)); // folders first, alphabetical

    renderSwitcher();
    renderCrumbs(q);
    renderTree(m);
    syncToggle();
    updateNavButtons();
    if (st.view === 'list') renderList(folders, entries, m); else renderGrid(folders, entries, m);
    icons();
  }

  function hide() {
    const bar = $('br-bar');
    if (bar) bar.hidden = true;
    const list = $('br-list');
    if (list) list.hidden = true;
    // Hide the header nav arrows when browse view is inactive
    const hGroup = $('hdr-nav-arrows');
    if (hGroup) hGroup.hidden = true;
    renderSwitcher();
  }

  // ----------------------------------------------------------- navigation
  const navHistory = [''];
  let navHistoryIdx = 0;

  function pushHistory(path) {
    if (navHistory[navHistoryIdx] === path) return;
    navHistory.splice(navHistoryIdx + 1);
    navHistory.push(path);
    navHistoryIdx = navHistory.length - 1;
    updateNavButtons();
  }

  function goBack() {
    if (navHistoryIdx > 0) {
      navHistoryIdx--;
      navigateToPath(navHistory[navHistoryIdx], false);
    }
  }

  function goForward() {
    if (navHistoryIdx < navHistory.length - 1) {
      navHistoryIdx++;
      navigateToPath(navHistory[navHistoryIdx], false);
    }
  }

  function goUp() {
    if (st.path) {
      navigate(parentOf(st.path));
    }
  }

  function updateNavButtons() {
    const canBack = navHistoryIdx > 0;
    const canFwd  = navHistoryIdx < navHistory.length - 1;
    const canUp   = !!st.path;

    // Header nav buttons (the only nav buttons — in top bar)
    const hBack = $('hdr-nav-back');
    if (hBack) hBack.disabled = !canBack;
    const hFwd = $('hdr-nav-forward');
    if (hFwd) hFwd.disabled = !canFwd;
    const hUp = $('hdr-nav-up');
    if (hUp) hUp.disabled = !canUp;

    // Keep header arrows visible while browse is active
    const hGroup = $('hdr-nav-arrows');
    if (hGroup) hGroup.hidden = false;
  }

  function navigateToPath(path, addToHist = true) {
    // Folder navigation always happens in the "All Items" scope
    if (g('activeCategoryFilter') && typeof selectCategoryFilter === 'function') selectCategoryFilter(null);
    const all = $('filter-all');
    if (g('activeTypeFilter') !== 'all' && all) all.click();
    st.path = path || '';
    st.sel = null;
    const si = $('search-input');
    if (si && si.value) { si.value = ''; si.dispatchEvent(new Event('input', { bubbles: true })); }
    if (addToHist) pushHistory(st.path);
    render();
  }

  function navigate(path) {
    navigateToPath(path, true);
  }

  function invalidate() {
    if (typeof fetchWorkspaceData === 'function') return fetchWorkspaceData({ silent: true });
    render();
  }

  function setView(v) {
    st.view = v === 'list' ? 'list' : 'grid';
    localStorage.setItem('browseView', st.view);
    render();
  }

  // ----------------------------------------------------------------- events
  function bind() {
    if (st.bound) return;
    st.bound = true;

    // Header navigation arrows (the ONLY nav buttons — in top header bar)
    const hdrBack = $('hdr-nav-back');
    if (hdrBack) hdrBack.addEventListener('click', goBack);
    const hdrFwd = $('hdr-nav-forward');
    if (hdrFwd) hdrFwd.addEventListener('click', goForward);
    const hdrUp = $('hdr-nav-up');
    if (hdrUp) hdrUp.addEventListener('click', goUp);

    // Show the header arrows group immediately
    const hGroup = $('hdr-nav-arrows');
    if (hGroup) hGroup.hidden = false;

    // Keyboard navigation (Alt+Left for back, Alt+Right for forward)
    window.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
      else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goForward(); }
    });

    // Create / Add Folder button
    const btnCreateFolder = $('br-create-folder');
    if (btnCreateFolder) {
      btnCreateFolder.addEventListener('click', () => {
        if (window.FolderExplorer && typeof window.FolderExplorer.createFolderHere === 'function') {
          window.FolderExplorer.createFolderHere(st.path);
        } else if (typeof window.openCreateFolderModal === 'function') {
          window.openCreateFolderModal(st.path);
        } else {
          const name = prompt(st.path ? `New folder inside "${st.path}":` : 'New folder name:');
          if (name) {
            if (window.createFolder) window.createFolder(name, st.path);
            else if (typeof createFolder === 'function') createFolder(name, st.path);
          }
        }
      });
    }

    // Workspace switcher: reuse the existing <select> so all existing switching logic runs
    const btn = $('br-ws-btn'), menu = $('br-ws-menu');
    if (btn && menu) {
      const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
      btn.addEventListener('click', () => {
        const sel = $('workspace-select');
        menu.innerHTML = [...(sel ? sel.options : [])].map((o) => `<button type="button" role="menuitem" data-ws="${esc(o.value)}"${o.selected ? ' aria-current="true"' : ''}>${esc(o.textContent)}</button>`).join('');
        menu.hidden = !menu.hidden;
        btn.setAttribute('aria-expanded', String(!menu.hidden));
        if (!menu.hidden) { const f = menu.querySelector('button'); if (f) f.focus(); }
      });
      menu.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ws]');
        if (!b) return;
        const sel = $('workspace-select');
        if (sel && sel.value !== b.dataset.ws) { sel.value = b.dataset.ws; sel.dispatchEvent(new Event('change', { bubbles: true })); }
        close();
        btn.focus();
      });
      document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !e.target.closest('.br-ws')) close(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { close(); btn.focus(); } });
    }

    document.querySelector('.br-toggle').addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]');
      if (b) setView(b.dataset.view);
    });
    $('br-upload-files').addEventListener('click', () => FolderExplorer.uploadHere(st.path, 'files'));
    $('br-upload-folder').addEventListener('click', () => FolderExplorer.uploadHere(st.path, 'folder'));
    $('br-crumbs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-path]');
      if (b) navigate(b.dataset.path);
    });

    // Sidebar tree (if present)
    const tree = $('browse-tree');
    if (tree) {
      tree.addEventListener('click', (e) => {
        const tg = e.target.closest('[data-toggle]');
        if (tg) { const p = tg.dataset.toggle; if (st.open.has(p)) st.open.delete(p); else st.open.add(p); render(); return; }
        const row = e.target.closest('.br-trow');
        if (row) { if (row.dataset.path) st.open.add(row.dataset.path); navigate(row.dataset.path); }
      });
      tree.addEventListener('keydown', (e) => {
        const row = e.target.closest('.br-trow');
        if (!row) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(row.dataset.path); }
        else if (e.key === 'ArrowRight' && row.dataset.path) { st.open.add(row.dataset.path); render(); }
        else if (e.key === 'ArrowLeft' && row.dataset.path) { st.open.delete(row.dataset.path); render(); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const all = [...tree.querySelectorAll('ul:not([hidden]) > li > .br-trow, li > .br-trow')].filter((r) => r.offsetParent);
          const i = all.indexOf(row), n = all[i + (e.key === 'ArrowDown' ? 1 : -1)];
          if (n) n.focus();
        }
      });
      tree.addEventListener('contextmenu', (e) => {
        const row = e.target.closest('.br-trow');
        const f = row && st_folder(row.dataset.path);
        if (f) { e.preventDefault(); if (typeof openContextMenu === 'function') openContextMenu(e, f, 'folder'); }
      });
    }

    // Grid: folder tiles
    $('items-grid').addEventListener('click', (e) => {
      const t = e.target.closest('.br-folder');
      if (!t) return;
      if (e.target.closest('.br-fmore')) { e.stopPropagation(); ctxAt(e.target.closest('.br-fmore'), t._folder, 'folder'); return; }
      navigate(t.dataset.path);
    });
    $('items-grid').addEventListener('keydown', (e) => {
      const t = e.target.closest('.br-folder');
      if (t && e.target === t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); navigate(t.dataset.path); }
      else if (t && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) { e.preventDefault(); ctxAt(t, t._folder, 'folder'); }
    });
    $('items-grid').addEventListener('contextmenu', (e) => {
      const t = e.target.closest('.br-folder');
      if (t) { e.preventDefault(); e.stopPropagation(); if (typeof openContextMenu === 'function') openContextMenu(e, t._folder, 'folder'); }
    });

    // List
    const list = $('br-list');
    const rowOf = (el) => { const tr = el.closest('tr[data-key]'); return tr ? { tr, r: st.rows.get(tr.dataset.key) } : null; };
    const activate = (r) => { if (!r) return; if (r.kind === 'folder') navigate(r.ref.path); else openEntry(r.ref); };
    const ctx = (e, anchor, r) => {
      if (!r) return;
      const target = r.kind === 'folder' ? r.ref : r.ref.item;
      const type = r.kind === 'folder' ? 'folder' : r.ref.item.type;
      if (anchor) ctxAt(anchor, target, type); else openContextMenu(e, target, type);
    };
    list.addEventListener('click', (e) => {
      const h = e.target.closest('th[data-sort]');
      if (h) {
        const key = h.dataset.sort;
        st.sort = { key, dir: st.sort.key === key ? -st.sort.dir : 1 };
        render();
        return;
      }
      const hit = rowOf(e.target);
      if (!hit) return;
      if (e.target.closest('.br-rmore')) { e.stopPropagation(); ctx(e, e.target.closest('.br-rmore'), hit.r); return; }
      list.querySelectorAll('tr.is-selected').forEach((n) => n.classList.remove('is-selected'));
      hit.tr.classList.add('is-selected');
      st.sel = hit.tr.dataset.key;
    });
    list.addEventListener('dblclick', (e) => { const hit = rowOf(e.target); if (hit) activate(hit.r); });
    list.addEventListener('keydown', (e) => {
      const hit = rowOf(e.target);
      if (!hit || e.target !== hit.tr) return;
      if (e.key === 'Enter') { e.preventDefault(); activate(hit.r); }
      else if (e.key === ' ') { e.preventDefault(); hit.tr.click(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = e.key === 'ArrowDown' ? hit.tr.nextElementSibling : hit.tr.previousElementSibling;
        if (n && n.dataset.key) n.focus();
      } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); ctx(e, hit.tr, hit.r); }
    });
    list.addEventListener('contextmenu', (e) => {
      const hit = rowOf(e.target);
      if (hit) { e.preventDefault(); e.stopPropagation(); ctx(e, null, hit.r); }
    });
  }

  function st_folder(path) {
    if (!path) return null;
    const rows = buildModel().folders;
    return rows.get(path) || null;
  }

  window.Browse = {
    handles,
    render,
    hide,
    navigate,
    invalidate,
    getPath: () => st.path,
    resetPathIfDeleted(deletedPath) {
      if (st.path === deletedPath || st.path.startsWith(deletedPath + '/')) {
        navigateToPath(parentOf(deletedPath), false);
      }
    }
  };

  const ready = () => { try { if (g('dbData') && handles()) render(); } catch (e) { /* app not ready yet */ } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true }); else ready();
})();
