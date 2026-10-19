/**
 * Workspace Hub — Dedicated PDF & File Viewer ("Workspace DocViewer")
 * Features:
 *  - Native PDF.js canvas rendering with HiDPI support
 *  - Automatic Reading Progress persistence ("Start over / Resume where I left off")
 *  - Smart Resume Banner & "Start Over from Beginning" button
 *  - Multi-page navigation, page jump, continuous/single page modes
 *  - Thumbnails sidebar with lazy rendering & active page highlight
 *  - PDF Table of Contents / Outline navigation
 *  - In-document text search
 *  - Zoom presets (Fit Width, Fit Page, 50%-300%), 90-degree rotate
 *  - Reading themes: Default, Dark Mode (inverted for night reading), Warm Sepia
 *  - Support for other files: Text & Code (with line numbers & syntax styling),
 *    Markdown (rendered & source view), Images (pan & zoom), Audio/Video (with timestamp resume)
 *  - Universal "Open Local File" drag-and-drop & file picker
 *  - Fullscreen mode & keyboard shortcuts
 */

(function () {
  'use strict';

  // Configure PDF.js Worker
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
  }

  // =========================================================================
  // 1. Reading Progress Manager (State Persistence Engine)
  // =========================================================================
  const ReadingProgressManager = {
    STORAGE_PREFIX: 'workspace_reader_progress_',

    getKey(file) {
      if (!file) return `${this.STORAGE_PREFIX}unknown`;
      if (file.id) return `${this.STORAGE_PREFIX}id_${file.id}`;
      const pathOrName = file.filePath || file.path || file.fileName || file.name || file.url || 'temp';
      return `${this.STORAGE_PREFIX}${encodeURIComponent(pathOrName)}`;
    },

    getProgress(file) {
      try {
        const raw = localStorage.getItem(this.getKey(file));
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (e) {
        console.warn('[DocViewer] Failed to read progress:', e);
        return null;
      }
    },

    saveProgress(file, data) {
      if (!file) return null;
      try {
        const totalPages = data.totalPages || 1;
        const page = Math.min(Math.max(1, data.page || 1), totalPages);
        const percentage = Math.round((page / totalPages) * 100);

        const payload = {
          page: page,
          totalPages: totalPages,
          percentage: percentage,
          scrollTop: data.scrollTop || 0,
          scale: data.scale || 'auto',
          theme: data.theme || 'default',
          mediaTime: data.mediaTime || 0,
          lastReadAt: new Date().toISOString(),
          title: file.title || file.fileName || file.name || 'Document'
        };

        localStorage.setItem(this.getKey(file), JSON.stringify(payload));

        // Also update memory item if it exists in dbData
        if (file.id && window.dbData && Array.isArray(window.dbData.items)) {
          const found = window.dbData.items.find(i => i.id === file.id);
          if (found) {
            found.readProgress = payload;
          }
        }

        // Notify dashboard to update badges
        window.dispatchEvent(new CustomEvent('workspace-reading-progress-updated', {
          detail: { file, progress: payload }
        }));

        return payload;
      } catch (e) {
        console.warn('[DocViewer] Failed to save progress:', e);
        return null;
      }
    },

    clearProgress(file) {
      if (!file) return;
      try {
        localStorage.removeItem(this.getKey(file));
        if (file.id && window.dbData && Array.isArray(window.dbData.items)) {
          const found = window.dbData.items.find(i => i.id === file.id);
          if (found) {
            delete found.readProgress;
          }
        }
        window.dispatchEvent(new CustomEvent('workspace-reading-progress-updated', {
          detail: { file, progress: null }
        }));
      } catch (e) {
        console.warn('[DocViewer] Failed to clear progress:', e);
      }
    }
  };

  // Expose ReadingProgressManager globally
  window.ReadingProgressManager = ReadingProgressManager;

  // =========================================================================
  // 2. Main WorkspaceViewer Controller
  // =========================================================================
  const WorkspaceViewer = {
    // Current Active State
    activeFile: null,
    docType: 'pdf', // 'pdf', 'image', 'text', 'markdown', 'media', 'unsupported'
    pdfDoc: null,
    currentPage: 1,
    totalPages: 1,
    scale: 1.0,
    fitMode: 'page-width', // 'page-width', 'page-fit', 'custom'
    rotation: 0,
    theme: 'default', // 'default', 'dark', 'sepia'
    renderTask: null,
    isRendering: false,
    pendingPage: null,
    thumbnailsRendered: new Set(),
    outlineItems: [],
    searchMatches: [],
    currentMatchIndex: -1,
    sidebarTab: 'thumbs', // 'thumbs', 'outline', 'info'
    isSidebarOpen: true,
    isFullscreen: false,
    textFontSize: 14,
    markdownMode: 'rendered', // 'rendered' or 'source'

    // DOM References Cache
    dom: {},

    init() {
      this.cacheElements();
      if (!this.dom.overlay) return;
      this.bindEvents();
      this.initDropZone();
    },

    cacheElements() {
      this.dom = {
        overlay: document.getElementById('docviewer-overlay'),
        header: document.getElementById('dv-header'),
        title: document.getElementById('dv-file-title'),
        icon: document.getElementById('dv-file-icon'),
        sizeBadge: document.getElementById('dv-file-size'),
        progressPill: document.getElementById('dv-progress-pill'),
        progressBar: document.getElementById('dv-reading-progress-bar'),

        // Resume banner
        resumeBanner: document.getElementById('dv-resume-banner'),
        resumeText: document.getElementById('dv-resume-text'),
        btnResumeDismiss: document.getElementById('dv-btn-resume-dismiss'),
        btnResumeStartOver: document.getElementById('dv-btn-resume-startover'),

        // Pagination controls
        navGroup: document.getElementById('dv-nav-group'),
        btnFirst: document.getElementById('dv-btn-first'),
        btnPrev: document.getElementById('dv-btn-prev'),
        pageInput: document.getElementById('dv-page-input'),
        pageCount: document.getElementById('dv-page-count'),
        btnNext: document.getElementById('dv-btn-next'),
        btnLast: document.getElementById('dv-btn-last'),

        // Zoom & Rotate controls
        zoomGroup: document.getElementById('dv-zoom-group'),
        btnZoomOut: document.getElementById('dv-btn-zoom-out'),
        zoomSelect: document.getElementById('dv-zoom-select'),
        btnZoomIn: document.getElementById('dv-btn-zoom-in'),
        btnRotate: document.getElementById('dv-btn-rotate'),

        // Action controls
        btnStartOver: document.getElementById('dv-btn-startover'),
        btnTheme: document.getElementById('dv-btn-theme'),
        btnSearchToggle: document.getElementById('dv-btn-search-toggle'),
        btnSidebarToggle: document.getElementById('dv-btn-sidebar-toggle'),
        btnOpenLocal: document.getElementById('dv-btn-open-local'),
        fileInput: document.getElementById('dv-file-input'),
        btnDownload: document.getElementById('dv-btn-download'),
        btnFullscreen: document.getElementById('dv-btn-fullscreen'),
        btnClose: document.getElementById('dv-btn-close'),

        // Search Bar
        searchBar: document.getElementById('dv-search-bar'),
        searchInput: document.getElementById('dv-search-input'),
        searchMatchInfo: document.getElementById('dv-search-match-info'),
        btnSearchPrev: document.getElementById('dv-btn-search-prev'),
        btnSearchNext: document.getElementById('dv-btn-search-next'),
        btnSearchClose: document.getElementById('dv-btn-search-close'),

        // Layout
        sidebar: document.getElementById('dv-sidebar'),
        sidebarTabThumbs: document.getElementById('dv-tab-thumbs'),
        sidebarTabOutline: document.getElementById('dv-tab-outline'),
        sidebarTabInfo: document.getElementById('dv-tab-info'),
        thumbsPane: document.getElementById('dv-pane-thumbs'),
        outlinePane: document.getElementById('dv-pane-outline'),
        infoPane: document.getElementById('dv-pane-info'),
        thumbsList: document.getElementById('dv-thumbs-list'),
        outlineList: document.getElementById('dv-outline-list'),
        infoContent: document.getElementById('dv-info-content'),

        // Canvas & Display Stages
        viewport: document.getElementById('dv-viewport'),
        loadingSpinner: document.getElementById('dv-loading'),
        loadingText: document.getElementById('dv-loading-text'),
        pdfStage: document.getElementById('dv-pdf-stage'),
        pdfCanvas: document.getElementById('dv-pdf-canvas'),
        textStage: document.getElementById('dv-text-stage'),
        textContent: document.getElementById('dv-text-content'),
        markdownStage: document.getElementById('dv-markdown-stage'),
        markdownRendered: document.getElementById('dv-markdown-rendered'),
        markdownRaw: document.getElementById('dv-markdown-raw'),
        imageStage: document.getElementById('dv-image-stage'),
        imageEl: document.getElementById('dv-image-el'),
        mediaStage: document.getElementById('dv-media-stage'),
        mediaContainer: document.getElementById('dv-media-container'),
        unsupportedStage: document.getElementById('dv-unsupported-stage'),
        unsupportedInfo: document.getElementById('dv-unsupported-info'),

        // Status bar
        statusInfo: document.getElementById('dv-status-info'),
        statusShortcuts: document.getElementById('dv-status-shortcuts')
      };
    },

    bindEvents() {
      const d = this.dom;

      // Close & Fullscreen
      d.btnClose.addEventListener('click', () => this.close());
      d.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());

      // Start Over button
      d.btnStartOver.addEventListener('click', () => this.startOver());

      // Resume banner actions
      d.btnResumeDismiss.addEventListener('click', () => {
        d.resumeBanner.classList.remove('active');
      });
      d.btnResumeStartOver.addEventListener('click', () => {
        d.resumeBanner.classList.remove('active');
        this.startOver();
      });

      // Pagination
      d.btnFirst.addEventListener('click', () => this.goToPage(1));
      d.btnPrev.addEventListener('click', () => this.goToPage(this.currentPage - 1));
      d.btnNext.addEventListener('click', () => this.goToPage(this.currentPage + 1));
      d.btnLast.addEventListener('click', () => this.goToPage(this.totalPages));

      d.pageInput.addEventListener('change', (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val)) this.goToPage(val);
      });
      d.pageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const val = parseInt(e.target.value, 10);
          if (!isNaN(val)) this.goToPage(val);
          d.pageInput.blur();
        }
      });

      // Zoom & Fit
      d.btnZoomOut.addEventListener('click', () => this.zoomStep(-0.2));
      d.btnZoomIn.addEventListener('click', () => this.zoomStep(0.2));
      d.zoomSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'width') {
          this.fitMode = 'page-width';
          this.applyFitMode();
        } else if (val === 'fit') {
          this.fitMode = 'page-fit';
          this.applyFitMode();
        } else {
          this.fitMode = 'custom';
          this.scale = parseFloat(val);
          this.renderCurrentPage();
        }
      });

      // Rotate
      d.btnRotate.addEventListener('click', () => {
        this.rotation = (this.rotation + 90) % 360;
        this.renderCurrentPage();
      });

      // Theme toggle
      d.btnTheme.addEventListener('click', () => this.cycleTheme());

      // Sidebar toggle
      d.btnSidebarToggle.addEventListener('click', () => this.toggleSidebar());

      // Sidebar tabs
      d.sidebarTabThumbs.addEventListener('click', () => this.switchSidebarTab('thumbs'));
      d.sidebarTabOutline.addEventListener('click', () => this.switchSidebarTab('outline'));
      d.sidebarTabInfo.addEventListener('click', () => this.switchSidebarTab('info'));

      // Search toggle & inputs
      d.btnSearchToggle.addEventListener('click', () => this.toggleSearch());
      d.btnSearchClose.addEventListener('click', () => this.toggleSearch(false));
      d.searchInput.addEventListener('input', () => this.performSearch(d.searchInput.value));
      d.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          if (e.shiftKey) this.searchNavigate(-1);
          else this.searchNavigate(1);
        } else if (e.key === 'Escape') {
          this.toggleSearch(false);
        }
      });
      d.btnSearchPrev.addEventListener('click', () => this.searchNavigate(-1));
      d.btnSearchNext.addEventListener('click', () => this.searchNavigate(1));

      // Open Local File
      d.btnOpenLocal.addEventListener('click', () => d.fileInput.click());
      d.fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          this.openLocalFile(e.target.files[0]);
          d.fileInput.value = '';
        }
      });

      // Download
      d.btnDownload.addEventListener('click', () => this.downloadActiveFile());

      // Keyboard shortcuts
      window.addEventListener('keydown', (e) => {
        if (!this.isOpen()) return;

        // If typing in input, don't trigger global shortcuts
        const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea') return;

        if (e.key === 'Escape') {
          e.preventDefault();
          this.close();
        } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === 'j') {
          e.preventDefault();
          this.goToPage(this.currentPage + 1);
        } else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'k') {
          e.preventDefault();
          this.goToPage(this.currentPage - 1);
        } else if (e.key === 'Home') {
          e.preventDefault();
          this.goToPage(1);
        } else if (e.key === 'End') {
          e.preventDefault();
          this.goToPage(this.totalPages);
        } else if (e.key === '+' || (e.ctrlKey && e.key === '=')) {
          e.preventDefault();
          this.zoomStep(0.2);
        } else if (e.key === '-' || (e.ctrlKey && e.key === '-')) {
          e.preventDefault();
          this.zoomStep(-0.2);
        } else if (e.key === '0' || (e.ctrlKey && e.key === '0')) {
          e.preventDefault();
          this.fitMode = 'page-width';
          this.applyFitMode();
        } else if (e.key === 'f') {
          e.preventDefault();
          this.toggleFullscreen();
        } else if (e.key === 'r') {
          e.preventDefault();
          this.rotation = (this.rotation + 90) % 360;
          this.renderCurrentPage();
        } else if (e.key === 's' && e.ctrlKey) {
          e.preventDefault();
          this.startOver();
        }
      });

      // Window resize debounce
      let resizeTimer = null;
      window.addEventListener('resize', () => {
        if (!this.isOpen() || this.docType !== 'pdf') return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (this.fitMode !== 'custom') {
            this.applyFitMode();
          }
        }, 150);
      });
    },

    initDropZone() {
      const dropZone = this.dom.viewport;
      if (!dropZone) return;

      ['dragenter', 'dragover'].forEach(name => {
        dropZone.addEventListener(name, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropZone.classList.add('drag-active');
        });
      });

      ['dragleave', 'drop'].forEach(name => {
        dropZone.addEventListener(name, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropZone.classList.remove('drag-active');
        });
      });

      dropZone.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          this.openLocalFile(e.dataTransfer.files[0]);
        }
      });
    },

    isOpen() {
      return this.dom.overlay && this.dom.overlay.classList.contains('active');
    },

    // =========================================================================
    // 3. Opening Documents
    // =========================================================================
    async open(file, options = {}) {
      if (!file) return;
      this.activeFile = file;

      // Extract filename & extension
      const fileName = file.fileName || file.name || file.title || 'document';
      const ext = fileName.split('.').pop().toLowerCase();
      const fileUrl = file.filePath || file.url || (file.path ? `/uploads/${window.activeWorkspaceId || 'default'}/${file.path}` : '');

      this.dom.title.textContent = file.title || fileName;
      this.dom.title.title = file.title || fileName;
      this.dom.sizeBadge.textContent = file.size || file.fileSize ? this.formatBytes(file.size || file.fileSize) : '';

      // Determine Document Type
      const isPdf = ext === 'pdf';
      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext);
      const isMarkdown = ['md', 'markdown'].includes(ext);
      const isText = ['txt', 'json', 'csv', 'js', 'ts', 'html', 'css', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'sql', 'xml', 'yaml', 'yml', 'env', 'sh', 'bat', 'log'].includes(ext);
      const isMedia = ['mp4', 'webm', 'ogg', 'mp3', 'wav', 'm4a'].includes(ext);

      if (isPdf) this.docType = 'pdf';
      else if (isImage) this.docType = 'image';
      else if (isMarkdown) this.docType = 'markdown';
      else if (isText) this.docType = 'text';
      else if (isMedia) this.docType = 'media';
      else this.docType = 'unsupported';

      // Update UI Header Icon
      this.updateHeaderIcon(ext);

      // Check Saved Progress ("Start Over / Resume Where Left Off")
      const savedProgress = ReadingProgressManager.getProgress(file);
      const shouldResume = !options.forceStartOver && savedProgress && (savedProgress.page > 1 || savedProgress.mediaTime > 5 || savedProgress.scrollTop > 50);

      // Show Overlay
      this.dom.overlay.classList.add('active');
      document.body.style.overflow = 'hidden';

      // Hide all stages
      this.hideAllStages();
      this.showLoading(true, `Loading ${fileName}...`);

      // Apply initial theme
      this.setTheme(savedProgress && savedProgress.theme ? savedProgress.theme : 'default');

      // Setup toolbar visibility based on type
      this.configureToolbarForDocType(this.docType);

      try {
        if (this.docType === 'pdf') {
          await this.loadPDF(fileUrl, file.rawFile, savedProgress, shouldResume);
        } else if (this.docType === 'image') {
          await this.loadImage(fileUrl, file.rawFile);
        } else if (this.docType === 'markdown') {
          await this.loadMarkdown(fileUrl, file.rawFile, savedProgress, shouldResume);
        } else if (this.docType === 'text') {
          await this.loadText(fileUrl, file.rawFile, ext, savedProgress, shouldResume);
        } else if (this.docType === 'media') {
          await this.loadMedia(fileUrl, file.rawFile, ext, savedProgress, shouldResume);
        } else {
          this.loadUnsupported(file, ext, fileUrl);
        }
      } catch (err) {
        console.error('[DocViewer] Error loading document:', err);
        this.showLoading(false);
        this.showToast(`Failed to open file: ${err.message}`, 'error');
        this.loadUnsupported(file, ext, fileUrl, err.message);
      }
    },

    openLocalFile(localFile) {
      if (!localFile) return;
      const fileObj = {
        title: localFile.name,
        fileName: localFile.name,
        name: localFile.name,
        size: localFile.size,
        type: 'file',
        rawFile: localFile,
        filePath: URL.createObjectURL(localFile)
      };
      this.open(fileObj);
    },

    hideAllStages() {
      const d = this.dom;
      d.pdfStage.style.display = 'none';
      d.textStage.style.display = 'none';
      d.markdownStage.style.display = 'none';
      d.imageStage.style.display = 'none';
      d.mediaStage.style.display = 'none';
      d.unsupportedStage.style.display = 'none';
    },

    configureToolbarForDocType(type) {
      const d = this.dom;
      const isPdf = type === 'pdf';
      d.navGroup.style.display = isPdf ? 'flex' : 'none';
      d.zoomGroup.style.display = (isPdf || type === 'image') ? 'flex' : 'none';
      d.btnRotate.style.display = (isPdf || type === 'image') ? 'inline-flex' : 'none';
      d.btnSearchToggle.style.display = isPdf ? 'inline-flex' : 'none';
      d.btnSidebarToggle.style.display = isPdf ? 'inline-flex' : 'none';

      // Always show Start Over if document type has progress capability
      d.btnStartOver.style.display = (isPdf || type === 'media' || type === 'text' || type === 'markdown') ? 'inline-flex' : 'none';

      if (!isPdf) {
        this.dom.sidebar.classList.remove('active');
        this.isSidebarOpen = false;
      }
    },

    updateHeaderIcon(ext) {
      const iconMap = {
        pdf: 'file-text',
        doc: 'file-text', docx: 'file-text', txt: 'file-text',
        md: 'book-open',
        js: 'file-code', ts: 'file-code', py: 'file-code', html: 'file-code', css: 'file-code', json: 'file-code',
        png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', svg: 'image', gif: 'image',
        mp4: 'video', webm: 'video', mp3: 'music', wav: 'music'
      };
      const iconName = iconMap[ext] || 'file';
      this.dom.icon.innerHTML = `<i data-lucide="${iconName}"></i>`;
      if (window.lucide) window.lucide.createIcons({ root: this.dom.icon });
    },

    showLoading(show, text = 'Loading...') {
      const d = this.dom;
      d.loadingText.textContent = text;
      d.loadingSpinner.style.display = show ? 'flex' : 'none';
    },

    showToast(message, type = 'info') {
      if (typeof window.showToast === 'function') {
        window.showToast(message, type);
      } else {
        console.log(`[Toast ${type}]: ${message}`);
      }
    },

    // =========================================================================
    // 4. PDF Engine (PDF.js Integration & Rendering)
    // =========================================================================
    async loadPDF(url, rawFile, savedProgress, shouldResume) {
      if (!window.pdfjsLib) {
        throw new Error('PDF.js library is not loaded.');
      }

      let loadingTask;
      if (rawFile) {
        const buffer = await rawFile.arrayBuffer();
        loadingTask = window.pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
      } else {
        loadingTask = window.pdfjsLib.getDocument({
          url: url,
          cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
          cMapPacked: true
        });
      }

      this.pdfDoc = await loadingTask.promise;
      this.totalPages = this.pdfDoc.numPages;
      this.dom.pageCount.textContent = this.totalPages;
      this.dom.pageInput.max = this.totalPages;

      // Handle "Resume Where You Left Off"
      let targetPage = 1;
      if (shouldResume && savedProgress && savedProgress.page) {
        targetPage = Math.min(Math.max(1, savedProgress.page), this.totalPages);
        this.showResumeBanner(savedProgress);
      } else {
        this.dom.resumeBanner.classList.remove('active');
      }

      this.currentPage = targetPage;
      this.rotation = 0;
      this.fitMode = 'page-width';
      this.thumbnailsRendered.clear();

      this.dom.pdfStage.style.display = 'block';
      this.showLoading(false);

      // Render Table of Contents / Outline & Thumbnails
      this.loadOutline();
      this.buildThumbnails();

      // Render Target Page
      await this.applyFitMode();
    },

    showResumeBanner(progress) {
      const d = this.dom;
      const pct = progress.percentage || Math.round((progress.page / progress.totalPages) * 100);
      d.resumeText.innerHTML = `Welcome back! You were on <strong>Page ${progress.page} of ${progress.totalPages}</strong> (${pct}% read).`;
      d.resumeBanner.classList.add('active');

      // Auto-hide banner after 8 seconds
      setTimeout(() => {
        d.resumeBanner.classList.remove('active');
      }, 8000);
    },

    async applyFitMode() {
      if (!this.pdfDoc || this.docType !== 'pdf') return;
      try {
        const page = await this.pdfDoc.getPage(this.currentPage);
        const viewportContainer = this.dom.viewport;
        const availableWidth = Math.max(300, viewportContainer.clientWidth - 48);
        const availableHeight = Math.max(300, viewportContainer.clientHeight - 48);

        const unscaledViewport = page.getViewport({ scale: 1.0, rotation: this.rotation });

        if (this.fitMode === 'page-width') {
          this.scale = availableWidth / unscaledViewport.width;
          this.dom.zoomSelect.value = 'width';
        } else if (this.fitMode === 'page-fit') {
          const scaleW = availableWidth / unscaledViewport.width;
          const scaleH = availableHeight / unscaledViewport.height;
          this.scale = Math.min(scaleW, scaleH);
          this.dom.zoomSelect.value = 'fit';
        } else {
          // Keep custom scale
        }

        await this.renderCurrentPage();
      } catch (err) {
        console.error('[DocViewer] Error fitting page:', err);
      }
    },

    async renderCurrentPage() {
      if (!this.pdfDoc || this.isRendering) {
        this.pendingPage = this.currentPage;
        return;
      }

      this.isRendering = true;
      const d = this.dom;
      const pageNum = this.currentPage;

      // Update Input & Progress Indicator
      d.pageInput.value = pageNum;
      const pct = Math.round((pageNum / this.totalPages) * 100);
      d.progressPill.textContent = `Page ${pageNum} of ${this.totalPages} (${pct}%)`;
      d.progressBar.style.width = `${pct}%`;

      // Update status bar
      d.statusInfo.textContent = `Page ${pageNum} of ${this.totalPages} • Zoom: ${Math.round(this.scale * 100)}%`;

      try {
        const page = await this.pdfDoc.getPage(pageNum);
        const pixelRatio = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: this.scale, rotation: this.rotation });

        const canvas = d.pdfCanvas;
        const ctx = canvas.getContext('2d');

        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

        if (this.renderTask) {
          try { this.renderTask.cancel(); } catch (e) { }
        }

        const renderContext = {
          canvasContext: ctx,
          viewport: viewport
        };

        this.renderTask = page.render(renderContext);
        await this.renderTask.promise;
        this.renderTask = null;

        // Auto Save Reading Progress
        ReadingProgressManager.saveProgress(this.activeFile, {
          page: pageNum,
          totalPages: this.totalPages,
          scale: this.scale,
          theme: this.theme
        });

        // Highlight Active Thumbnail
        this.updateActiveThumbnail(pageNum);

      } catch (err) {
        if (err && err.name !== 'RenderingCancelledException') {
          console.error('[DocViewer] Render error:', err);
        }
      } finally {
        this.isRendering = false;
        if (this.pendingPage !== null) {
          const next = this.pendingPage;
          this.pendingPage = null;
          if (next !== this.currentPage) {
            this.goToPage(next);
          }
        }
      }
    },

    goToPage(pageNum) {
      if (!this.pdfDoc) return;
      const target = Math.min(Math.max(1, pageNum), this.totalPages);
      if (target === this.currentPage && !this.pendingPage) return;
      this.currentPage = target;
      this.renderCurrentPage();
    },

    zoomStep(delta) {
      if (this.docType !== 'pdf' && this.docType !== 'image') return;
      this.fitMode = 'custom';
      this.scale = Math.min(Math.max(0.25, parseFloat((this.scale + delta).toFixed(2))), 3.5);

      // Update Select dropdown if matches
      const selectVal = this.scale.toString();
      const option = Array.from(this.dom.zoomSelect.options).find(o => Math.abs(parseFloat(o.value) - this.scale) < 0.05);
      if (option) this.dom.zoomSelect.value = option.value;
      else this.dom.zoomSelect.value = 'custom';

      if (this.docType === 'pdf') {
        this.renderCurrentPage();
      } else if (this.docType === 'image') {
        this.dom.imageEl.style.transform = `scale(${this.scale}) rotate(${this.rotation}deg)`;
      }
    },

    // =========================================================================
    // 5. "Start Over" Feature
    // =========================================================================
    startOver() {
      if (!this.activeFile) return;

      if (this.docType === 'pdf') {
        this.goToPage(1);
        ReadingProgressManager.saveProgress(this.activeFile, {
          page: 1,
          totalPages: this.totalPages,
          scale: this.scale,
          theme: this.theme
        });
        this.showToast('Restarted document from Page 1', 'rotate-ccw');
      } else if (this.docType === 'media') {
        const video = this.dom.mediaContainer.querySelector('video, audio');
        if (video) {
          video.currentTime = 0;
          video.play().catch(() => {});
        }
        ReadingProgressManager.saveProgress(this.activeFile, { mediaTime: 0 });
        this.showToast('Restarted playback from beginning', 'rotate-ccw');
      } else if (this.docType === 'text' || this.docType === 'markdown') {
        this.dom.viewport.scrollTo({ top: 0, behavior: 'smooth' });
        ReadingProgressManager.saveProgress(this.activeFile, { scrollTop: 0 });
        this.showToast('Scrolled back to top', 'rotate-ccw');
      }

      this.dom.resumeBanner.classList.remove('active');
    },

    // =========================================================================
    // 6. Thumbnails & Outline Sidebar
    // =========================================================================
    toggleSidebar(open) {
      if (typeof open === 'boolean') {
        this.isSidebarOpen = open;
      } else {
        this.isSidebarOpen = !this.isSidebarOpen;
      }
      this.dom.sidebar.classList.toggle('active', this.isSidebarOpen);
      this.dom.btnSidebarToggle.classList.toggle('active', this.isSidebarOpen);

      // Re-fit page width after sidebar toggle animation
      setTimeout(() => {
        if (this.fitMode !== 'custom') this.applyFitMode();
      }, 250);
    },

    switchSidebarTab(tab) {
      this.sidebarTab = tab;
      const d = this.dom;

      d.sidebarTabThumbs.classList.toggle('active', tab === 'thumbs');
      d.sidebarTabOutline.classList.toggle('active', tab === 'outline');
      d.sidebarTabInfo.classList.toggle('active', tab === 'info');

      d.thumbsPane.style.display = tab === 'thumbs' ? 'block' : 'none';
      d.outlinePane.style.display = tab === 'outline' ? 'block' : 'none';
      d.infoPane.style.display = tab === 'info' ? 'block' : 'none';

      if (tab === 'thumbs') {
        this.renderVisibleThumbnails();
      } else if (tab === 'info') {
        this.renderDocInfo();
      }
    },

    buildThumbnails() {
      const list = this.dom.thumbsList;
      list.innerHTML = '';
      if (!this.pdfDoc) return;

      const fragment = document.createDocumentFragment();
      for (let i = 1; i <= this.totalPages; i++) {
        const item = document.createElement('div');
        item.className = `dv-thumb-item ${i === this.currentPage ? 'active' : ''}`;
        item.dataset.page = i;
        item.innerHTML = `
          <div class="dv-thumb-canvas-wrap">
            <canvas id="dv-thumb-canvas-${i}"></canvas>
            <div class="dv-thumb-loader" id="dv-thumb-loader-${i}"><div class="dv-spinner-sm"></div></div>
          </div>
          <span class="dv-thumb-label">Page ${i}</span>
        `;

        item.addEventListener('click', () => {
          this.goToPage(i);
        });

        fragment.appendChild(item);
      }
      list.appendChild(fragment);

      // Observer to lazily render thumbnails when visible
      this.setupThumbnailObserver();
    },

    setupThumbnailObserver() {
      if (!('IntersectionObserver' in window)) {
        this.renderVisibleThumbnails();
        return;
      }

      if (this.thumbObserver) this.thumbObserver.disconnect();

      this.thumbObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const pageNum = parseInt(entry.target.dataset.page, 10);
            if (!isNaN(pageNum) && !this.thumbnailsRendered.has(pageNum)) {
              this.renderThumbnail(pageNum);
            }
          }
        });
      }, { root: this.dom.thumbsPane, rootMargin: '100px' });

      const thumbItems = this.dom.thumbsList.querySelectorAll('.dv-thumb-item');
      thumbItems.forEach(el => this.thumbObserver.observe(el));
    },

    async renderThumbnail(pageNum) {
      if (this.thumbnailsRendered.has(pageNum) || !this.pdfDoc) return;
      this.thumbnailsRendered.add(pageNum);

      const canvas = document.getElementById(`dv-thumb-canvas-${pageNum}`);
      const loader = document.getElementById(`dv-thumb-loader-${pageNum}`);
      if (!canvas) return;

      try {
        const page = await this.pdfDoc.getPage(pageNum);
        const unscaledViewport = page.getViewport({ scale: 1.0 });
        const scale = 140 / unscaledViewport.width;
        const viewport = page.getViewport({ scale });

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;

        if (loader) loader.style.display = 'none';
      } catch (err) {
        // Thumbnail render error ignored
      }
    },

    renderVisibleThumbnails() {
      const items = this.dom.thumbsList.querySelectorAll('.dv-thumb-item');
      items.forEach(item => {
        const pageNum = parseInt(item.dataset.page, 10);
        if (pageNum <= Math.min(10, this.totalPages)) {
          this.renderThumbnail(pageNum);
        }
      });
    },

    updateActiveThumbnail(pageNum) {
      const items = this.dom.thumbsList.querySelectorAll('.dv-thumb-item');
      items.forEach(el => {
        const p = parseInt(el.dataset.page, 10);
        const isActive = p === pageNum;
        el.classList.toggle('active', isActive);
        if (isActive && this.isSidebarOpen && this.sidebarTab === 'thumbs') {
          el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      });
    },

    async loadOutline() {
      const list = this.dom.outlineList;
      list.innerHTML = '';
      if (!this.pdfDoc) return;

      try {
        const outline = await this.pdfDoc.getOutline();
        if (!outline || outline.length === 0) {
          list.innerHTML = `<div class="dv-empty-notice"><i data-lucide="bookmark"></i><span>No bookmarks/outline found in this PDF</span></div>`;
          if (window.lucide) window.lucide.createIcons({ root: list });
          return;
        }

        const buildItems = (items, container) => {
          const ul = document.createElement('ul');
          ul.className = 'dv-outline-tree';
          items.forEach(item => {
            const li = document.createElement('li');
            li.className = 'dv-outline-node';
            li.innerHTML = `
              <div class="dv-outline-row" title="${this.escapeHTML(item.title)}">
                <i data-lucide="chevron-right" class="dv-outline-arrow"></i>
                <span class="dv-outline-title">${this.escapeHTML(item.title)}</span>
              </div>
            `;

            li.querySelector('.dv-outline-row').addEventListener('click', async () => {
              if (item.dest) {
                let pageIndex;
                if (typeof item.dest === 'string') {
                  const dest = await this.pdfDoc.getDestination(item.dest);
                  pageIndex = await this.pdfDoc.getPageIndex(dest[0]);
                } else {
                  pageIndex = await this.pdfDoc.getPageIndex(item.dest[0]);
                }
                this.goToPage(pageIndex + 1);
              }
            });

            if (item.items && item.items.length > 0) {
              buildItems(item.items, li);
            }
            ul.appendChild(li);
          });
          container.appendChild(ul);
        };

        buildItems(outline, list);
        if (window.lucide) window.lucide.createIcons({ root: list });
      } catch (err) {
        list.innerHTML = `<div class="dv-empty-notice">Could not load outline</div>`;
      }
    },

    renderDocInfo() {
      const file = this.activeFile;
      if (!file) return;
      const progress = ReadingProgressManager.getProgress(file);

      const d = this.dom.infoContent;
      const sizeStr = file.size || file.fileSize ? this.formatBytes(file.size || file.fileSize) : 'Unknown';
      const lastRead = progress && progress.lastReadAt ? new Date(progress.lastReadAt).toLocaleString() : 'Just now';
      const pct = progress ? `${progress.percentage}%` : '0%';

      d.innerHTML = `
        <div class="dv-info-card">
          <h4>Reading Status</h4>
          <div class="dv-info-row"><span>Progress:</span><strong>${pct}</strong></div>
          <div class="dv-info-row"><span>Current Page:</span><strong>Page ${this.currentPage} of ${this.totalPages}</strong></div>
          <div class="dv-info-row"><span>Last Read:</span><strong>${lastRead}</strong></div>
        </div>
        <div class="dv-info-card">
          <h4>File Details</h4>
          <div class="dv-info-row"><span>Name:</span><strong class="dv-truncate">${this.escapeHTML(file.fileName || file.name || file.title || '')}</strong></div>
          <div class="dv-info-row"><span>File Size:</span><strong>${sizeStr}</strong></div>
          <div class="dv-info-row"><span>Type:</span><strong>${(this.docType || '').toUpperCase()}</strong></div>
        </div>
      `;
    },

    // =========================================================================
    // 7. Text Search in PDF
    // =========================================================================
    toggleSearch(show) {
      const bar = this.dom.searchBar;
      const isVisible = bar.classList.contains('active');
      const target = typeof show === 'boolean' ? show : !isVisible;

      bar.classList.toggle('active', target);
      this.dom.btnSearchToggle.classList.toggle('active', target);

      if (target) {
        setTimeout(() => this.dom.searchInput.focus(), 50);
      } else {
        this.searchMatches = [];
        this.dom.searchMatchInfo.textContent = '';
      }
    },

    async performSearch(query) {
      if (!query || query.trim().length < 2 || !this.pdfDoc) {
        this.searchMatches = [];
        this.dom.searchMatchInfo.textContent = '';
        return;
      }

      const q = query.trim().toLowerCase();
      this.dom.searchMatchInfo.textContent = 'Searching...';

      const matches = [];
      for (let i = 1; i <= this.totalPages; i++) {
        try {
          const page = await this.pdfDoc.getPage(i);
          const content = await page.getTextContent();
          const text = content.items.map(s => s.str).join(' ').toLowerCase();
          let pos = text.indexOf(q);
          while (pos !== -1) {
            matches.push({ page: i, index: pos });
            pos = text.indexOf(q, pos + q.length);
          }
        } catch (e) { }
      }

      this.searchMatches = matches;
      if (matches.length > 0) {
        this.currentMatchIndex = 0;
        this.dom.searchMatchInfo.textContent = `1 of ${matches.length}`;
        this.goToPage(matches[0].page);
      } else {
        this.currentMatchIndex = -1;
        this.dom.searchMatchInfo.textContent = '0 matches';
      }
    },

    searchNavigate(dir) {
      if (!this.searchMatches.length) return;
      this.currentMatchIndex = (this.currentMatchIndex + dir + this.searchMatches.length) % this.searchMatches.length;
      const match = this.searchMatches[this.currentMatchIndex];
      this.dom.searchMatchInfo.textContent = `${this.currentMatchIndex + 1} of ${this.searchMatches.length}`;
      this.goToPage(match.page);
    },

    // =========================================================================
    // 8. Other File Handlers: Text, Markdown, Image, Media
    // =========================================================================
    async loadText(url, rawFile, ext, savedProgress, shouldResume) {
      let text = '';
      if (rawFile) {
        text = await rawFile.text();
      } else {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        text = await res.text();
      }

      this.dom.textStage.style.display = 'block';
      this.showLoading(false);

      const lines = text.split('\n');
      const linesHTML = lines.map((line, idx) => `
        <div class="dv-code-line">
          <span class="dv-line-no">${idx + 1}</span>
          <span class="dv-line-code">${this.escapeHTML(line) || '&nbsp;'}</span>
        </div>
      `).join('');

      this.dom.textContent.innerHTML = linesHTML;

      // Handle resume scroll
      if (shouldResume && savedProgress && savedProgress.scrollTop) {
        setTimeout(() => {
          this.dom.viewport.scrollTo({ top: savedProgress.scrollTop, behavior: 'smooth' });
        }, 100);
      }

      // Track scroll position
      this.bindViewportScrollTracking();
    },

    async loadMarkdown(url, rawFile, savedProgress, shouldResume) {
      let text = '';
      if (rawFile) {
        text = await rawFile.text();
      } else {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        text = await res.text();
      }

      this.dom.markdownStage.style.display = 'block';
      this.showLoading(false);

      // Render Markdown
      this.dom.markdownRendered.innerHTML = this.renderMarkdownToHTML(text);
      this.dom.markdownRaw.textContent = text;
      this.dom.markdownRaw.style.display = 'none';

      if (shouldResume && savedProgress && savedProgress.scrollTop) {
        setTimeout(() => {
          this.dom.viewport.scrollTo({ top: savedProgress.scrollTop, behavior: 'smooth' });
        }, 100);
      }

      this.bindViewportScrollTracking();
    },

    async loadImage(url, rawFile) {
      const img = this.dom.imageEl;
      let src = url;
      if (rawFile) {
        src = URL.createObjectURL(rawFile);
      }

      return new Promise((resolve, reject) => {
        img.onload = () => {
          this.dom.imageStage.style.display = 'flex';
          this.showLoading(false);
          this.scale = 1.0;
          this.rotation = 0;
          img.style.transform = `scale(1) rotate(0deg)`;
          this.dom.statusInfo.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
          resolve();
        };
        img.onerror = () => reject(new Error('Failed to load image.'));
        img.src = src;
      });
    },

    async loadMedia(url, rawFile, ext, savedProgress, shouldResume) {
      const isVideo = ['mp4', 'webm', 'ogg'].includes(ext);
      let src = url;
      if (rawFile) {
        src = URL.createObjectURL(rawFile);
      }

      const container = this.dom.mediaContainer;
      container.innerHTML = isVideo ? `
        <video class="dv-video-player" controls autoplay playsinline src="${src}"></video>
      ` : `
        <div class="dv-audio-wrap">
          <div class="dv-audio-icon"><i data-lucide="music"></i></div>
          <audio class="dv-audio-player" controls autoplay src="${src}"></audio>
        </div>
      `;

      if (window.lucide) window.lucide.createIcons({ root: container });

      this.dom.mediaStage.style.display = 'flex';
      this.showLoading(false);

      const mediaEl = container.querySelector('video, audio');
      if (mediaEl) {
        if (shouldResume && savedProgress && savedProgress.mediaTime > 2) {
          mediaEl.currentTime = savedProgress.mediaTime;
          this.showToast(`Resumed playback at ${this.formatTime(savedProgress.mediaTime)}`, 'play');
        }

        // Save progress every 3 seconds
        mediaEl.addEventListener('timeupdate', () => {
          if (mediaEl.currentTime > 2) {
            ReadingProgressManager.saveProgress(this.activeFile, {
              mediaTime: Math.floor(mediaEl.currentTime),
              totalPages: Math.floor(mediaEl.duration || 100),
              page: Math.floor(mediaEl.currentTime)
            });
          }
        });
      }
    },

    loadUnsupported(file, ext, fileUrl, errMessage = '') {
      this.dom.unsupportedStage.style.display = 'flex';
      this.showLoading(false);

      const fileName = file.fileName || file.name || file.title || 'file';
      const sizeStr = file.size || file.fileSize ? this.formatBytes(file.size || file.fileSize) : '';

      this.dom.unsupportedInfo.innerHTML = `
        <div class="dv-unsupported-card">
          <i data-lucide="file-question" class="dv-unsupported-icon"></i>
          <h3>Preview Not Available for .${ext.toUpperCase()}</h3>
          <p>${errMessage || 'This file type cannot be rendered directly in the embedded canvas. You can download it or open it in an external application.'}</p>
          <div class="dv-unsupported-meta">
            <span><strong>File:</strong> ${this.escapeHTML(fileName)}</span>
            ${sizeStr ? `<span><strong>Size:</strong> ${sizeStr}</span>` : ''}
          </div>
          <div class="dv-unsupported-actions">
            <a href="${fileUrl}" download="${this.escapeHTML(fileName)}" class="btn btn-primary">
              <i data-lucide="download"></i>
              <span>Download File</span>
            </a>
            <a href="${fileUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">
              <i data-lucide="external-link"></i>
              <span>Open in New Tab</span>
            </a>
          </div>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons({ root: this.dom.unsupportedInfo });
    },

    bindViewportScrollTracking() {
      let scrollTimer = null;
      this.dom.viewport.onscroll = () => {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
          if (!this.activeFile || this.docType === 'pdf') return;
          const top = this.dom.viewport.scrollTop;
          const height = this.dom.viewport.scrollHeight - this.dom.viewport.clientHeight;
          const pct = height > 0 ? Math.round((top / height) * 100) : 0;

          this.dom.progressBar.style.width = `${pct}%`;
          this.dom.progressPill.textContent = `${pct}% read`;

          ReadingProgressManager.saveProgress(this.activeFile, {
            scrollTop: top,
            percentage: pct,
            theme: this.theme
          });
        }, 300);
      };
    },

    // =========================================================================
    // 9. Themes, Fullscreen, and Downloads
    // =========================================================================
    cycleTheme() {
      const themes = ['default', 'dark', 'sepia'];
      const nextIdx = (themes.indexOf(this.theme) + 1) % themes.length;
      this.setTheme(themes[nextIdx]);
    },

    setTheme(themeName) {
      this.theme = themeName || 'default';
      const overlay = this.dom.overlay;
      overlay.classList.remove('theme-dark', 'theme-sepia');
      if (this.theme === 'dark') overlay.classList.add('theme-dark');
      else if (this.theme === 'sepia') overlay.classList.add('theme-sepia');

      const label = this.theme === 'dark' ? 'Night (Dark)' : this.theme === 'sepia' ? 'Eye-care (Sepia)' : 'Original (Light)';
      this.dom.btnTheme.title = `Reading Theme: ${label}`;

      if (this.activeFile) {
        ReadingProgressManager.saveProgress(this.activeFile, { theme: this.theme });
      }
    },

    toggleFullscreen() {
      const overlay = this.dom.overlay;
      if (!document.fullscreenElement) {
        overlay.requestFullscreen().then(() => {
          this.isFullscreen = true;
          this.dom.btnFullscreen.innerHTML = `<i data-lucide="minimize"></i>`;
          if (window.lucide) window.lucide.createIcons({ root: this.dom.btnFullscreen });
        }).catch(() => {
          overlay.classList.toggle('maximized');
        });
      } else {
        document.exitFullscreen().then(() => {
          this.isFullscreen = false;
          this.dom.btnFullscreen.innerHTML = `<i data-lucide="maximize"></i>`;
          if (window.lucide) window.lucide.createIcons({ root: this.dom.btnFullscreen });
        }).catch(() => {});
      }
    },

    downloadActiveFile() {
      if (!this.activeFile) return;
      const file = this.activeFile;
      const url = file.filePath || file.url || (file.path ? `/uploads/${window.activeWorkspaceId || 'default'}/${file.path}` : '');
      const name = file.fileName || file.name || file.title || 'download';
      if (!url) return;

      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      this.showToast(`Downloading ${name}...`, 'download');
    },

    close() {
      const d = this.dom;
      if (!d.overlay) return;

      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }

      d.overlay.classList.remove('active');
      document.body.style.overflow = '';

      // Stop any video/audio
      const media = d.mediaContainer.querySelectorAll('video, audio');
      media.forEach(m => {
        try { m.pause(); m.src = ''; } catch (e) {}
      });

      // Clear canvas & pdf
      if (this.renderTask) {
        try { this.renderTask.cancel(); } catch (e) {}
      }
      this.pdfDoc = null;
      this.activeFile = null;
      d.resumeBanner.classList.remove('active');
    },

    // =========================================================================
    // 10. Simple Markdown Renderer
    // =========================================================================
    renderMarkdownToHTML(md) {
      if (!md) return '';
      let html = md;

      // Escape HTML tags to prevent XSS
      html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      // Code blocks ```code```
      html = html.replace(/```([a-z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
        return `<pre class="dv-md-code-block"><code class="lang-${lang}">${code}</code></pre>`;
      });

      // Inline code `code`
      html = html.replace(/`([^`]+)`/g, '<code class="dv-md-inline-code">$1</code>');

      // Headers # to ######
      html = html.replace(/^###### (.*$)/gim, '<h6>$1</h6>');
      html = html.replace(/^##### (.*$)/gim, '<h5>$1</h5>');
      html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
      html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
      html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
      html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

      // Bold & Italic
      html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
      html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

      // Blockquotes
      html = html.replace(/^\> (.*$)/gim, '<blockquote class="dv-md-blockquote">$1</blockquote>');

      // Unordered lists
      html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>');
      html = html.replace(/(<li>.*<\/li>)/gims, '<ul class="dv-md-list">$1</ul>');

      // Links [text](url)
      html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

      // Paragraphs
      html = html.split('\n\n').map(p => {
        if (p.startsWith('<h') || p.startsWith('<pre') || p.startsWith('<ul') || p.startsWith('<block')) return p;
        return `<p>${p.replace(/\n/g, '<br>')}</p>`;
      }).join('\n');

      return html;
    },

    // Helpers
    formatBytes(bytes) {
      if (!bytes || bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    },

    formatTime(seconds) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    },

    escapeHTML(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
  };

  // Expose WorkspaceViewer globally
  window.WorkspaceViewer = WorkspaceViewer;

  // Auto-init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => WorkspaceViewer.init());
  } else {
    WorkspaceViewer.init();
  }

})();
