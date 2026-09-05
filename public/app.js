// Workspace Application Logic
let dbData = { categories: [], items: [] };
let activeTypeFilter = 'all'; // 'all', 'link', 'file', 'note'
let activeCategoryFilter = null; // null means all categories
let searchQuery = '';
let workspaceFolders = [];

// Workspace Management State
let workspaces = [];
let activeWorkspaceId = 'default';

// DOM Elements - Workspaces
const workspaceSelect = document.getElementById('workspace-select');
const btnAddWorkspace = document.getElementById('btn-add-workspace');
const btnDeleteWorkspace = document.getElementById('btn-delete-workspace');
const modalAddWorkspace = document.getElementById('modal-add-workspace');
const btnCloseWsModal = document.getElementById('btn-close-ws-modal');
const formAddWorkspace = document.getElementById('form-add-workspace');

// DOM Elements - General UI
const itemsGrid = document.getElementById('items-grid');
const emptyState = document.getElementById('empty-state');
const searchInput = document.getElementById('search-input');
const categoriesList = document.getElementById('categories-list');
const filterStatusBar = document.getElementById('filter-status-bar');
const activeCategoryLabel = document.getElementById('active-category-label');
const btnClearCategoryFilter = document.getElementById('btn-clear-category-filter');

// Modals
const modalAddItem = document.getElementById('modal-add-item');
const modalAddCategory = document.getElementById('modal-add-category');

// Buttons to open modals
const btnNewItem = document.getElementById('btn-new-item');
const btnEmptyAdd = document.getElementById('btn-empty-add');
const btnAddCategory = document.getElementById('btn-add-category');

// Buttons to close modals
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCloseCatModal = document.getElementById('btn-close-cat-modal');

// Sidebar filters
const filterAll = document.getElementById('filter-all');
const filterLinks = document.getElementById('filter-links');
const filterFiles = document.getElementById('filter-files');
const filterNotes = document.getElementById('filter-notes');

// Stats Elements
const countAll = document.getElementById('count-all');
const countLinks = document.getElementById('count-links');
const countFiles = document.getElementById('count-files');
const countNotes = document.getElementById('count-notes');
const statFilesCount = document.getElementById('stat-files-count');
const statFilesSize = document.getElementById('stat-files-size');

// Forms & Tab switching
const modalTabs = document.querySelectorAll('.tab-btn');
const modalForms = document.querySelectorAll('.modal-form-tab');
const formAddLink = document.getElementById('form-add-link');
const formUploadFile = document.getElementById('form-upload-file');
const formAddNote = document.getElementById('form-add-note');
const formAddCategory = document.getElementById('form-add-category');

// File Upload Specifics
const fileDropzone = document.getElementById('file-dropzone');
const fileInput = document.getElementById('file-input');
const selectedFileInfo = document.getElementById('selected-file-info');
const fileNameLabel = document.getElementById('file-name-label');
const btnRemoveFile = document.getElementById('btn-remove-file');
const uploadProgressContainer = document.getElementById('upload-progress-container');
const uploadProgressFill = document.getElementById('upload-progress-fill');
const uploadProgressText = document.getElementById('upload-progress-text');
const btnSubmitUpload = document.getElementById('btn-submit-upload');

// Helper for safely executing lucide.createIcons
function safeCreateIcons() {
  if (typeof lucide !== 'undefined' && lucide && typeof lucide.createIcons === 'function') {
    try {
      lucide.createIcons();
    } catch (e) {
      console.warn('lucide.createIcons error:', e);
    }
  }
}

// Helper for DOM readiness that works reliably even if DOMContentLoaded already fired
function onReady(fn) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn);
  } else {
    // DOM is already ready
    fn();
  }
}

// Load data on page load
onReady(() => {
  safeCreateIcons();
  initWorkspaceHub();
  setupEventListeners();
});

// Initialize workspace listing and then load active data
async function initWorkspaceHub() {
  await fetchWorkspaces();
  await fetchWorkspaceData();
}

// Fetch list of workspaces
async function fetchWorkspaces() {
  try {
    const response = await fetch('/api/workspaces');
    if (!response.ok) throw new Error('Failed to load workspaces');
    
    const data = await response.json();
    workspaces = data.workspaces;
    activeWorkspaceId = data.activeWorkspace;
    
    renderWorkspacesDropdown();
  } catch (error) {
    console.error('Error fetching workspaces:', error);
    alert('Error loading workspace registry. Make sure server.js is running!');
  }
}

// Populates and sets active workspace selector
function renderWorkspacesDropdown() {
  workspaceSelect.innerHTML = '';
  
  workspaces.forEach(ws => {
    const option = document.createElement('option');
    option.value = ws.id;
    option.textContent = ws.name;
    if (ws.id === activeWorkspaceId) {
      option.selected = true;
    }
    workspaceSelect.appendChild(option);
  });
  
  // Show delete button only if it's not the default workspace
  if (activeWorkspaceId === 'default') {
    btnDeleteWorkspace.style.display = 'none';
  } else {
    btnDeleteWorkspace.style.display = 'inline-flex';
  }
}

// Fetch all items and root folders for active workspace
async function fetchWorkspaceData() {
  try {
    const [dataRes, foldersRes] = await Promise.all([
      fetch(`/api/workspaces/${activeWorkspaceId}/data`),
      fetch(`/api/workspaces/${activeWorkspaceId}/folders`).catch(() => null)
    ]);
    if (!dataRes.ok) throw new Error('Failed to fetch workspace items');
    
    dbData = await dataRes.json();
    
    if (foldersRes && foldersRes.ok) {
      const folderTree = await foldersRes.json();
      workspaceFolders = folderTree.folders || [];
    } else {
      workspaceFolders = [];
    }
    
    populateCategoriesDropdowns();
    resetFilters();
    updateUI();
  } catch (error) {
    console.error(`Error loading data for workspace ${activeWorkspaceId}:`, error);
  }
}

// Resets filters when switching workspaces
function resetFilters() {
  activeCategoryFilter = null;
  filterStatusBar.style.display = 'none';
  searchQuery = '';
  searchInput.value = '';
  
  // Reset type filter to all
  activeTypeFilter = 'all';
  [filterAll, filterLinks, filterFiles, filterNotes].forEach(el => el.classList.remove('active'));
  filterAll.classList.add('active');
}

// Set up UI component updates
function updateUI() {
  renderSidebarCategories();
  renderGridItems();
  updateStats();
  lucide.createIcons();
}

// Generate category options for form selects
function populateCategoriesDropdowns() {
  const dropdowns = document.querySelectorAll('.select-category');
  dropdowns.forEach(dropdown => {
    dropdown.innerHTML = '';
    dbData.categories.forEach(cat => {
      const option = document.createElement('option');
      option.value = cat;
      option.textContent = cat;
      if (cat === 'General') option.selected = true;
      dropdown.appendChild(option);
    });
  });
}

// Render dynamic category list in Sidebar
function renderSidebarCategories() {
  categoriesList.innerHTML = '';
  
  dbData.categories.forEach(cat => {
    // Count items in this category
    const count = dbData.items.filter(item => item.category === cat).length;
    
    const li = document.createElement('li');
    if (activeCategoryFilter === cat) {
      li.className = 'active';
    }
    
    li.innerHTML = `
      <i data-lucide="folder"></i>
      <span>${escapeHTML(cat)}</span>
      <span class="badge">${count}</span>
    `;
    
    li.addEventListener('click', () => {
      selectCategoryFilter(cat);
    });
    
    categoriesList.appendChild(li);
  });
}

// Render workspace cards
function renderGridItems() {
  itemsGrid.innerHTML = '';
  
  // Filter items
  let filteredItems = dbData.items;

  // Filter 1: Type
  if (activeTypeFilter !== 'all') {
    filteredItems = filteredItems.filter(item => item.type === activeTypeFilter);
  }

  // Filter 2: Category
  if (activeCategoryFilter) {
    filteredItems = filteredItems.filter(item => item.category === activeCategoryFilter);
  }

  // Filter 3: Search text
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filteredItems = filteredItems.filter(item => {
      const titleMatch = item.title && item.title.toLowerCase().includes(q);
      const descMatch = item.description && item.description.toLowerCase().includes(q);
      const categoryMatch = item.category && item.category.toLowerCase().includes(q);
      
      let typeSpecificMatch = false;
      if (item.type === 'link') {
        typeSpecificMatch = item.url && item.url.toLowerCase().includes(q);
      } else if (item.type === 'note') {
        typeSpecificMatch = item.content && item.content.toLowerCase().includes(q);
      } else if (item.type === 'file') {
        typeSpecificMatch = item.fileName && item.fileName.toLowerCase().includes(q);
      }
      
      return titleMatch || descMatch || categoryMatch || typeSpecificMatch;
    });
  }

  // Sort items: Newest first
  filteredItems.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Root folders in All Items (when not filtered by category)
  let filteredFolders = [];
  if (activeTypeFilter === 'all' && !activeCategoryFilter) {
    filteredFolders = workspaceFolders;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filteredFolders = filteredFolders.filter(f => f.name && f.name.toLowerCase().includes(q));
    }
  }

  // Toggle Empty State
  if (filteredItems.length === 0 && filteredFolders.length === 0) {
    itemsGrid.style.display = 'none';
    emptyState.style.display = 'flex';
  } else {
    itemsGrid.style.display = 'grid';
    emptyState.style.display = 'none';
    
    // Render Root Folder cards
    filteredFolders.forEach(folder => {
      const folderCard = createFolderCardElement(folder);
      itemsGrid.appendChild(folderCard);
    });

    // Render regular item cards
    filteredItems.forEach(item => {
      const card = createCardElement(item);
      itemsGrid.appendChild(card);
    });
  }
}

// Generate DOM element for a Root Folder (Small & Minimalist)
function createFolderCardElement(folder) {
  const el = document.createElement('div');
  el.className = 'mini-item mini-item-folder';
  el.setAttribute('tabindex', '0');
  el.setAttribute('role', 'button');

  const filesCount = (folder.files || []).length;
  const subfoldersCount = (folder.folders || []).length;
  const totalItems = filesCount + subfoldersCount;
  const isEmpty = totalItems === 0;

  el.innerHTML = `
    <div class="mini-item-left">
      <i data-lucide="folder" class="mini-icon mini-icon-folder"></i>
      <span class="mini-title" title="${escapeHTML(folder.name)}">${escapeHTML(folder.name)}</span>
    </div>
    <div class="mini-item-right">
      <span class="mini-status ${isEmpty ? 'is-empty' : 'is-populated'}" title="${isEmpty ? 'Empty folder' : `${totalItems} item${totalItems !== 1 ? 's' : ''} (${filesCount} file${filesCount !== 1 ? 's' : ''})`}">
        <span class="status-dot"></span>
        ${!isEmpty ? `<span class="status-count">${totalItems}</span>` : ''}
      </span>
    </div>
  `;

  // Direct click -> open folder in explorer
  el.addEventListener('click', () => {
    const filterFolders = document.getElementById('filter-folders');
    if (filterFolders) filterFolders.click();
    setTimeout(() => {
      FolderExplorer.navigateTo(folder.path);
    }, 50);
  });

  // Right-click on item / icon -> show context menu / info / history
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e, folder, 'folder');
  });

  return el;
}

// Generate DOM element for an item (Small & Minimalist)
function createCardElement(item) {
  const el = document.createElement('div');
  el.className = `mini-item mini-item-${item.type}`;
  el.setAttribute('tabindex', '0');
  el.setAttribute('role', 'button');

  let iconHTML = '';
  let metaHTML = '';
  let titleText = item.title || '';

  if (item.type === 'link') {
    iconHTML = `<i data-lucide="link-2" class="mini-icon mini-icon-link"></i>`;
    metaHTML = `<i data-lucide="arrow-up-right" class="mini-subtle-arrow"></i>`;
  } else if (item.type === 'file') {
    titleText = item.title || item.fileName || 'Untitled File';
    const ext = (item.fileName || '').split('.').pop().toLowerCase();
    const isPdf = ext === 'pdf';
    const isImg = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);
    const isCode = ['js', 'ts', 'html', 'css', 'json', 'py', 'java', 'c', 'cpp'].includes(ext);
    const isDoc = ['doc', 'docx', 'txt', 'md'].includes(ext);
    const iconName = isPdf ? 'file-text' : isImg ? 'image' : isCode ? 'file-code' : isDoc ? 'file-text' : 'file';
    const typeColorClass = isPdf ? 'pdf' : isImg ? 'img' : isCode ? 'code' : isDoc ? 'doc' : 'generic';

    iconHTML = `<i data-lucide="${iconName}" class="mini-icon mini-icon-file file-${typeColorClass}"></i>`;
    metaHTML = `<span class="mini-meta-badge">${ext ? ext.toUpperCase() : 'FILE'}</span>`;
  } else if (item.type === 'note') {
    iconHTML = `<i data-lucide="sticky-note" class="mini-icon mini-icon-note"></i>`;
    metaHTML = `<span class="mini-meta-badge">NOTE</span>`;
  }

  el.innerHTML = `
    <div class="mini-item-left">
      ${iconHTML}
      <span class="mini-title" title="${escapeHTML(titleText)}">${escapeHTML(titleText)}</span>
    </div>
    <div class="mini-item-right">
      ${metaHTML}
    </div>
  `;

  // Direct touch/click:
  el.addEventListener('click', () => {
    if (item.type === 'link') {
      window.open(item.url, '_blank', 'noopener,noreferrer');
    } else if (item.type === 'file') {
      window.open(item.filePath, '_blank');
    } else if (item.type === 'note') {
      openNotePreview(item);
    }
  });

  // Right-click on item / icon -> show context menu / info / history
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e, item, item.type);
  });

  return el;
}

// Delete item helper
async function deleteItem(itemId) {
  if (!confirm('Are you sure you want to delete this resource? This action cannot be undone.')) {
    return;
  }

  try {
    const response = await fetch(`/api/workspaces/${activeWorkspaceId}/items/${itemId}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Delete failed');
    
    // Update local copy and render
    dbData.items = dbData.items.filter(item => item.id !== itemId);
    updateUI();
  } catch (error) {
    console.error('Error deleting item:', error);
    alert('Failed to delete item.');
  }
}

// ================================================================
// CONTEXT MENU & DETAILS MODAL LOGIC
// ================================================================
let activeContextTarget = null;
let activeContextType = null;

const contextMenu = document.getElementById('custom-context-menu');
const ctxHeader = document.getElementById('ctx-header');
const ctxIcon = document.getElementById('ctx-icon');
const ctxTitle = document.getElementById('ctx-title');
const ctxOptDetails = document.getElementById('ctx-opt-details');
const ctxOptOpen = document.getElementById('ctx-opt-open');
const ctxOptDownload = document.getElementById('ctx-opt-download');
const ctxOptCopy = document.getElementById('ctx-opt-copy');
const ctxOptMove = document.getElementById('ctx-opt-move');
const ctxOptRename = document.getElementById('ctx-opt-rename');
const ctxOptDelete = document.getElementById('ctx-opt-delete');

// Details Modal
const modalItemDetails = document.getElementById('modal-item-details');
const btnCloseDetailsModal = document.getElementById('btn-close-details-modal');
const btnDetailsClose = document.getElementById('btn-details-close');
const btnDetailsOpen = document.getElementById('btn-details-open');
const detailsContent = document.getElementById('details-content');
const detailModalTitle = document.getElementById('detail-modal-title');
const detailHeaderIcon = document.getElementById('detail-header-icon');

// Note Preview Modal
const modalNotePreview = document.getElementById('modal-note-preview');
const btnCloseNotePreview = document.getElementById('btn-close-note-preview');
const btnNotePreviewClose = document.getElementById('btn-note-preview-close');
const btnNoteCopy = document.getElementById('btn-note-copy');
const notePreviewTitle = document.getElementById('note-preview-title');
const notePreviewMeta = document.getElementById('note-preview-meta');
const notePreviewBody = document.getElementById('note-preview-body');
let activePreviewNote = null;

function hideContextMenu() {
  if (contextMenu) {
    contextMenu.style.display = 'none';
  }
}

function openContextMenu(e, target, type) {
  activeContextTarget = target;
  activeContextType = type;

  const targetTitle = type === 'folder' 
    ? target.name 
    : (target.title || target.fileName || 'Item');

  ctxTitle.textContent = targetTitle;
  
  if (type === 'folder') {
    ctxIcon.setAttribute('data-lucide', 'folder');
    ctxOptDownload.style.display = 'none';
    ctxOptMove.style.display = 'none';
    ctxOptRename.style.display = 'flex';
    ctxOptCopy.style.display = 'flex';
    ctxOptCopy.querySelector('span').textContent = 'Copy Folder Path';
  } else if (type === 'file') {
    ctxIcon.setAttribute('data-lucide', 'file-text');
    ctxOptDownload.style.display = 'flex';
    ctxOptMove.style.display = 'none';
    ctxOptRename.style.display = 'none';
    ctxOptCopy.style.display = 'flex';
    ctxOptCopy.querySelector('span').textContent = 'Copy File Link';
  } else if (type === 'link') {
    ctxIcon.setAttribute('data-lucide', 'link-2');
    ctxOptDownload.style.display = 'none';
    ctxOptMove.style.display = 'none';
    ctxOptRename.style.display = 'none';
    ctxOptCopy.style.display = 'flex';
    ctxOptCopy.querySelector('span').textContent = 'Copy Web URL';
  } else if (type === 'note') {
    ctxIcon.setAttribute('data-lucide', 'sticky-note');
    ctxOptDownload.style.display = 'none';
    ctxOptMove.style.display = 'none';
    ctxOptRename.style.display = 'none';
    ctxOptCopy.style.display = 'flex';
    ctxOptCopy.querySelector('span').textContent = 'Copy Note Content';
  }

  // Calculate position with viewport boundary checking
  contextMenu.style.display = 'block';
  contextMenu.style.visibility = 'hidden';
  safeCreateIcons();

  const menuWidth = contextMenu.offsetWidth || 210;
  const menuHeight = contextMenu.offsetHeight || 220;
  let posX = e.clientX;
  let posY = e.clientY;

  if (posX + menuWidth > window.innerWidth) {
    posX = window.innerWidth - menuWidth - 10;
  }
  if (posY + menuHeight > window.innerHeight) {
    posY = window.innerHeight - menuHeight - 10;
  }
  if (posX < 10) posX = 10;
  if (posY < 10) posY = 10;

  contextMenu.style.left = posX + 'px';
  contextMenu.style.top = posY + 'px';
  contextMenu.style.visibility = 'visible';
}

// Toast Notification Helper
function showToast(message, iconName = 'check') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <i data-lucide="${iconName}"></i>
    <span>${escapeHTML(message)}</span>
  `;
  container.appendChild(toast);
  safeCreateIcons();

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px) scale(0.95)';
    setTimeout(() => toast.remove(), 260);
  }, 2200);
}

// Wire context menu options & details modal events
function setupContextMenuEvents() {
  document.addEventListener('click', (e) => {
    if (contextMenu && !contextMenu.contains(e.target)) {
      hideContextMenu();
    }
  });

  window.addEventListener('scroll', hideContextMenu, true);
  window.addEventListener('resize', hideContextMenu);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideContextMenu();
      if (modalItemDetails) modalItemDetails.classList.remove('active');
      if (modalNotePreview) modalNotePreview.classList.remove('active');
    }
  });

  // Details option
  ctxOptDetails.addEventListener('click', () => {
    hideContextMenu();
    if (activeContextTarget) {
      openDetailsModal(activeContextTarget, activeContextType);
    }
  });

  // Open option
  ctxOptOpen.addEventListener('click', () => {
    hideContextMenu();
    if (!activeContextTarget) return;
    if (activeContextType === 'folder') {
      const filterFolders = document.getElementById('filter-folders');
      if (filterFolders) filterFolders.click();
      setTimeout(() => FolderExplorer.navigateTo(activeContextTarget.path), 50);
    } else if (activeContextType === 'link') {
      window.open(activeContextTarget.url, '_blank', 'noopener,noreferrer');
    } else if (activeContextType === 'file') {
      const fileUrl = activeContextTarget.filePath || `/uploads/${activeWorkspaceId}/${activeContextTarget.path}`;
      window.open(fileUrl, '_blank');
    } else if (activeContextType === 'note') {
      openNotePreview(activeContextTarget);
    }
  });

  // Download option
  ctxOptDownload.addEventListener('click', () => {
    hideContextMenu();
    if (activeContextTarget && activeContextType === 'file') {
      const a = document.createElement('a');
      const fileUrl = activeContextTarget.filePath || `/uploads/${activeWorkspaceId}/${activeContextTarget.path}`;
      const fileName = activeContextTarget.fileName || activeContextTarget.name || 'download';
      a.href = fileUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast(`Downloading ${fileName}...`, 'download');
    }
  });

  // Copy option
  ctxOptCopy.addEventListener('click', async () => {
    hideContextMenu();
    if (!activeContextTarget) return;
    let textToCopy = '';
    let toastLabel = 'Copied to clipboard!';
    if (activeContextType === 'folder') {
      textToCopy = activeContextTarget.path || activeContextTarget.name;
      toastLabel = 'Folder path copied!';
    } else if (activeContextType === 'link') {
      textToCopy = activeContextTarget.url;
      toastLabel = 'URL copied to clipboard!';
    } else if (activeContextType === 'file') {
      const fileUrl = activeContextTarget.filePath || `/uploads/${activeWorkspaceId}/${activeContextTarget.path}`;
      textToCopy = window.location.origin + fileUrl;
      toastLabel = 'File link copied!';
    } else if (activeContextType === 'note') {
      textToCopy = activeContextTarget.content;
      toastLabel = 'Note text copied!';
    }
    if (textToCopy) {
      try {
        await navigator.clipboard.writeText(textToCopy);
        showToast(toastLabel);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = textToCopy;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        showToast(toastLabel);
      }
    }
  });

  // Move option
  ctxOptMove.addEventListener('click', () => {
    hideContextMenu();
    if (activeContextTarget && activeContextType === 'file' && activeContextTarget.path) {
      FolderExplorer.openMoveFileModal(activeContextTarget);
    }
  });

  // Delete option
  ctxOptDelete.addEventListener('click', async () => {
    hideContextMenu();
    if (!activeContextTarget) return;
    if (activeContextType === 'folder') {
      await FolderExplorer.deleteFolder(activeContextTarget);
    } else if (activeContextTarget.id) {
      await deleteItem(activeContextTarget.id);
    } else if (activeContextTarget.path) {
      await FolderExplorer.deleteFile(activeContextTarget);
    }
  });

  // Rename option
  ctxOptRename.addEventListener('click', () => {
    hideContextMenu();
    if (activeContextTarget) {
      if (activeContextType === 'folder') {
        FolderExplorer.openRenameFolder(activeContextTarget);
      } else if (activeContextType === 'file' && activeContextTarget.path) {
        FolderExplorer.openRenameFile(activeContextTarget);
      }
    }
  });

  // Modal close wiring
  if (btnCloseDetailsModal) {
    btnCloseDetailsModal.addEventListener('click', () => modalItemDetails.classList.remove('active'));
  }
  if (btnDetailsClose) {
    btnDetailsClose.addEventListener('click', () => modalItemDetails.classList.remove('active'));
  }
  if (modalItemDetails) {
    modalItemDetails.addEventListener('click', (e) => {
      if (e.target === modalItemDetails) modalItemDetails.classList.remove('active');
    });
  }

  // Note preview close wiring
  if (btnCloseNotePreview) {
    btnCloseNotePreview.addEventListener('click', () => modalNotePreview.classList.remove('active'));
  }
  if (btnNotePreviewClose) {
    btnNotePreviewClose.addEventListener('click', () => modalNotePreview.classList.remove('active'));
  }
  if (modalNotePreview) {
    modalNotePreview.addEventListener('click', (e) => {
      if (e.target === modalNotePreview) modalNotePreview.classList.remove('active');
    });
  }
  if (btnNoteCopy) {
    btnNoteCopy.addEventListener('click', async () => {
      if (activePreviewNote && activePreviewNote.content) {
        try {
          await navigator.clipboard.writeText(activePreviewNote.content);
          btnNoteCopy.innerHTML = `<i data-lucide="check"></i> Copied!`;
          safeCreateIcons();
          setTimeout(() => {
            btnNoteCopy.innerHTML = `<i data-lucide="copy"></i> Copy Content`;
            safeCreateIcons();
          }, 1500);
        } catch {
          alert('Copied to clipboard');
        }
      }
    });
  }
}

// Open Details & History Modal
function openDetailsModal(target, type) {
  if (!target) return;
  activeContextTarget = target;
  activeContextType = type;

  let html = '';
  if (type === 'folder') {
    detailModalTitle.textContent = 'Folder Details & History';
    detailHeaderIcon.setAttribute('data-lucide', 'folder');
    detailHeaderIcon.style.color = '#f59e0b';

    const filesCount = (target.files || []).length;
    const subfoldersCount = (target.folders || []).length;
    const totalCount = filesCount + subfoldersCount;

    html = `
      <div class="detail-row">
        <span class="detail-label">Name</span>
        <div class="detail-value" style="font-weight:600;">${escapeHTML(target.name)}</div>
      </div>
      <div class="detail-row">
        <span class="detail-label">Type</span>
        <div class="detail-value">Directory Folder</div>
      </div>
      <div class="detail-row">
        <span class="detail-label">Status</span>
        <div class="detail-value">${totalCount === 0 ? 'Empty (0 items)' : `${totalCount} item(s) — ${filesCount} file(s), ${subfoldersCount} subfolder(s)`}</div>
      </div>
      <div class="detail-row">
        <span class="detail-label">Location Path</span>
        <div class="detail-value">Root / ${escapeHTML(target.path || target.name)}</div>
      </div>
    `;
  } else {
    detailModalTitle.textContent = `${capitalize(type)} Details & History`;
    const iconName = type === 'link' ? 'link-2' : type === 'file' ? 'file-text' : 'sticky-note';
    const iconColor = type === 'link' ? '#38bdf8' : type === 'file' ? '#f87171' : '#34d399';
    detailHeaderIcon.setAttribute('data-lucide', iconName);
    detailHeaderIcon.style.color = iconColor;

    const dateFormatted = formatDateFull(target.createdAt);

    html = `
      <div class="detail-row">
        <span class="detail-label">Title</span>
        <div class="detail-value" style="font-weight:600;">${escapeHTML(target.title || target.fileName || 'Untitled')}</div>
      </div>
      <div class="detail-row">
        <span class="detail-label">Type & Category</span>
        <div class="detail-value" style="display:flex; gap:8px; align-items:center;">
          <span class="mini-meta-badge" style="text-transform:uppercase;">${type}</span>
          <span style="color:var(--text-muted); font-size:0.85rem;">Category:</span>
          <strong>${escapeHTML(target.category || 'General')}</strong>
        </div>
      </div>
      <div class="detail-row">
        <span class="detail-label">Created At (History)</span>
        <div class="detail-value">${dateFormatted}</div>
      </div>
    `;

    if (target.description) {
      html += `
        <div class="detail-row">
          <span class="detail-label">Description</span>
          <div class="detail-value">${escapeHTML(target.description)}</div>
        </div>
      `;
    }

    if (type === 'link') {
      html += `
        <div class="detail-row">
          <span class="detail-label">Destination URL</span>
          <div class="detail-value">
            <a href="${target.url}" target="_blank" rel="noopener noreferrer" style="color:#818cf8; word-break:break-all;">${escapeHTML(target.url)}</a>
          </div>
        </div>
      `;
    } else if (type === 'file') {
      html += `
        <div class="detail-row">
          <span class="detail-label">File Name & Size</span>
          <div class="detail-value">${escapeHTML(target.fileName)} (${formatBytes(target.fileSize)})</div>
        </div>
      `;
    } else if (type === 'note') {
      html += `
        <div class="detail-row">
          <span class="detail-label">Note Preview</span>
          <div class="detail-value" style="white-space:pre-wrap; max-height:150px; overflow-y:auto;">${escapeHTML(target.content)}</div>
        </div>
      `;
    }
  }

  detailsContent.innerHTML = html;
  btnDetailsOpen.onclick = () => {
    modalItemDetails.classList.remove('active');
    ctxOptOpen.click();
  };

  modalItemDetails.classList.add('active');
  safeCreateIcons();
}

function openNotePreview(noteItem) {
  activePreviewNote = noteItem;
  notePreviewTitle.textContent = noteItem.title || 'Note Preview';
  notePreviewMeta.innerHTML = `
    <span class="mini-meta-badge">Note</span>
    <span>Category: <strong>${escapeHTML(noteItem.category || 'General')}</strong></span>
    <span>•</span>
    <span>${formatDateFull(noteItem.createdAt)}</span>
  `;
  notePreviewBody.textContent = noteItem.content || '';
  modalNotePreview.classList.add('active');
  safeCreateIcons();
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatDateFull(isoString) {
  if (!isoString) return 'Unknown';
  const d = new Date(isoString);
  return d.toLocaleString(undefined, { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Calculate counts & size stats
function updateStats() {
  const items = dbData.items;
  const foldersCount = workspaceFolders ? workspaceFolders.length : 0;
  
  const totalCount = items.length + foldersCount;
  const linkCount = items.filter(item => item.type === 'link').length;
  const fileCount = items.filter(item => item.type === 'file').length;
  const noteCount = items.filter(item => item.type === 'note').length;

  countAll.textContent = totalCount;
  countLinks.textContent = linkCount;
  countFiles.textContent = fileCount;
  countNotes.textContent = noteCount;

  const countFolders = document.getElementById('count-folders');
  if (countFolders) {
    countFolders.textContent = foldersCount;
  }

  // File specific stats
  const uploadedFiles = items.filter(item => item.type === 'file');
  const totalSize = uploadedFiles.reduce((acc, curr) => acc + (curr.fileSize || 0), 0);

  statFilesCount.textContent = uploadedFiles.length;
  statFilesSize.textContent = formatBytes(totalSize);
}

// Category filter trigger
function selectCategoryFilter(catName) {
  activeCategoryFilter = catName;
  if (catName === null) {
    filterStatusBar.style.display = 'none';
  } else {
    activeCategoryLabel.textContent = catName;
    filterStatusBar.style.display = 'flex';
  }
  updateUI();
}

// Type filter trigger
function selectTypeFilter(element, typeName) {
  // Reset active classes
  [filterAll, filterLinks, filterFiles, filterNotes].forEach(el => el.classList.remove('active'));
  element.classList.add('active');
  
  activeTypeFilter = typeName;
  renderGridItems();
  lucide.createIcons();
}

// Reset dropzone files
function resetFileDropzone() {
  fileInput.value = '';
  selectedFileInfo.style.display = 'none';
  fileDropzone.style.display = 'flex';
  uploadProgressContainer.style.display = 'none';
  uploadProgressFill.style.width = '0%';
  btnSubmitUpload.disabled = false;
}

// Setup Event Listeners
function setupEventListeners() {
  setupContextMenuEvents();

  // WORKSPACE EVENT LISTENERS
  
  // Workspace select switch
  workspaceSelect.addEventListener('change', async (e) => {
    const wsId = e.target.value;
    try {
      const response = await fetch('/api/workspaces/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: wsId })
      });
      if (!response.ok) throw new Error('Failed to set active workspace');
      
      activeWorkspaceId = wsId;
      if (activeWorkspaceId === 'default') {
        btnDeleteWorkspace.style.display = 'none';
      } else {
        btnDeleteWorkspace.style.display = 'inline-flex';
      }
      
      await fetchWorkspaceData();
    } catch (err) {
      console.error(err);
      alert('Error switching workspaces');
    }
  });

  // Open Workspace Modal
  btnAddWorkspace.addEventListener('click', () => {
    modalAddWorkspace.classList.add('active');
    document.getElementById('workspace-name').value = '';
  });

  // Close Workspace Modal
  btnCloseWsModal.addEventListener('click', () => {
    modalAddWorkspace.classList.remove('active');
  });

  modalAddWorkspace.addEventListener('click', (e) => {
    if (e.target === modalAddWorkspace) modalAddWorkspace.classList.remove('active');
  });

  // Create Workspace Form Submit
  formAddWorkspace.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('workspace-name').value;
    
    try {
      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create workspace');
      }

      const data = await response.json();
      modalAddWorkspace.classList.remove('active');
      formAddWorkspace.reset();
      
      // Update state and load registry
      await fetchWorkspaces();
      await fetchWorkspaceData();
    } catch (error) {
      console.error(error);
      alert(error.message || 'Error creating workspace');
    }
  });

  // Delete Active Workspace
  btnDeleteWorkspace.addEventListener('click', async () => {
    if (activeWorkspaceId === 'default') {
      return alert('Cannot delete the default workspace');
    }

    const wsName = workspaceSelect.options[workspaceSelect.selectedIndex].text;
    if (!confirm(`CAUTION: Are you sure you want to delete the workspace "${wsName}"?\n\nThis will permanently delete ALL links, notes, and uploaded PDF files inside it. This cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/workspaces/${activeWorkspaceId}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Failed to delete workspace');
      
      await fetchWorkspaces();
      await fetchWorkspaceData();
    } catch (error) {
      console.error(error);
      alert('Error deleting workspace');
    }
  });

  // --- GENERAL ITEM EVENT LISTENERS ---

  // Search input change
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderGridItems();
    lucide.createIcons();
  });

  // Type filters in sidebar
  filterAll.addEventListener('click', () => selectTypeFilter(filterAll, 'all'));
  filterLinks.addEventListener('click', () => selectTypeFilter(filterLinks, 'link'));
  filterFiles.addEventListener('click', () => selectTypeFilter(filterFiles, 'file'));
  filterNotes.addEventListener('click', () => selectTypeFilter(filterNotes, 'note'));

  // Clear category filter bar button
  btnClearCategoryFilter.addEventListener('click', () => {
    selectCategoryFilter(null);
  });

  // Modal display toggles
  btnNewItem.addEventListener('click', () => {
    modalAddItem.classList.add('active');
    resetFileDropzone();
  });
  
  btnEmptyAdd.addEventListener('click', () => {
    modalAddItem.classList.add('active');
    resetFileDropzone();
  });
  
  btnCloseModal.addEventListener('click', () => {
    modalAddItem.classList.remove('active');
  });

  // Close modals on clicking backdrop
  modalAddItem.addEventListener('click', (e) => {
    if (e.target === modalAddItem) modalAddItem.classList.remove('active');
  });

  modalAddCategory.addEventListener('click', (e) => {
    if (e.target === modalAddCategory) modalAddCategory.classList.remove('active');
  });

  // Category addition dialog triggers
  btnAddCategory.addEventListener('click', () => {
    modalAddCategory.classList.add('active');
    document.getElementById('category-name').value = '';
  });
  
  btnCloseCatModal.addEventListener('click', () => {
    modalAddCategory.classList.remove('active');
  });

  // Modal Tab switching
  modalTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      modalTabs.forEach(t => t.classList.remove('active'));
      modalForms.forEach(form => form.classList.remove('active'));
      
      tab.classList.add('active');
      const targetTabId = tab.dataset.tab;
      document.getElementById(targetTabId).classList.add('active');
    });
  });

  // File selection triggers
  fileDropzone.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (fileInput.files.length > 0) {
      handleFilesSelected(fileInput.files);
    }
  });

  // Drag and Drop files
  ['dragenter', 'dragover'].forEach(eventName => {
    fileDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      fileDropzone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    fileDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      fileDropzone.classList.remove('dragover');
    }, false);
  });

  fileDropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      fileInput.files = files;
      handleFilesSelected(files);
    }
  });

  btnRemoveFile.addEventListener('click', () => {
    resetFileDropzone();
  });

  // SUBMIT FORM: Add Link
  formAddLink.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('link-title').value;
    const url = document.getElementById('link-url').value;
    const description = document.getElementById('link-desc').value;
    const category = document.getElementById('link-category').value;

    try {
      const response = await fetch(`/api/workspaces/${activeWorkspaceId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'link', title, url, description, category })
      });

      if (!response.ok) throw new Error('Failed to save link');
      const newItem = await response.json();
      
      dbData.items.push(newItem);
      modalAddItem.classList.remove('active');
      formAddLink.reset();
      updateUI();
    } catch (error) {
      console.error(error);
      alert('Error saving bookmark link');
    }
  });

  // SUBMIT FORM: Add Note
  formAddNote.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('note-title').value;
    const content = document.getElementById('note-content').value;
    const category = document.getElementById('note-category').value;

    try {
      const response = await fetch(`/api/workspaces/${activeWorkspaceId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'note', title, content, category })
      });

      if (!response.ok) throw new Error('Failed to save note');
      const newItem = await response.json();
      
      dbData.items.push(newItem);
      modalAddItem.classList.remove('active');
      formAddNote.reset();
      updateUI();
    } catch (error) {
      console.error(error);
      alert('Error saving note');
    }
  });

  // SUBMIT FORM: Create Category
  formAddCategory.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('category-name').value;

    try {
      const response = await fetch(`/api/workspaces/${activeWorkspaceId}/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create category');
      }

      const data = await response.json();
      dbData.categories = data.categories;
      modalAddCategory.classList.remove('active');
      populateCategoriesDropdowns();
      updateUI();
    } catch (error) {
      console.error(error);
      alert(error.message || 'Error creating category');
    }
  });

  // SUBMIT FORM: Upload PDF/File(s) with Progress
  formUploadFile.addEventListener('submit', async (e) => {
    e.preventDefault();
    const files = fileInput.files;
    if (!files || files.length === 0) return alert('Please select a file to upload');

    const title = document.getElementById('file-title').value;
    const description = document.getElementById('file-desc').value;
    const category = document.getElementById('file-category').value;

    uploadProgressContainer.style.display = 'block';
    btnSubmitUpload.disabled = true;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      uploadProgressText.textContent = `Uploading ${i + 1} of ${files.length}: ${file.name}…`;
      uploadProgressFill.style.width = '0%';

      await new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append('file', file);
        // Only apply custom title to single-file uploads
        formData.append('title', files.length === 1 ? title : '');
        formData.append('description', files.length === 1 ? description : '');
        formData.append('category', category);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `/api/workspaces/${activeWorkspaceId}/upload`, true);

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const pct = Math.round((event.loaded / event.total) * 100);
            uploadProgressFill.style.width = pct + '%';
            uploadProgressText.textContent = `Uploading ${i + 1} of ${files.length}: ${file.name} — ${pct}%`;
          }
        };

        xhr.onload = () => {
          if (xhr.status === 201) {
            const newItem = JSON.parse(xhr.responseText);
            dbData.items.push(newItem);
            resolve();
          } else {
            alert(`Failed to upload "${file.name}". Error: ` + xhr.responseText);
            reject(new Error(xhr.responseText));
          }
        };

        xhr.onerror = () => {
          alert(`Upload of "${file.name}" failed due to a network error.`);
          reject(new Error('Network error'));
        };

        xhr.send(formData);
      }).catch(() => { /* continue with remaining files */ });
    }

    uploadProgressText.textContent = `Done! ${files.length} file(s) uploaded.`;
    uploadProgressFill.style.width = '100%';

    setTimeout(() => {
      modalAddItem.classList.remove('active');
      formUploadFile.reset();
      resetFileDropzone();
      updateUI();
    }, 800);
  });
}

// Handle file selection from browse or drop
function handleFilesSelected(files) {
  if (files.length === 1) {
    fileNameLabel.textContent = `${files[0].name} (${formatBytes(files[0].size)})`;
  } else {
    const totalSize = Array.from(files).reduce((acc, f) => acc + f.size, 0);
    fileNameLabel.textContent = `${files.length} files selected (${formatBytes(totalSize)} total)`;
  }
  fileDropzone.style.display = 'none';
  selectedFileInfo.style.display = 'flex';
}

// Helpers
function formatDate(isoString) {
  if (!isoString) return 'Unknown';
  const d = new Date(isoString);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatBytes(bytes) {
  if (bytes === 0 || !bytes) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ================================================================
// FOLDER EXPLORER MODULE
// ================================================================

const FolderExplorer = (() => {
  // State
  let folderTree = null;         // full tree from server
  let currentFolderPath = '';    // '' = root
  let activeFolderNode = null;   // currently selected node in full tree
  let renameTarget = null;       // { type:'folder'|'file', path, name }
  let moveTarget = null;         // { path, name }

  // DOM refs (resolved lazily after DOM ready)
  const dom = () => ({
    explorer:          document.getElementById('folder-explorer'),
    folderTree:        document.getElementById('folder-tree'),
    breadcrumb:        document.getElementById('folder-breadcrumb'),
    btnRoot:           document.getElementById('btn-breadcrumb-root'),
    btnNewFolder:      document.getElementById('btn-fe-new-folder'),
    btnUpload:         document.getElementById('btn-fe-upload'),

    // Contents
    fileList:          document.getElementById('folder-file-list'),
    subfolderGrid:     document.getElementById('folder-subfolder-grid'),
    contentsEmpty:     document.getElementById('folder-contents-empty'),
    btnUploadEmpty:    document.getElementById('btn-fe-upload-empty'),

    // Create Folder modal
    modalCreateFolder: document.getElementById('modal-create-folder'),
    btnCloseFolderModal: document.getElementById('btn-close-folder-modal'),
    formCreateFolder:  document.getElementById('form-create-folder'),
    folderNameInput:   document.getElementById('folder-name-input'),

    // Upload modal
    modalFolderUpload: document.getElementById('modal-folder-upload'),
    btnCloseFolderUploadModal: document.getElementById('btn-close-folder-upload-modal'),
    formFolderUpload:  document.getElementById('form-folder-upload'),
    feFileDropzone:    document.getElementById('fe-file-dropzone'),
    feFileInput:       document.getElementById('fe-file-input'),
    feSelectedInfo:    document.getElementById('fe-selected-info'),
    feFileNameLabel:   document.getElementById('fe-file-name-label'),
    btnFeRemoveFile:   document.getElementById('btn-fe-remove-file'),
    feUploadProgress:  document.getElementById('fe-upload-progress'),
    feProgressFill:    document.getElementById('fe-progress-fill'),
    feProgressText:    document.getElementById('fe-progress-text'),
    btnFeSubmitUpload: document.getElementById('btn-fe-submit-upload'),
    feTargetLabel:     document.getElementById('fe-target-folder-label'),

    // Rename modal
    modalRename:       document.getElementById('modal-fe-rename'),
    btnCloseRename:    document.getElementById('btn-close-rename-modal'),
    formRename:        document.getElementById('form-fe-rename'),
    renameInput:       document.getElementById('fe-rename-input'),
    renameModalTitle:  document.getElementById('fe-rename-modal-title'),

    // Move modal
    modalMove:         document.getElementById('modal-fe-move'),
    btnCloseMove:      document.getElementById('btn-close-move-modal'),
    btnCancelMove:     document.getElementById('btn-cancel-move'),
    formMove:          document.getElementById('form-fe-move'),
    moveFileName:      document.getElementById('fe-move-file-name'),
    moveDestSelect:    document.getElementById('fe-move-destination-select'),
    btnSubmitMove:     document.getElementById('btn-submit-move'),

    // Sidebar folder count badge
    countFolders:      document.getElementById('count-folders'),
  });

  // ---------- Public: activate / deactivate ----------

  function activate() {
    const d = dom();
    d.explorer.style.display = 'flex';
    fetchAndRender();
  }

  function deactivate() {
    const d = dom();
    d.explorer.style.display = 'none';
  }

  // ---------- Data fetching ----------

  async function fetchAndRender() {
    if (!activeWorkspaceId) return;
    try {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/folders`);
      if (!res.ok) {
        console.warn(`FolderExplorer: Server returned status ${res.status} when fetching folders.`);
        return;
      }
      folderTree = await res.json();

      // Update sidebar badge (count top-level folders)
      const d = dom();
      if (d.countFolders) {
        d.countFolders.textContent = (folderTree.folders || []).length;
      }

      renderTree();
      navigateTo(currentFolderPath, false);
    } catch (err) {
      console.error('FolderExplorer: fetch error', err);
    }
  }

  // ---------- Tree rendering ----------

  function renderTree() {
    const d = dom();
    d.folderTree.innerHTML = '';

    // Root entry
    const rootLi = document.createElement('li');
    rootLi.className = 'folder-tree-root-item';

    const rootNode = makeTreeNode({
      name: 'Root',
      path: '',
      folders: folderTree.folders,
      files: folderTree.files,
    }, true);
    rootLi.appendChild(rootNode.el);

    if ((folderTree.folders || []).length > 0) {
      const childUl = buildTreeChildren(folderTree.folders);
      rootLi.appendChild(childUl);
    }

    d.folderTree.appendChild(rootLi);
    lucide.createIcons();
  }

  function buildTreeChildren(folders) {
    const ul = document.createElement('ul');
    ul.className = 'folder-tree-children';

    (folders || []).forEach(folder => {
      const li = document.createElement('li');
      const { el, childrenContainer } = makeTreeNode(folder, false);
      li.appendChild(el);

      if ((folder.folders || []).length > 0) {
        const nestedUl = buildTreeChildren(folder.folders);
        nestedUl.style.display = 'none';
        li.appendChild(nestedUl);
        childrenContainer.nestedUl = nestedUl;
      }

      ul.appendChild(li);
    });

    return ul;
  }

  function makeTreeNode(folder, isRoot) {
    const node = document.createElement('div');
    node.className = 'folder-tree-node';
    if (folder.path === currentFolderPath) node.classList.add('active');

    const hasChildren = (folder.folders || []).length > 0;

    node.innerHTML = `
      <i data-lucide="${isRoot ? 'hard-drive' : 'folder'}" class="node-icon"></i>
      <span class="node-label">${escapeHTML(folder.name)}</span>
      ${hasChildren ? '<i data-lucide="chevron-right" class="node-chevron"></i>' : ''}
      <span class="node-count">${(folder.files || []).length + (folder.folders || []).length}</span>
      ${!isRoot ? `
        <div class="node-actions">
          <button class="node-action-btn" data-action="rename" title="Rename"><i data-lucide="pencil"></i></button>
          <button class="node-action-btn danger" data-action="delete" title="Delete"><i data-lucide="trash-2"></i></button>
        </div>
      ` : ''}
    `;

    let nestedUl = null;

    // Drag-and-drop: tree node is a drop target
    node.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      node.classList.add('drag-hover');
    });
    node.addEventListener('dragleave', (e) => {
      if (!node.contains(e.relatedTarget)) {
        node.classList.remove('drag-hover');
      }
    });
    node.addEventListener('drop', async (e) => {
      e.preventDefault();
      node.classList.remove('drag-hover');
      try {
        const raw = e.dataTransfer.getData('text/plain');
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data && data.filePath) {
          await moveFile(data.filePath, folder.path || '');
        }
      } catch (err) {
        console.error('Drop error:', err);
      }
    });

    // Right-click on node -> show context menu
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openContextMenu(e, folder, 'folder');
    });

    // Click on the node label area = navigate
    node.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        const action = actionBtn.dataset.action;
        if (action === 'rename') openRenameFolder(folder);
        if (action === 'delete') deleteFolder(folder);
        return;
      }

      // Toggle children if has sub-folders
      if (hasChildren && nestedUl) {
        const isOpen = node.classList.toggle('open');
        nestedUl.style.display = isOpen ? 'block' : 'none';
      }

      navigateTo(folder.path);
    });

    return { el: node, childrenContainer: { get nestedUl() { return nestedUl; }, set nestedUl(v) { nestedUl = v; } } };
  }

  // ---------- Navigation & breadcrumb ----------

  function navigateTo(path, scrollToTop = true) {
    currentFolderPath = path || '';
    updateBreadcrumb(currentFolderPath);
    updateTreeActiveState(currentFolderPath);

    const node = findNodeByPath(folderTree, currentFolderPath);
    activeFolderNode = node;
    renderContents(node || folderTree);

    if (scrollToTop) {
      const d = dom();
      d.explorer && d.explorer.scrollTop || 0;
    }
    safeCreateIcons();
  }

  function findNodeByPath(tree, path) {
    if (!path) return tree;
    function search(node) {
      if (node.path === path) return node;
      for (const f of (node.folders || [])) {
        const found = search(f);
        if (found) return found;
      }
      return null;
    }
    return search(tree);
  }

  function updateTreeActiveState(path) {
    const d = dom();
    d.folderTree.querySelectorAll('.folder-tree-node').forEach(n => n.classList.remove('active'));
    d.folderTree.querySelectorAll('.folder-tree-node').forEach(n => {
      // find by matching the label text (simplistic but works for unique paths)
      const label = n.querySelector('.node-label');
      if (!label) return;
      // We match via navigateTo path stored in data attribute
      if (n.dataset.path === path || (path === '' && n.closest('.folder-tree-root-item'))) {
        n.classList.add('active');
      }
    });
  }

  function updateBreadcrumb(path) {
    const d = dom();
    // Remove dynamic segments (keep the root button)
    d.breadcrumb.querySelectorAll('.breadcrumb-seg, .breadcrumb-sep').forEach(el => el.remove());

    if (!path) return;

    const parts = path.split('/').filter(Boolean);
    let accum = '';
    parts.forEach((part, idx) => {
      accum = accum ? `${accum}/${part}` : part;
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = '/';
      d.breadcrumb.appendChild(sep);

      const btn = document.createElement('button');
      btn.className = 'breadcrumb-item breadcrumb-seg';
      btn.textContent = part;
      const capturePath = accum;
      btn.addEventListener('click', () => navigateTo(capturePath));

      // Drop target for breadcrumb segment
      btn.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        btn.classList.add('drag-hover');
      });
      btn.addEventListener('dragleave', (e) => {
        if (!btn.contains(e.relatedTarget)) {
          btn.classList.remove('drag-hover');
        }
      });
      btn.addEventListener('drop', async (e) => {
        e.preventDefault();
        btn.classList.remove('drag-hover');
        try {
          const raw = e.dataTransfer.getData('text/plain');
          if (!raw) return;
          const data = JSON.parse(raw);
          if (data && data.filePath) {
            await moveFile(data.filePath, capturePath);
          }
        } catch (err) {
          console.error('Drop error:', err);
        }
      });

      d.breadcrumb.appendChild(btn);
    });
  }

  // ---------- Contents rendering ----------

  function renderContents(node) {
    const d = dom();
    const folders = node.folders || [];
    const files = node.files || [];

    const isEmpty = folders.length === 0 && files.length === 0;

    d.contentsEmpty.style.display = isEmpty ? 'flex' : 'none';
    d.subfolderGrid.innerHTML = '';
    d.fileList.innerHTML = '';

    if (isEmpty) return;

    // Sub-folders grid
    if (folders.length > 0) {
      folders.forEach(folder => {
        const card = makeSubfolderCard(folder);
        d.subfolderGrid.appendChild(card);
      });
    }

    // Files section
    if (files.length > 0) {
      const header = document.createElement('div');
      header.className = 'file-section-header';
      header.textContent = `Files (${files.length})`;
      d.fileList.appendChild(header);

      files.forEach(file => {
        const row = makeFileRow(file);
        d.fileList.appendChild(row);
      });
    }

    safeCreateIcons();
  }

  function makeSubfolderCard(folder) {
    const card = document.createElement('div');
    card.className = 'subfolder-card';
    const fileCount = (folder.files || []).length;
    const folderCount = (folder.folders || []).length;
    const totalCount = fileCount + folderCount;

    card.innerHTML = `
      <div class="sf-actions">
        <button class="node-action-btn" data-action="rename" title="Rename"><i data-lucide="pencil"></i></button>
        <button class="node-action-btn danger" data-action="delete" title="Delete"><i data-lucide="trash-2"></i></button>
      </div>
      <i data-lucide="folder" class="sf-icon"></i>
      <span class="sf-name">${escapeHTML(folder.name)}</span>
      <span class="sf-count">${totalCount} item${totalCount !== 1 ? 's' : ''}</span>
    `;

    // Right-click on subfolder card -> show context menu
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openContextMenu(e, folder, 'folder');
    });

    // Drop target for moving files into this folder
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('drag-hover');
    });
    card.addEventListener('dragleave', (e) => {
      if (!card.contains(e.relatedTarget)) {
        card.classList.remove('drag-hover');
      }
    });
    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      card.classList.remove('drag-hover');
      try {
        const raw = e.dataTransfer.getData('text/plain');
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data && data.filePath) {
          await moveFile(data.filePath, folder.path);
        }
      } catch (err) {
        console.error('Drop error on subfolder card:', err);
      }
    });

    card.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        if (actionBtn.dataset.action === 'rename') openRenameFolder(folder);
        if (actionBtn.dataset.action === 'delete') deleteFolder(folder);
        return;
      }
      navigateTo(folder.path);
    });

    return card;
  }

  function makeFileRow(file) {
    const row = document.createElement('div');
    row.className = 'file-row';
    const sizeStr = formatBytes(file.size || 0);
    const dateStr = file.modifiedAt ? formatDate(file.modifiedAt) : '';
    const fileUrl = `/uploads/${activeWorkspaceId}/${file.path}`;
    const ext = file.name.split('.').pop().toLowerCase();
    const iconName = ['pdf'].includes(ext) ? 'file-text' : ['jpg','jpeg','png','gif','webp'].includes(ext) ? 'image' : 'file';

    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', JSON.stringify({ filePath: file.path, name: file.name }));
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
    });

    row.innerHTML = `
      <i data-lucide="${iconName}" class="fr-icon"></i>
      <div class="fr-name">
        <a href="${fileUrl}" target="_blank" rel="noopener noreferrer" title="${escapeHTML(file.name)}">${escapeHTML(file.name)}</a>
      </div>
      <span class="fr-size">${sizeStr}</span>
      <span class="fr-date">${dateStr}</span>
      <div class="fr-actions">
        <a href="${fileUrl}" target="_blank" class="fr-action-btn" title="Open"><i data-lucide="eye"></i></a>
        <a href="${fileUrl}" download="${escapeHTML(file.name)}" class="fr-action-btn" title="Download"><i data-lucide="download"></i></a>
        <button class="fr-action-btn" data-action="move" title="Move to folder"><i data-lucide="folder-input"></i></button>
        <button class="fr-action-btn" data-action="rename" title="Rename file"><i data-lucide="pencil"></i></button>
        <button class="fr-action-btn danger" data-action="delete" title="Delete file"><i data-lucide="trash-2"></i></button>
      </div>
    `;

    // Right-click on file row -> show context menu
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openContextMenu(e, file, 'file');
    });

    row.querySelector('[data-action="move"]').addEventListener('click', () => openMoveFileModal(file));
    row.querySelector('[data-action="rename"]').addEventListener('click', () => openRenameFile(file));
    row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteFile(file));

    return row;
  }

  // ---------- Folder CRUD ----------

  function openCreateFolderModal() {
    const d = dom();
    d.folderNameInput.value = '';
    d.modalCreateFolder.classList.add('active');
    setTimeout(() => d.folderNameInput.focus(), 100);
  }

  async function createFolder(name) {
    try {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: currentFolderPath, name })
      });
      if (!res.ok) {
        let errMsg = 'Failed to create folder';
        try {
          const err = await res.json();
          errMsg = err.error || errMsg;
        } catch {
          errMsg = `Server returned ${res.status}: ${res.statusText}. Please restart the server.`;
        }
        throw new Error(errMsg);
      }
      await fetchAndRender();
    } catch (err) {
      alert(err.message);
    }
  }

  async function deleteFolder(folder) {
    if (!confirm(`Delete folder "${folder.name}" and ALL its contents? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/folders`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: folder.path })
      });
      if (!res.ok) {
        let errMsg = 'Failed to delete folder';
        try {
          const err = await res.json();
          errMsg = err.error || errMsg;
        } catch {
          errMsg = `Server returned ${res.status}: ${res.statusText}`;
        }
        throw new Error(errMsg);
      }
      // If we were inside this folder, go up
      if (currentFolderPath === folder.path || currentFolderPath.startsWith(folder.path + '/')) {
        currentFolderPath = folder.path.includes('/') ? folder.path.substring(0, folder.path.lastIndexOf('/')) : '';
      }
      await fetchAndRender();
    } catch (err) {
      alert(err.message);
    }
  }

  // ---------- File CRUD ----------

  async function deleteFile(file) {
    if (!confirm(`Delete "${file.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/files`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: file.path })
      });
      if (!res.ok) {
        let errMsg = 'Failed to delete file';
        try {
          const err = await res.json();
          errMsg = err.error || errMsg;
        } catch {
          errMsg = `Server returned ${res.status}: ${res.statusText}`;
        }
        throw new Error(errMsg);
      }
      await fetchAndRender();
    } catch (err) {
      alert(err.message);
    }
  }

  // ---------- Rename modal ----------

  function openRenameFolder(folder) {
    renameTarget = { type: 'folder', path: folder.path, name: folder.name };
    const d = dom();
    d.renameModalTitle.textContent = 'Rename Folder';
    d.renameInput.value = folder.name;
    d.modalRename.classList.add('active');
    setTimeout(() => d.renameInput.focus(), 100);
  }

  function openRenameFile(file) {
    renameTarget = { type: 'file', path: file.path, name: file.name };
    const d = dom();
    d.renameModalTitle.textContent = 'Rename File';
    d.renameInput.value = file.name;
    d.modalRename.classList.add('active');
    setTimeout(() => d.renameInput.focus(), 100);
  }

  async function doRename(newName) {
    if (!renameTarget || !newName.trim()) return;
    try {
      let res;
      if (renameTarget.type === 'folder') {
        res = await fetch(`/api/workspaces/${activeWorkspaceId}/folders`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folderPath: renameTarget.path, newName: newName.trim() })
        });
      } else {
        res = await fetch(`/api/workspaces/${activeWorkspaceId}/files/rename`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: renameTarget.path, newName: newName.trim() })
        });
      }
      if (!res.ok) {
        let errMsg = 'Rename failed';
        try {
          const err = await res.json();
          errMsg = err.error || errMsg;
        } catch {
          errMsg = `Server returned ${res.status}: ${res.statusText}`;
        }
        throw new Error(errMsg);
      }
      await fetchAndRender();
    } catch (err) {
      alert(err.message);
    }
    renameTarget = null;
  }

  // ---------- Move File ----------

  function getAllFoldersList(tree) {
    const list = [{ path: '', label: '📁 Root' }];
    if (!tree) return list;
    function traverse(node, currentPath) {
      (node.folders || []).forEach(f => {
        const fullPath = currentPath ? `${currentPath}/${f.name}` : f.name;
        const depth = fullPath.split('/').length;
        const indent = '　'.repeat(depth - 1) + '└─ 📁 ';
        list.push({ path: f.path, label: indent + f.name });
        traverse(f, fullPath);
      });
    }
    traverse(tree, '');
    return list;
  }

  function openMoveFileModal(file) {
    moveTarget = file;
    const d = dom();
    d.moveFileName.textContent = file.name;
    d.moveDestSelect.innerHTML = '';

    const allFolders = getAllFoldersList(folderTree);
    const currentFileParent = file.path.includes('/')
      ? file.path.substring(0, file.path.lastIndexOf('/'))
      : '';

    let hasValidTarget = false;
    allFolders.forEach(folder => {
      const option = document.createElement('option');
      option.value = folder.path;
      option.textContent = folder.label;
      if (folder.path === currentFileParent) {
        option.textContent += ' (current location)';
        option.disabled = true;
      } else {
        if (!hasValidTarget) {
          option.selected = true;
          hasValidTarget = true;
        }
      }
      d.moveDestSelect.appendChild(option);
    });

    d.btnSubmitMove.disabled = !hasValidTarget;
    d.modalMove.classList.add('active');
  }

  async function moveFile(filePath, targetFolder) {
    const currentParent = filePath.includes('/')
      ? filePath.substring(0, filePath.lastIndexOf('/'))
      : '';
    if (currentParent === targetFolder) {
      alert('File is already in that folder.');
      return;
    }

    try {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/files/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, targetFolder })
      });
      if (!res.ok) {
        let errMsg = 'Failed to move file';
        try {
          const err = await res.json();
          errMsg = err.error || errMsg;
        } catch {
          errMsg = `Server returned ${res.status}: ${res.statusText}`;
        }
        throw new Error(errMsg);
      }
      await fetchAndRender();
    } catch (err) {
      alert(err.message);
    }
  }

  // ---------- Upload to folder ----------

  function openUploadModal() {
    const d = dom();
    d.feTargetLabel.textContent = currentFolderPath ? currentFolderPath.split('/').pop() : 'Root';
    d.feFileInput.value = '';
    d.feSelectedInfo.style.display = 'none';
    d.feFileDropzone.style.display = 'flex';
    d.feUploadProgress.style.display = 'none';
    d.feProgressFill.style.width = '0%';
    d.btnFeSubmitUpload.disabled = false;
    d.modalFolderUpload.classList.add('active');
  }

  async function uploadFilesToFolder(files) {
    const d = dom();
    if (!files || files.length === 0) return;

    d.feUploadProgress.style.display = 'block';
    d.btnFeSubmitUpload.disabled = true;

    const url = `/api/workspaces/${activeWorkspaceId}/upload-to-folder?folder=${encodeURIComponent(currentFolderPath)}`;
    const formData = new FormData();
    Array.from(files).forEach(f => formData.append('files', f));

    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          d.feProgressFill.style.width = pct + '%';
          d.feProgressText.textContent = `Uploading... ${pct}%`;
        }
      };

      xhr.onload = () => {
        if (xhr.status === 201) {
          d.feProgressText.textContent = `Done! ${files.length} file(s) uploaded.`;
          d.feProgressFill.style.width = '100%';
          resolve();
        } else {
          alert('Upload failed: ' + xhr.responseText);
          reject(new Error(xhr.responseText));
        }
      };
      xhr.onerror = () => { alert('Network error during upload.'); reject(); };
      xhr.send(formData);
    }).catch(() => {});

    setTimeout(async () => {
      d.modalFolderUpload.classList.remove('active');
      await fetchAndRender();
    }, 600);
  }

  // ---------- Event wiring ----------

  function setupEvents() {
    const d = dom();

    // Root breadcrumb
    d.btnRoot.addEventListener('click', () => navigateTo(''));

    // Root breadcrumb drop target (move file to root folder)
    d.btnRoot.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      d.btnRoot.classList.add('drag-hover');
    });
    d.btnRoot.addEventListener('dragleave', (e) => {
      if (!d.btnRoot.contains(e.relatedTarget)) {
        d.btnRoot.classList.remove('drag-hover');
      }
    });
    d.btnRoot.addEventListener('drop', async (e) => {
      e.preventDefault();
      d.btnRoot.classList.remove('drag-hover');
      try {
        const raw = e.dataTransfer.getData('text/plain');
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data && data.filePath) {
          await moveFile(data.filePath, '');
        }
      } catch (err) {
        console.error('Drop error on root breadcrumb:', err);
      }
    });

    // New Folder button (toolbar)
    d.btnNewFolder.addEventListener('click', () => openCreateFolderModal());

    // Upload button (toolbar)
    d.btnUpload.addEventListener('click', () => openUploadModal());

    // Upload button (empty state)
    d.btnUploadEmpty.addEventListener('click', () => openUploadModal());

    // --- Create Folder modal ---
    d.btnCloseFolderModal.addEventListener('click', () => d.modalCreateFolder.classList.remove('active'));
    d.modalCreateFolder.addEventListener('click', (e) => {
      if (e.target === d.modalCreateFolder) d.modalCreateFolder.classList.remove('active');
    });
    d.formCreateFolder.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = d.folderNameInput.value.trim();
      if (!name) return;
      d.modalCreateFolder.classList.remove('active');
      await createFolder(name);
      d.formCreateFolder.reset();
    });

    // --- Upload to Folder modal ---
    d.btnCloseFolderUploadModal.addEventListener('click', () => d.modalFolderUpload.classList.remove('active'));
    d.modalFolderUpload.addEventListener('click', (e) => {
      if (e.target === d.modalFolderUpload) d.modalFolderUpload.classList.remove('active');
    });

    // Dropzone click
    d.feFileDropzone.addEventListener('click', () => d.feFileInput.click());
    d.feFileInput.addEventListener('change', () => {
      if (d.feFileInput.files.length > 0) handleFeFilesSelected(d.feFileInput.files);
    });

    // Drag and drop
    ['dragenter', 'dragover'].forEach(ev => {
      d.feFileDropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        d.feFileDropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(ev => {
      d.feFileDropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        d.feFileDropzone.classList.remove('dragover');
      });
    });
    d.feFileDropzone.addEventListener('drop', (e) => {
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        d.feFileInput.files = files;
        handleFeFilesSelected(files);
      }
    });

    d.btnFeRemoveFile.addEventListener('click', () => {
      d.feFileInput.value = '';
      d.feSelectedInfo.style.display = 'none';
      d.feFileDropzone.style.display = 'flex';
    });

    d.formFolderUpload.addEventListener('submit', async (e) => {
      e.preventDefault();
      await uploadFilesToFolder(d.feFileInput.files);
    });

    // --- Rename modal ---
    d.btnCloseRename.addEventListener('click', () => d.modalRename.classList.remove('active'));
    d.modalRename.addEventListener('click', (e) => {
      if (e.target === d.modalRename) d.modalRename.classList.remove('active');
    });
    d.formRename.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newName = d.renameInput.value.trim();
      d.modalRename.classList.remove('active');
      if (newName) await doRename(newName);
    });

    // --- Move File modal ---
    d.btnCloseMove.addEventListener('click', () => d.modalMove.classList.remove('active'));
    d.btnCancelMove.addEventListener('click', () => d.modalMove.classList.remove('active'));
    d.modalMove.addEventListener('click', (e) => {
      if (e.target === d.modalMove) d.modalMove.classList.remove('active');
    });
    d.formMove.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!moveTarget) return;
      const targetFolder = d.moveDestSelect.value;
      d.modalMove.classList.remove('active');
      await moveFile(moveTarget.path, targetFolder);
      moveTarget = null;
    });
  }

  function handleFeFilesSelected(files) {
    const d = dom();
    if (files.length === 1) {
      d.feFileNameLabel.textContent = `${files[0].name} (${formatBytes(files[0].size)})`;
    } else {
      const total = Array.from(files).reduce((a, f) => a + f.size, 0);
      d.feFileNameLabel.textContent = `${files.length} files selected (${formatBytes(total)} total)`;
    }
    d.feFileDropzone.style.display = 'none';
    d.feSelectedInfo.style.display = 'flex';
  }

  // ---------- Public API ----------

  return {
    activate,
    deactivate,
    setupEvents,
    refresh: fetchAndRender,
    navigateTo,
    deleteFolder,
    openRenameFolder,
    deleteFile,
    openRenameFile,
    openMoveFileModal,
  };
})();

// ================================================================
// Hook Folder Explorer into the sidebar filter system
// ================================================================

(function hookFolderExplorer() {
  // Wait for DOM using resilient onReady helper
  onReady(() => {
    FolderExplorer.setupEvents();

    const filterFolders = document.getElementById('filter-folders');
    if (!filterFolders) return;

    filterFolders.addEventListener('click', () => {
      // Deactivate other type filters
      [filterAll, filterLinks, filterFiles, filterNotes].forEach(el => el.classList.remove('active'));
      filterFolders.classList.add('active');

      // Hide regular grid, show explorer
      itemsGrid.style.display = 'none';
      emptyState.style.display = 'none';
      const statusBar = document.getElementById('filter-status-bar');
      if (statusBar) statusBar.style.display = 'none';

      FolderExplorer.activate();
    });

    // Patch existing type filter buttons to hide the explorer when clicked
    [filterAll, filterLinks, filterFiles, filterNotes].forEach(el => {
      el.addEventListener('click', () => {
        filterFolders.classList.remove('active');
        FolderExplorer.deactivate();
      });
    });

    // Also refresh when workspace changes
    window.addEventListener('workspaceChanged', () => {
      if (document.getElementById('folder-explorer').style.display !== 'none') {
        FolderExplorer.refresh();
      }
    });
  });
})();

// ================================================================
// Mobile / Android Compatibility & PWA Controller
// ================================================================

(function initMobileAndPWA() {
  onReady(() => {
    // 1. Service Worker Registration
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then(reg => {
            console.log('[PWA] Service Worker registered successfully:', reg.scope);
          })
          .catch(err => {
            console.warn('[PWA] Service Worker registration failed:', err);
          });
      });
    }

    // 2. Mobile Drawer Navigation
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    const btnMobileMenu = document.getElementById('btn-mobile-menu');
    const btnSidebarClose = document.getElementById('btn-sidebar-close');

    function openSidebar() {
      if (sidebar) sidebar.classList.add('open');
      if (backdrop) backdrop.classList.add('active');
    }

    function closeSidebar() {
      if (sidebar) sidebar.classList.remove('open');
      if (backdrop) backdrop.classList.remove('active');
    }

    if (btnMobileMenu) btnMobileMenu.addEventListener('click', openSidebar);
    if (btnSidebarClose) btnSidebarClose.addEventListener('click', closeSidebar);
    if (backdrop) backdrop.addEventListener('click', closeSidebar);

    // Auto-close drawer on mobile when selecting filters or navigating
    const navItems = document.querySelectorAll('.nav-list li');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        if (window.innerWidth <= 900) {
          closeSidebar();
        }
      });
    });

    if (workspaceSelect) {
      workspaceSelect.addEventListener('change', () => {
        if (window.innerWidth <= 900) {
          closeSidebar();
        }
      });
    }

    // 3. PWA Installation Handler
    let deferredPrompt = null;
    const btnPwaInstall = document.getElementById('btn-pwa-install');

    window.addEventListener('beforeinstallprompt', (e) => {
      // Prevent automatic mini-infobar on mobile Chrome
      e.preventDefault();
      deferredPrompt = e;
      if (btnPwaInstall) {
        btnPwaInstall.style.display = 'inline-flex';
        if (window.lucide) lucide.createIcons();
      }
    });

    if (btnPwaInstall) {
      btnPwaInstall.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log('[PWA] User response to install prompt:', outcome);
        deferredPrompt = null;
        btnPwaInstall.style.display = 'none';
      });
    }

    window.addEventListener('appinstalled', () => {
      console.log('[PWA] Workspace app was successfully installed on device.');
      if (btnPwaInstall) btnPwaInstall.style.display = 'none';
      if (typeof showToast === 'function') {
        showToast('App installed on your device!');
      }
    });
  });
})();


