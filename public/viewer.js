/**
 * Workspace Hub — Dedicated PDF & File Viewer ("Workspace DocViewer")
 * Features:
 *  - Continuous Vertical Scrolling through all pages with mouse wheel, trackpad, and touch
 *  - Main Bar Controls: Next/Prev buttons, direct page jump input, first/last page
 *  - Real-time Scroll Sync: As you scroll through pages, the main bar automatically updates
 *  - Automatic Reading Progress persistence ("Start over / Resume where I left off")
 *  - Smart Resume Banner & "Start Over from Beginning" button
 *  - High-performance Lazy Canvas rendering via Mozilla PDF.js with HiDPI support
 *  - Interactive Thumbnails sidebar with active page highlight
 *  - PDF Table of Contents / Outline navigation
 *  - In-document text search with match counts
 *  - Zoom presets (Fit Width, Fit Page, 50%-300%), 90-degree rotate
 *  - Reading themes: Default, Dark Mode (inverted for night reading), Warm Sepia
 *  - Multi-format support: Text & Code, Markdown, Images, Audio/Video with timestamp memory
 *  - Universal "Open Local File" drag-and-drop & file picker
 *  - Fullscreen mode & keyboard navigation
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

        // Update in-memory item if it exists in dbData
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
  // 2. Annotation & Drawing Engine (Writing, Drawing, Shapes, Notes)
  // =========================================================================
  const AnnotationManager = {
    activeTool: 'select', // 'select', 'pen', 'highlighter', 'text', 'rect', 'circle', 'arrow', 'eraser'
    activeColor: '#f43f5e',
    activeWidth: 3,
    isAnnotating: false,

    // Per-file cached annotations: { [pageNum]: [ ...items ] }
    pageAnnotations: {},

    // Undo / Redo stacks per page: { [pageNum]: [ state1, state2, ... ] }
    undoStacks: {},
    redoStacks: {},

    // Transient drawing state
    drawingState: null,

    init() {
      this.bindToolbarEvents();
    },

    resetForFile(file) {
      this.pageAnnotations = {};
      this.undoStacks = {};
      this.redoStacks = {};
      this.drawingState = null;
      this.loadAllAnnotations(file);
    },

    getStorageKey(file) {
      if (!file) return 'workspace_doc_annotations_unknown';
      if (file.id) return `workspace_doc_annotations_id_${file.id}`;
      const pathOrName = file.filePath || file.path || file.fileName || file.name || file.url || 'temp';
      return `workspace_doc_annotations_${encodeURIComponent(pathOrName)}`;
    },

    loadAllAnnotations(file) {
      if (!file) return;
      try {
        const raw = localStorage.getItem(this.getStorageKey(file));
        if (raw) {
          const parsed = JSON.parse(raw);
          this.pageAnnotations = parsed.pages || {};
        } else {
          this.pageAnnotations = {};
        }
      } catch (e) {
        console.warn('[DocViewer Annotations] Failed to load:', e);
        this.pageAnnotations = {};
      }
    },

    saveAllAnnotations(file) {
      if (!file) return;
      try {
        const payload = {
          fileId: file.id || null,
          title: file.title || file.fileName || file.name || 'Document',
          updatedAt: new Date().toISOString(),
          pages: this.pageAnnotations
        };
        localStorage.setItem(this.getStorageKey(file), JSON.stringify(payload));
      } catch (e) {
        console.warn('[DocViewer Annotations] Failed to save:', e);
      }
    },

    getPageItems(pageNum) {
      if (!this.pageAnnotations[pageNum]) {
        this.pageAnnotations[pageNum] = [];
      }
      return this.pageAnnotations[pageNum];
    },

    pushHistoryState(pageNum) {
      if (!this.undoStacks[pageNum]) this.undoStacks[pageNum] = [];
      const currentItems = JSON.parse(JSON.stringify(this.getPageItems(pageNum)));
      this.undoStacks[pageNum].push(currentItems);
      if (this.undoStacks[pageNum].length > 40) {
        this.undoStacks[pageNum].shift();
      }
      this.redoStacks[pageNum] = [];
    },

    undo(pageNum) {
      pageNum = pageNum || WorkspaceViewer.currentPage;
      if (!this.undoStacks[pageNum] || this.undoStacks[pageNum].length === 0) {
        WorkspaceViewer.showToast('Nothing to undo on this page', 'info');
        return;
      }
      if (!this.redoStacks[pageNum]) this.redoStacks[pageNum] = [];
      const currentItems = JSON.parse(JSON.stringify(this.getPageItems(pageNum)));
      this.redoStacks[pageNum].push(currentItems);

      const prevState = this.undoStacks[pageNum].pop();
      this.pageAnnotations[pageNum] = prevState;
      this.saveAllAnnotations(WorkspaceViewer.activeFile);
      this.redrawPage(pageNum);
      this.renderTextNotes(pageNum);
      WorkspaceViewer.showToast(`Undone on Page ${pageNum}`, 'info');
    },

    redo(pageNum) {
      pageNum = pageNum || WorkspaceViewer.currentPage;
      if (!this.redoStacks[pageNum] || this.redoStacks[pageNum].length === 0) {
        WorkspaceViewer.showToast('Nothing to redo on this page', 'info');
        return;
      }
      if (!this.undoStacks[pageNum]) this.undoStacks[pageNum] = [];
      const currentItems = JSON.parse(JSON.stringify(this.getPageItems(pageNum)));
      this.undoStacks[pageNum].push(currentItems);

      const nextState = this.redoStacks[pageNum].pop();
      this.pageAnnotations[pageNum] = nextState;
      this.saveAllAnnotations(WorkspaceViewer.activeFile);
      this.redrawPage(pageNum);
      this.renderTextNotes(pageNum);
      WorkspaceViewer.showToast(`Redone on Page ${pageNum}`, 'info');
    },

    clearPage(pageNum) {
      pageNum = pageNum || WorkspaceViewer.currentPage;
      const items = this.getPageItems(pageNum);
      if (!items || items.length === 0) {
        WorkspaceViewer.showToast(`Page ${pageNum} has no annotations`, 'info');
        return;
      }
      this.pushHistoryState(pageNum);
      this.pageAnnotations[pageNum] = [];
      this.saveAllAnnotations(WorkspaceViewer.activeFile);
      this.redrawPage(pageNum);
      this.renderTextNotes(pageNum);
      WorkspaceViewer.showToast(`Cleared drawings & notes on Page ${pageNum}`, 'info');
    },

    toggleToolbar(force) {
      const tb = document.getElementById('dv-annotation-toolbar');
      const btnToggle = document.getElementById('dv-btn-toggle-annotate');
      const overlay = WorkspaceViewer.dom.overlay;
      if (!tb || !overlay) return;

      const shouldShow = force !== undefined ? force : (tb.style.display === 'none' || !tb.style.display);
      this.isAnnotating = shouldShow;

      if (shouldShow) {
        tb.style.display = 'flex';
        overlay.classList.add('dv-annotating-mode');
        overlay.dataset.activeTool = this.activeTool;
        if (btnToggle) btnToggle.classList.add('active');
        if (this.activeTool === 'select') {
          this.setTool('pen');
        }
        WorkspaceViewer.showToast('Annotation Editor enabled: Draw, write, and highlight!', 'edit');
      } else {
        tb.style.display = 'none';
        overlay.classList.remove('dv-annotating-mode');
        if (btnToggle) btnToggle.classList.remove('active');
      }
    },

    setTool(toolName) {
      this.activeTool = toolName;
      const overlay = WorkspaceViewer.dom.overlay;
      if (overlay) {
        overlay.dataset.activeTool = toolName;
      }

      const buttons = document.querySelectorAll('.dv-annot-tool-btn');
      buttons.forEach(btn => {
        if (btn.dataset.tool === toolName) btn.classList.add('active');
        else btn.classList.remove('active');
      });

      const toolTips = {
        select: 'Pan / Scroll Mode (Hand)',
        pen: 'Freehand Pen (Draw anywhere)',
        highlighter: 'Highlighter (Mark text & lines)',
        text: 'Text Mode (Click to place sticky note)',
        rect: 'Rectangle Shape (Drag to box)',
        circle: 'Circle Shape (Drag to circle)',
        arrow: 'Arrow Pointer (Drag to point)',
        eraser: 'Eraser (Click or drag over drawings)'
      };
      if (toolTips[toolName]) {
        WorkspaceViewer.showToast(toolTips[toolName], 'info');
      }
    },

    bindToolbarEvents() {
      const btnToggle = document.getElementById('dv-btn-toggle-annotate');
      if (btnToggle) {
        btnToggle.addEventListener('click', () => this.toggleToolbar());
      }

      const btnClose = document.getElementById('dv-btn-close-annot');
      if (btnClose) {
        btnClose.addEventListener('click', () => this.toggleToolbar(false));
      }

      document.querySelectorAll('.dv-annot-tool-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const tool = btn.dataset.tool;
          if (tool) this.setTool(tool);
        });
      });

      document.querySelectorAll('.dv-color-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const color = btn.dataset.color;
          if (color) {
            this.activeColor = color;
            document.querySelectorAll('.dv-color-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
          }
        });
      });

      const customColorInput = document.getElementById('dv-annot-custom-color');
      if (customColorInput) {
        customColorInput.addEventListener('input', (e) => {
          this.activeColor = e.target.value;
          document.querySelectorAll('.dv-color-btn').forEach(b => b.classList.remove('active'));
        });
      }

      document.querySelectorAll('.dv-stroke-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const w = parseInt(btn.dataset.width, 10);
          if (!isNaN(w)) {
            this.activeWidth = w;
            document.querySelectorAll('.dv-stroke-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
          }
        });
      });

      const btnUndo = document.getElementById('dv-btn-undo');
      if (btnUndo) btnUndo.addEventListener('click', () => this.undo());

      const btnRedo = document.getElementById('dv-btn-redo');
      if (btnRedo) btnRedo.addEventListener('click', () => this.redo());

      const btnClear = document.getElementById('dv-btn-clear-annot');
      if (btnClear) btnClear.addEventListener('click', () => this.clearPage());
    },

    attachCanvasListeners(pageNum, canvas, textLayer) {
      if (!canvas || canvas.dataset.annotBound === 'true') return;
      canvas.dataset.annotBound = 'true';

      canvas.addEventListener('pointerdown', (e) => {
        if (this.activeTool === 'select') return;
        e.preventDefault();
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}

        const rect = canvas.getBoundingClientRect();
        const rawX = e.clientX - rect.left;
        const rawY = e.clientY - rect.top;
        const normX = Math.max(0, Math.min(1, rawX / canvas.clientWidth));
        const normY = Math.max(0, Math.min(1, rawY / canvas.clientHeight));

        if (this.activeTool === 'text') {
          this.createTextNote(pageNum, normX, normY);
          return;
        }

        if (this.activeTool === 'eraser') {
          this.eraseAtPoint(pageNum, normX, normY, canvas);
          this.drawingState = {
            pageNum,
            canvas,
            isDown: true,
            tool: 'eraser'
          };
          return;
        }

        this.drawingState = {
          pageNum,
          canvas,
          isDown: true,
          tool: this.activeTool,
          color: this.activeColor,
          width: this.activeWidth,
          points: [{ x: normX, y: normY }],
          start: { x: normX, y: normY }
        };
      });

      canvas.addEventListener('pointermove', (e) => {
        if (!this.drawingState || !this.drawingState.isDown) return;
        e.preventDefault();

        const rect = canvas.getBoundingClientRect();
        const rawX = e.clientX - rect.left;
        const rawY = e.clientY - rect.top;
        const normX = Math.max(0, Math.min(1, rawX / canvas.clientWidth));
        const normY = Math.max(0, Math.min(1, rawY / canvas.clientHeight));

        if (this.drawingState.tool === 'eraser') {
          this.eraseAtPoint(pageNum, normX, normY, canvas);
          return;
        }

        const ds = this.drawingState;
        const ctx = canvas.getContext('2d');

        if (ds.tool === 'pen' || ds.tool === 'highlighter') {
          const prevPoint = ds.points[ds.points.length - 1];
          ds.points.push({ x: normX, y: normY });

          ctx.save();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          const wScale = canvas.width / 800;
          if (ds.tool === 'highlighter') {
            ctx.globalAlpha = 0.38;
            ctx.strokeStyle = ds.color;
            ctx.lineWidth = Math.max(12, ds.width * 3.5 * wScale);
          } else {
            ctx.globalAlpha = 1.0;
            ctx.strokeStyle = ds.color;
            ctx.lineWidth = Math.max(1.5, ds.width * wScale);
          }

          ctx.beginPath();
          ctx.moveTo(prevPoint.x * canvas.width, prevPoint.y * canvas.height);
          ctx.lineTo(normX * canvas.width, normY * canvas.height);
          ctx.stroke();
          ctx.restore();

        } else if (ds.tool === 'rect' || ds.tool === 'circle' || ds.tool === 'arrow') {
          this.redrawPage(pageNum);

          ctx.save();
          ctx.strokeStyle = ds.color;
          const wScale = canvas.width / 800;
          ctx.lineWidth = Math.max(1.5, ds.width * wScale);
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          const startX = ds.start.x * canvas.width;
          const startY = ds.start.y * canvas.height;
          const curX = normX * canvas.width;
          const curY = normY * canvas.height;

          if (ds.tool === 'rect') {
            ctx.strokeRect(startX, startY, curX - startX, curY - startY);
          } else if (ds.tool === 'circle') {
            const rx = Math.abs(curX - startX) / 2;
            const ry = Math.abs(curY - startY) / 2;
            const cx = Math.min(startX, curX) + rx;
            const cy = Math.min(startY, curY) + ry;
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            ctx.stroke();
          } else if (ds.tool === 'arrow') {
            this.drawArrow(ctx, startX, startY, curX, curY, ctx.lineWidth);
          }

          ctx.restore();
        }
      });

      const endDrawing = (e) => {
        if (!this.drawingState || !this.drawingState.isDown) return;
        const ds = this.drawingState;
        this.drawingState = null;

        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}

        if (ds.tool === 'eraser') return;

        const rect = canvas.getBoundingClientRect();
        const rawX = e.clientX - rect.left;
        const rawY = e.clientY - rect.top;
        const normX = Math.max(0, Math.min(1, rawX / canvas.clientWidth));
        const normY = Math.max(0, Math.min(1, rawY / canvas.clientHeight));

        this.pushHistoryState(pageNum);
        const items = this.getPageItems(pageNum);

        if (ds.tool === 'pen' || ds.tool === 'highlighter') {
          if (ds.points.length > 0) {
            items.push({
              id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
              type: ds.tool,
              color: ds.color,
              width: ds.width,
              points: ds.points
            });
          }
        } else if (ds.tool === 'rect' || ds.tool === 'circle' || ds.tool === 'arrow') {
          items.push({
            id: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            type: ds.tool,
            color: ds.color,
            width: ds.width,
            start: ds.start,
            end: { x: normX, y: normY }
          });
        }

        this.saveAllAnnotations(WorkspaceViewer.activeFile);
        this.redrawPage(pageNum);
      };

      canvas.addEventListener('pointerup', endDrawing);
      canvas.addEventListener('pointercancel', endDrawing);
    },

    drawArrow(ctx, startX, startY, endX, endY, lineWidth) {
      const angle = Math.atan2(endY - startY, endX - startX);
      const headLen = Math.max(12, lineWidth * 3.5);

      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(endX - headLen * Math.cos(angle - Math.PI / 6), endY - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(endX - headLen * Math.cos(angle + Math.PI / 6), endY - headLen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    },

    distToSegment(p, v, w) {
      const l2 = (v.x - w.x) * (v.x - w.x) + (v.y - w.y) * (v.y - w.y);
      if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
      let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
    },

    eraseAtPoint(pageNum, normX, normY, canvas) {
      const items = this.getPageItems(pageNum);
      if (!items || items.length === 0) return;

      const hitDist = 20 / Math.max(400, canvas.clientWidth);
      const p = { x: normX, y: normY };

      let removedAny = false;
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        let hit = false;

        if (item.type === 'pen' || item.type === 'highlighter') {
          if (item.points) {
            for (let j = 0; j < item.points.length - 1; j++) {
              if (this.distToSegment(p, item.points[j], item.points[j + 1]) < hitDist) {
                hit = true;
                break;
              }
            }
          }
        } else if (item.type === 'rect') {
          const minX = Math.min(item.start.x, item.end.x);
          const maxX = Math.max(item.start.x, item.end.x);
          const minY = Math.min(item.start.y, item.end.y);
          const maxY = Math.max(item.start.y, item.end.y);
          if (normX >= minX - hitDist && normX <= maxX + hitDist &&
              normY >= minY - hitDist && normY <= maxY + hitDist) {
            hit = true;
          }
        } else if (item.type === 'circle') {
          const cx = (item.start.x + item.end.x) / 2;
          const cy = (item.start.y + item.end.y) / 2;
          const rx = Math.abs(item.end.x - item.start.x) / 2;
          const ry = Math.abs(item.end.y - item.start.y) / 2;
          const dx = (normX - cx) / (rx + 0.001);
          const dy = (normY - cy) / (ry + 0.001);
          const d = Math.sqrt(dx * dx + dy * dy);
          if (Math.abs(d - 1.0) < hitDist * 4 || d < 1.0) {
            hit = true;
          }
        } else if (item.type === 'arrow') {
          if (this.distToSegment(p, item.start, item.end) < hitDist * 2) {
            hit = true;
          }
        }

        if (hit) {
          if (!removedAny) this.pushHistoryState(pageNum);
          items.splice(i, 1);
          removedAny = true;
        }
      }

      if (removedAny) {
        this.saveAllAnnotations(WorkspaceViewer.activeFile);
        this.redrawPage(pageNum);
      }
    },

    redrawPage(pageNum) {
      const canvas = document.getElementById(`dv-annotation-canvas-${pageNum}`);
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const items = this.getPageItems(pageNum);
      if (!items || items.length === 0) return;

      const wScale = canvas.width / 800;

      for (const item of items) {
        if (item.type === 'text') continue;

        if (item.type === 'texthl') {
          ctx.save();
          ctx.globalAlpha = 0.4;
          ctx.fillStyle = item.color || '#facc15';
          for (const r of (item.rects || [])) {
            ctx.fillRect(r.x * canvas.width, r.y * canvas.height, r.w * canvas.width, r.h * canvas.height);
          }
          ctx.restore();
          continue;
        }

        ctx.save();
        ctx.strokeStyle = item.color || '#f43f5e';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (item.type === 'highlighter') {
          ctx.globalAlpha = 0.38;
          ctx.lineWidth = Math.max(12, (item.width || 4) * 3.5 * wScale);
        } else {
          ctx.globalAlpha = 1.0;
          ctx.lineWidth = Math.max(1.5, (item.width || 2) * wScale);
        }

        if (item.type === 'pen' || item.type === 'highlighter') {
          if (item.points && item.points.length > 1) {
            ctx.beginPath();
            ctx.moveTo(item.points[0].x * canvas.width, item.points[0].y * canvas.height);
            for (let i = 1; i < item.points.length; i++) {
              ctx.lineTo(item.points[i].x * canvas.width, item.points[i].y * canvas.height);
            }
            ctx.stroke();
          } else if (item.points && item.points.length === 1) {
            ctx.beginPath();
            ctx.arc(item.points[0].x * canvas.width, item.points[0].y * canvas.height, ctx.lineWidth / 2, 0, Math.PI * 2);
            ctx.fillStyle = ctx.strokeStyle;
            ctx.fill();
          }
        } else if (item.type === 'rect') {
          const sx = item.start.x * canvas.width;
          const sy = item.start.y * canvas.height;
          const ex = item.end.x * canvas.width;
          const ey = item.end.y * canvas.height;
          ctx.strokeRect(sx, sy, ex - sx, ey - sy);
        } else if (item.type === 'circle') {
          const sx = item.start.x * canvas.width;
          const sy = item.start.y * canvas.height;
          const ex = item.end.x * canvas.width;
          const ey = item.end.y * canvas.height;
          const rx = Math.abs(ex - sx) / 2;
          const ry = Math.abs(ey - sy) / 2;
          const cx = Math.min(sx, ex) + rx;
          const cy = Math.min(sy, ey) + ry;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else if (item.type === 'arrow') {
          const sx = item.start.x * canvas.width;
          const sy = item.start.y * canvas.height;
          const ex = item.end.x * canvas.width;
          const ey = item.end.y * canvas.height;
          this.drawArrow(ctx, sx, sy, ex, ey, ctx.lineWidth);
        }

        ctx.restore();
      }
    },

    createTextNote(pageNum, normX, normY, initialText = '') {
      this.pushHistoryState(pageNum);
      const items = this.getPageItems(pageNum);
      const noteId = 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

      const noteItem = {
        id: noteId,
        type: 'text',
        color: this.activeColor,
        x: Math.min(0.85, normX),
        y: Math.min(0.9, normY),
        text: initialText
      };

      items.push(noteItem);
      this.saveAllAnnotations(WorkspaceViewer.activeFile);
      this.renderTextNotes(pageNum);

      setTimeout(() => {
        const noteEl = document.getElementById(noteId);
        if (noteEl) {
          const editable = noteEl.querySelector('.dv-text-note-content');
          if (editable) editable.focus();
        }
      }, 30);
    },

    renderTextNotes(pageNum) {
      const container = document.getElementById(`dv-text-annotations-${pageNum}`);
      if (!container) return;
      container.innerHTML = '';

      const items = this.getPageItems(pageNum);
      const textItems = items.filter(it => it.type === 'text');

      for (const item of textItems) {
        const el = document.createElement('div');
        el.className = 'dv-text-note-box';
        el.id = item.id;
        el.style.left = `${(item.x * 100).toFixed(2)}%`;
        el.style.top = `${(item.y * 100).toFixed(2)}%`;
        el.style.setProperty('--note-color', item.color || '#f43f5e');

        el.innerHTML = `
          <div class="dv-text-note-header">
            <span class="dv-text-note-drag" title="Drag to reposition">
              <i data-lucide="grip-horizontal"></i> Note
            </span>
            <button type="button" class="dv-text-note-delete" title="Delete note">
              <i data-lucide="x"></i>
            </button>
          </div>
          <div class="dv-text-note-content" contenteditable="true" spellcheck="false" data-placeholder="Type note here...">${WorkspaceViewer.escapeHTML(item.text || '')}</div>
        `;

        const contentEl = el.querySelector('.dv-text-note-content');
        contentEl.addEventListener('input', () => {
          item.text = contentEl.innerText;
          this.saveAllAnnotations(WorkspaceViewer.activeFile);
        });

        const delBtn = el.querySelector('.dv-text-note-delete');
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.pushHistoryState(pageNum);
          const idx = items.findIndex(it => it.id === item.id);
          if (idx !== -1) items.splice(idx, 1);
          this.saveAllAnnotations(WorkspaceViewer.activeFile);
          el.remove();
          WorkspaceViewer.showToast('Note deleted', 'info');
        });

        const dragHandle = el.querySelector('.dv-text-note-drag');
        let isDragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let noteStartX = 0;
        let noteStartY = 0;

        const onPointerMove = (e) => {
          if (!isDragging) return;
          const wrap = container.parentElement;
          if (!wrap) return;

          const deltaX = (e.clientX - dragStartX) / wrap.clientWidth;
          const deltaY = (e.clientY - dragStartY) / wrap.clientHeight;

          const newX = Math.max(0, Math.min(0.85, noteStartX + deltaX));
          const newY = Math.max(0, Math.min(0.9, noteStartY + deltaY));

          item.x = newX;
          item.y = newY;
          el.style.left = `${(newX * 100).toFixed(2)}%`;
          el.style.top = `${(newY * 100).toFixed(2)}%`;
        };

        const onPointerUp = () => {
          if (!isDragging) return;
          isDragging = false;
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
          this.saveAllAnnotations(WorkspaceViewer.activeFile);
        };

        dragHandle.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          isDragging = true;
          dragStartX = e.clientX;
          dragStartY = e.clientY;
          noteStartX = item.x;
          noteStartY = item.y;
          window.addEventListener('pointermove', onPointerMove);
          window.addEventListener('pointerup', onPointerUp);
        });

        container.appendChild(el);
      }

      if (window.lucide) window.lucide.createIcons({ root: container });
    }
  };

  // Expose AnnotationManager globally
  window.AnnotationManager = AnnotationManager;

  // =========================================================================
  // 3. Main WorkspaceViewer Controller
  // =========================================================================

  const WorkspaceViewer = {
    // Current State
    activeFile: null,
    docType: 'pdf', // 'pdf', 'image', 'text', 'markdown', 'media', 'unsupported'
    pdfDoc: null,
    currentPage: 1,
    totalPages: 1,
    scale: 1.0,
    fitMode: 'page-width', // 'page-width', 'page-fit', 'custom'
    rotation: 0,
    theme: 'default', // 'default', 'dark', 'sepia'
    renderedPages: new Set(),
    renderingPages: new Set(),
    renderTasks: new Map(),
    pageDimensions: new Map(),
    pageObserver: null,
    scrollObserver: null,
    isProgrammaticScroll: false,
    scrollTimer: null,
    thumbnailsRendered: new Set(),
    outlineItems: [],
    searchMatches: [],
    currentMatchIndex: -1,
    sidebarTab: 'thumbs', // 'thumbs', 'outline', 'info'
    isSidebarOpen: true,
    isFullscreen: false,
    textFontSize: 14,
    markdownMode: 'rendered',

    // DOM References Cache
    dom: {},

    init() {
      this.cacheElements();
      if (!this.dom.overlay) return;
      this.bindEvents();
      this.initDropZone();
      AnnotationManager.init();
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

        // Main Bar Pagination controls
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

        // Annotation controls
        btnToggleAnnotate: document.getElementById('dv-btn-toggle-annotate'),
        annotationToolbar: document.getElementById('dv-annotation-toolbar'),
        btnCloseAnnot: document.getElementById('dv-btn-close-annot'),

        // Search Bar
        searchBar: document.getElementById('dv-search-bar'),
        searchInput: document.getElementById('dv-search-input'),
        searchMatchInfo: document.getElementById('dv-search-match-info'),
        btnSearchPrev: document.getElementById('dv-btn-search-prev'),
        btnSearchNext: document.getElementById('dv-btn-search-next'),
        btnSearchClose: document.getElementById('dv-btn-search-close'),

        // Layout & Sidebar
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
        pdfPagesContainer: document.getElementById('dv-pdf-pages-container'),
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

      // Start Over button in header
      d.btnStartOver.addEventListener('click', () => this.startOver());

      // Annotation Toolbar Toggle
      if (d.btnToggleAnnotate) {
        d.btnToggleAnnotate.addEventListener('click', () => {
          AnnotationManager.toggleToolbar();
        });
      }
      if (d.btnCloseAnnot) {
        d.btnCloseAnnot.addEventListener('click', () => {
          AnnotationManager.toggleToolbar(false);
        });
      }

      // Resume banner actions
      d.btnResumeDismiss.addEventListener('click', () => {
        d.resumeBanner.classList.remove('active');
      });
      d.btnResumeStartOver.addEventListener('click', () => {
        d.resumeBanner.classList.remove('active');
        this.startOver();
      });

      // Main Bar Pagination Controls (Next, Prev, First, Last, Input)
      d.btnFirst.addEventListener('click', () => this.scrollToPage(1, true));
      d.btnPrev.addEventListener('click', () => this.scrollToPage(this.currentPage - 1, true));
      d.btnNext.addEventListener('click', () => this.scrollToPage(this.currentPage + 1, true));
      d.btnLast.addEventListener('click', () => this.scrollToPage(this.totalPages, true));

      d.pageInput.addEventListener('change', (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val)) this.scrollToPage(val, true);
      });
      d.pageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const val = parseInt(e.target.value, 10);
          if (!isNaN(val)) this.scrollToPage(val, true);
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
          this.updatePageDimensionsAndRender();
        }
      });

      // Rotate
      d.btnRotate.addEventListener('click', () => {
        this.rotation = (this.rotation + 90) % 360;
        this.updatePageDimensionsAndRender();
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

      // Continuous Viewport Scroll Listener:
      // Updates the main bar with the current active page as user scrolls!
      d.viewport.addEventListener('scroll', () => {
        if (this.docType !== 'pdf' || !this.pdfDoc || this.isProgrammaticScroll) return;
        clearTimeout(this.scrollTimer);
        this.scrollTimer = setTimeout(() => {
          this.detectActivePageOnScroll();
        }, 50);
      }, { passive: true });

      // Keyboard shortcuts
      window.addEventListener('keydown', (e) => {
        if (!this.isOpen()) return;

        const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
        const isEditable = e.target && (e.target.isContentEditable || tag === 'input' || tag === 'textarea');
        if (isEditable) return;

        if (e.key === 'Escape') {
          e.preventDefault();
          if (AnnotationManager.isAnnotating) {
            AnnotationManager.toggleToolbar(false);
          } else {
            this.close();
          }
        } else if (e.key === 'a' || e.key === 'A') {
          if (this.docType === 'pdf') {
            e.preventDefault();
            AnnotationManager.toggleToolbar();
          }
        } else if (AnnotationManager.isAnnotating && !e.ctrlKey && !e.altKey && !e.metaKey) {
          if (e.key === 'p' || e.key === 'P') AnnotationManager.setTool('pen');
          else if (e.key === 'h' || e.key === 'H') AnnotationManager.setTool('highlighter');
          else if (e.key === 't' || e.key === 'T') AnnotationManager.setTool('text');
          else if (e.key === 'e' || e.key === 'E') AnnotationManager.setTool('eraser');
          else if (e.key === 'v' || e.key === 'V') AnnotationManager.setTool('select');
        } else if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
          e.preventDefault();
          if (e.shiftKey) AnnotationManager.redo();
          else AnnotationManager.undo();
        } else if (e.ctrlKey && (e.key === 'y' || e.key === 'Y')) {
          e.preventDefault();
          AnnotationManager.redo();
        } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === 'j') {
          e.preventDefault();
          this.scrollToPage(this.currentPage + 1, true);
        } else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'k') {
          e.preventDefault();
          this.scrollToPage(this.currentPage - 1, true);
        } else if (e.key === 'Home') {
          e.preventDefault();
          this.scrollToPage(1, true);
        } else if (e.key === 'End') {
          e.preventDefault();
          this.scrollToPage(this.totalPages, true);
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
          this.updatePageDimensionsAndRender();
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

      // Reset and load annotations for this file
      AnnotationManager.resetForFile(file);

      const fileName = file.fileName || file.name || file.title || 'document';
      const ext = fileName.split('.').pop().toLowerCase();
      const fileUrl = file.filePath || file.url || (file.path ? `/uploads/${window.activeWorkspaceId || 'default'}/${file.path}` : '');

      this.dom.title.textContent = file.title || fileName;
      this.dom.title.title = file.title || fileName;
      this.dom.sizeBadge.textContent = file.size || file.fileSize ? this.formatBytes(file.size || file.fileSize) : '';

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

      this.updateHeaderIcon(ext);

      // Check Saved Progress ("Start Over / Resume Where Left Off")
      const savedProgress = ReadingProgressManager.getProgress(file);
      const shouldResume = !options.forceStartOver && savedProgress && (savedProgress.page > 1 || savedProgress.mediaTime > 5 || savedProgress.scrollTop > 50);

      this.dom.overlay.classList.add('active');
      document.body.style.overflow = 'hidden';

      this.hideAllStages();
      this.showLoading(true, `Loading ${fileName}...`);

      this.setTheme(savedProgress && savedProgress.theme ? savedProgress.theme : 'default');
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
      d.btnStartOver.style.display = (isPdf || type === 'media' || type === 'text' || type === 'markdown') ? 'inline-flex' : 'none';
      if (d.btnToggleAnnotate) d.btnToggleAnnotate.style.display = isPdf ? 'inline-flex' : 'none';

      if (!isPdf) {
        this.dom.sidebar.classList.remove('active');
        this.isSidebarOpen = false;
        if (AnnotationManager.isAnnotating) {
          AnnotationManager.toggleToolbar(false);
        }
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
    // 4. PDF Engine — Continuous Scrolling & Main Bar Integration
    // =========================================================================
    async loadPDF(url, rawFile, savedProgress, shouldResume) {
      if (!window.pdfjsLib) {
        throw new Error('PDF.js library is not loaded.');
      }

      // Cancel previous renders if any
      this.cancelAllRenderTasks();
      this.renderedPages.clear();
      this.renderingPages.clear();
      this.pageDimensions.clear();

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
      this.dom.pageInput.min = 1;

      // Handle resume target page
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

      this.dom.pdfStage.style.display = 'flex';
      this.showLoading(false);

      // Determine initial scale based on Page 1 viewport width
      const firstPage = await this.pdfDoc.getPage(1);
      const unscaledViewport = firstPage.getViewport({ scale: 1.0, rotation: this.rotation });
      const availableWidth = Math.max(300, this.dom.viewport.clientWidth - 56);
      this.scale = availableWidth / unscaledViewport.width;
      this.dom.zoomSelect.value = 'width';

      // Build continuous scrollable page elements
      await this.buildPageCards(unscaledViewport);

      // Setup lazy page observer & thumbnails
      this.setupPagesObserver();
      this.loadOutline();
      this.buildThumbnails();

      // Jump / scroll to active page
      setTimeout(() => {
        this.scrollToPage(targetPage, false);
      }, 50);
    },

    async buildPageCards(defaultViewport) {
      const container = this.dom.pdfPagesContainer;
      container.innerHTML = '';

      const width = Math.floor(defaultViewport.width * this.scale);
      const height = Math.floor(defaultViewport.height * this.scale);

      const fragment = document.createDocumentFragment();
      for (let i = 1; i <= this.totalPages; i++) {
        const card = document.createElement('div');
        card.className = 'dv-page-card';
        card.id = `dv-page-card-${i}`;
        card.dataset.page = i;

        card.innerHTML = `
          <div class="dv-page-canvas-wrapper" style="width:${width}px; height:${height}px;">
            <canvas id="dv-pdf-canvas-${i}"></canvas>
            <canvas class="dv-annotation-canvas" id="dv-annotation-canvas-${i}" data-page="${i}"></canvas>
            <div class="dv-text-layer textLayer" id="dv-text-layer-${i}" data-page="${i}"></div>
            <div class="dv-text-annotations-layer" id="dv-text-annotations-${i}" data-page="${i}"></div>
            <div class="dv-page-skeleton" id="dv-page-skeleton-${i}">
              <div class="dv-spinner-sm"></div>
              <span>Rendering Page ${i}...</span>
            </div>
          </div>
          <div class="dv-page-footer-badge">Page ${i} of ${this.totalPages}</div>
        `;

        fragment.appendChild(card);
      }

      container.appendChild(fragment);

      // Attach annotation canvas listeners & render text notes
      for (let i = 1; i <= this.totalPages; i++) {
        const annotCanvas = document.getElementById(`dv-annotation-canvas-${i}`);
        const textLayer = document.getElementById(`dv-text-annotations-${i}`);
        AnnotationManager.attachCanvasListeners(i, annotCanvas, textLayer);
        AnnotationManager.renderTextNotes(i);
      }
    },

    setupPagesObserver() {
      if (this.pageObserver) this.pageObserver.disconnect();

      this.pageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const pageNum = parseInt(entry.target.dataset.page, 10);
            if (!isNaN(pageNum) && !this.renderedPages.has(pageNum)) {
              this.renderPageCanvas(pageNum);
            }
          }
        });
      }, {
        root: this.dom.viewport,
        rootMargin: '400px 0px 400px 0px' // Pre-render pages before they enter viewport
      });

      const cards = this.dom.pdfPagesContainer.querySelectorAll('.dv-page-card');
      cards.forEach(card => this.pageObserver.observe(card));
    },

    async renderPageCanvas(pageNum) {
      if (!this.pdfDoc || this.renderedPages.has(pageNum) || this.renderingPages.has(pageNum)) return;

      this.renderingPages.add(pageNum);
      const canvas = document.getElementById(`dv-pdf-canvas-${pageNum}`);
      const skeleton = document.getElementById(`dv-page-skeleton-${pageNum}`);
      if (!canvas) {
        this.renderingPages.delete(pageNum);
        return;
      }

      try {
        const page = await this.pdfDoc.getPage(pageNum);
        const pixelRatio = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: this.scale, rotation: this.rotation });

        const wrap = canvas.parentElement;
        if (wrap) {
          wrap.style.width = `${Math.floor(viewport.width)}px`;
          wrap.style.height = `${Math.floor(viewport.height)}px`;
        }

        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const ctx = canvas.getContext('2d');
        ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

        if (this.renderTasks.has(pageNum)) {
          try { this.renderTasks.get(pageNum).cancel(); } catch (e) {}
        }

        const renderTask = page.render({ canvasContext: ctx, viewport });
        this.renderTasks.set(pageNum, renderTask);

        await renderTask.promise;
        this.renderTasks.delete(pageNum);
        this.renderedPages.add(pageNum);

        // Size and redraw annotation canvas layer
        const annotCanvas = document.getElementById(`dv-annotation-canvas-${pageNum}`);
        if (annotCanvas) {
          annotCanvas.width = Math.floor(viewport.width * pixelRatio);
          annotCanvas.height = Math.floor(viewport.height * pixelRatio);
          annotCanvas.style.width = `${Math.floor(viewport.width)}px`;
          annotCanvas.style.height = `${Math.floor(viewport.height)}px`;
          AnnotationManager.redrawPage(pageNum);
        }

        if (skeleton) skeleton.style.display = 'none';

        // Selectable text layer (copy / translate / highlight)
        this.renderTextLayerFor(page, pageNum, viewport);
      } catch (err) {
        if (err && err.name !== 'RenderingCancelledException') {
          console.warn(`[DocViewer] Page ${pageNum} render error:`, err);
        }
      } finally {
        this.renderingPages.delete(pageNum);
      }
    },

    async renderTextLayerFor(page, pageNum, viewport) {
      const layer = document.getElementById(`dv-text-layer-${pageNum}`);
      if (!layer || !window.pdfjsLib || !window.pdfjsLib.renderTextLayer) return;
      layer.innerHTML = '';
      layer.style.width = `${Math.floor(viewport.width)}px`;
      layer.style.height = `${Math.floor(viewport.height)}px`;
      layer.style.setProperty('--scale-factor', viewport.scale);
      try {
        const textContent = await page.getTextContent();
        const task = window.pdfjsLib.renderTextLayer({
          textContentSource: textContent,
          textContent,
          container: layer,
          viewport,
          textDivs: []
        });
        if (task && task.promise) await task.promise;
      } catch (err) {
        console.warn(`[DocViewer] Text layer error on page ${pageNum}:`, err);
      }
    },

    cancelAllRenderTasks() {
      this.renderTasks.forEach(task => {
        try { task.cancel(); } catch (e) {}
      });
      this.renderTasks.clear();
    },

    // =========================================================================
    // 5. Main Bar Page Navigation & Scroll Sync
    // =========================================================================
    scrollToPage(pageNum, smooth = true) {
      if (!this.pdfDoc || this.totalPages < 1) return;
      const target = Math.min(Math.max(1, pageNum), this.totalPages);
      const card = document.getElementById(`dv-page-card-${target}`);
      if (!card) return;

      this.currentPage = target;
      this.updateMainBar(target);

      // Disable scroll listener trigger during smooth auto scroll
      this.isProgrammaticScroll = true;

      const viewport = this.dom.viewport;
      const cardTop = card.offsetTop - 16;
      viewport.scrollTo({
        top: Math.max(0, cardTop),
        behavior: smooth ? 'smooth' : 'auto'
      });

      // Render target and adjacent page immediately
      this.renderPageCanvas(target);
      if (target + 1 <= this.totalPages) this.renderPageCanvas(target + 1);
      if (target - 1 >= 1) this.renderPageCanvas(target - 1);

      // Save reading progress
      ReadingProgressManager.saveProgress(this.activeFile, {
        page: target,
        totalPages: this.totalPages,
        scale: this.scale,
        theme: this.theme
      });

      setTimeout(() => {
        this.isProgrammaticScroll = false;
      }, smooth ? 450 : 50);
    },

    detectActivePageOnScroll() {
      const viewport = this.dom.viewport;
      const viewportCenter = viewport.scrollTop + (viewport.clientHeight * 0.35);

      const cards = this.dom.pdfPagesContainer.querySelectorAll('.dv-page-card');
      let foundPage = this.currentPage;

      for (const card of cards) {
        const top = card.offsetTop;
        const bottom = top + card.offsetHeight;
        if (top <= viewportCenter && bottom >= viewportCenter) {
          foundPage = parseInt(card.dataset.page, 10);
          break;
        }
      }

      if (foundPage !== this.currentPage && !isNaN(foundPage)) {
        this.currentPage = foundPage;
        this.updateMainBar(foundPage);

        ReadingProgressManager.saveProgress(this.activeFile, {
          page: foundPage,
          totalPages: this.totalPages,
          scale: this.scale,
          theme: this.theme
        });
      }
    },

    updateMainBar(pageNum) {
      const d = this.dom;
      d.pageInput.value = pageNum;
      const pct = Math.round((pageNum / this.totalPages) * 100);
      d.progressPill.textContent = `Page ${pageNum} of ${this.totalPages} (${pct}%)`;
      d.progressBar.style.width = `${pct}%`;
      d.statusInfo.textContent = `Page ${pageNum} of ${this.totalPages} • Zoom: ${Math.round(this.scale * 100)}%`;
      this.updateActiveThumbnail(pageNum);
    },

    // =========================================================================
    // 6. Zoom & Fit Controls
    // =========================================================================
    async applyFitMode() {
      if (!this.pdfDoc || this.docType !== 'pdf') return;
      try {
        const firstPage = await this.pdfDoc.getPage(1);
        const unscaledViewport = firstPage.getViewport({ scale: 1.0, rotation: this.rotation });
        const viewportWidth = Math.max(300, this.dom.viewport.clientWidth - 56);
        const viewportHeight = Math.max(300, this.dom.viewport.clientHeight - 56);

        if (this.fitMode === 'page-width') {
          this.scale = viewportWidth / unscaledViewport.width;
          this.dom.zoomSelect.value = 'width';
        } else if (this.fitMode === 'page-fit') {
          const scaleW = viewportWidth / unscaledViewport.width;
          const scaleH = viewportHeight / unscaledViewport.height;
          this.scale = Math.min(scaleW, scaleH);
          this.dom.zoomSelect.value = 'fit';
        }

        this.updatePageDimensionsAndRender();
      } catch (err) {
        console.error('[DocViewer] Error applying fit mode:', err);
      }
    },

    zoomStep(delta) {
      if (this.docType !== 'pdf' && this.docType !== 'image') return;
      this.fitMode = 'custom';
      this.scale = Math.min(Math.max(0.3, parseFloat((this.scale + delta).toFixed(2))), 3.5);

      const option = Array.from(this.dom.zoomSelect.options).find(o => Math.abs(parseFloat(o.value) - this.scale) < 0.05);
      if (option) this.dom.zoomSelect.value = option.value;
      else this.dom.zoomSelect.value = 'custom';

      if (this.docType === 'pdf') {
        this.updatePageDimensionsAndRender();
      } else if (this.docType === 'image') {
        this.dom.imageEl.style.transform = `scale(${this.scale}) rotate(${this.rotation}deg)`;
      }
    },

    async updatePageDimensionsAndRender() {
      if (!this.pdfDoc) return;
      this.cancelAllRenderTasks();
      this.renderedPages.clear();

      try {
        const firstPage = await this.pdfDoc.getPage(1);
        const viewport = firstPage.getViewport({ scale: this.scale, rotation: this.rotation });
        const width = Math.floor(viewport.width);
        const height = Math.floor(viewport.height);
        const pixelRatio = window.devicePixelRatio || 1;

        const wrappers = this.dom.pdfPagesContainer.querySelectorAll('.dv-page-canvas-wrapper');
        wrappers.forEach(w => {
          w.style.width = `${width}px`;
          w.style.height = `${height}px`;
          const skeleton = w.querySelector('.dv-page-skeleton');
          if (skeleton) skeleton.style.display = 'flex';
        });

        // Resize visible annotation canvases & redraw to keep annotations crystal-clear
        for (let i = 1; i <= this.totalPages; i++) {
          const annotCanvas = document.getElementById(`dv-annotation-canvas-${i}`);
          if (annotCanvas) {
            annotCanvas.style.width = `${width}px`;
            annotCanvas.style.height = `${height}px`;
            annotCanvas.width = Math.floor(width * pixelRatio);
            annotCanvas.height = Math.floor(height * pixelRatio);
            AnnotationManager.redrawPage(i);
          }
        }

        // Re-render currently active page and next page immediately
        this.renderPageCanvas(this.currentPage);
        if (this.currentPage + 1 <= this.totalPages) this.renderPageCanvas(this.currentPage + 1);

        // Update status bar
        this.dom.statusInfo.textContent = `Page ${this.currentPage} of ${this.totalPages} • Zoom: ${Math.round(this.scale * 100)}%`;
      } catch (e) {
        console.error('[DocViewer] Error updating page dimensions:', e);
      }
    },

    // =========================================================================
    // 7. Start Over Feature
    // =========================================================================
    startOver() {
      if (!this.activeFile) return;

      if (this.docType === 'pdf') {
        this.scrollToPage(1, true);
        ReadingProgressManager.saveProgress(this.activeFile, {
          page: 1,
          totalPages: this.totalPages,
          scale: this.scale,
          theme: this.theme
        });
        this.showToast('Restarted document from Page 1', 'rotate-ccw');
      } else if (this.docType === 'media') {
        const media = this.dom.mediaContainer.querySelector('video, audio');
        if (media) {
          media.currentTime = 0;
          media.play().catch(() => {});
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

    showResumeBanner(progress) {
      const d = this.dom;
      const pct = progress.percentage || Math.round((progress.page / progress.totalPages) * 100);
      d.resumeText.innerHTML = `Welcome back! You were on <strong>Page ${progress.page} of ${progress.totalPages}</strong> (${pct}% read).`;
      d.resumeBanner.classList.add('active');

      setTimeout(() => {
        d.resumeBanner.classList.remove('active');
      }, 8000);
    },

    // =========================================================================
    // 8. Thumbnails & Outline Sidebar
    // =========================================================================
    toggleSidebar(open) {
      this.isSidebarOpen = (typeof open === 'boolean') ? open : !this.isSidebarOpen;
      this.dom.sidebar.classList.toggle('active', this.isSidebarOpen);
      this.dom.btnSidebarToggle.classList.toggle('active', this.isSidebarOpen);

      setTimeout(() => {
        if (this.fitMode === 'page-width') this.applyFitMode();
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

      if (tab === 'thumbs') this.renderVisibleThumbnails();
      else if (tab === 'info') this.renderDocInfo();
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
          this.scrollToPage(i, true);
        });

        fragment.appendChild(item);
      }
      list.appendChild(fragment);

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
      } catch (err) {}
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
          list.innerHTML = `<div class="dv-empty-notice"><i data-lucide="bookmark"></i><span>No bookmarks/outline in this PDF</span></div>`;
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
                this.scrollToPage(pageIndex + 1, true);
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
    // 9. Text Search
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
        } catch (e) {}
      }

      this.searchMatches = matches;
      if (matches.length > 0) {
        this.currentMatchIndex = 0;
        this.dom.searchMatchInfo.textContent = `1 of ${matches.length}`;
        this.scrollToPage(matches[0].page, true);
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
      this.scrollToPage(match.page, true);
    },

    // =========================================================================
    // 10. Other File Handlers: Text, Markdown, Image, Media
    // =========================================================================
    async loadText(url, rawFile, ext, savedProgress, shouldResume) {
      let text = '';
      if (rawFile) text = await rawFile.text();
      else {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        text = await res.text();
      }

      this.dom.textStage.style.display = 'block';
      this.showLoading(false);

      const lines = text.split('\n');
      this.dom.textContent.innerHTML = lines.map((line, idx) => `
        <div class="dv-code-line">
          <span class="dv-line-no">${idx + 1}</span>
          <span class="dv-line-code">${this.escapeHTML(line) || '&nbsp;'}</span>
        </div>
      `).join('');

      if (shouldResume && savedProgress && savedProgress.scrollTop) {
        setTimeout(() => {
          this.dom.viewport.scrollTo({ top: savedProgress.scrollTop, behavior: 'smooth' });
        }, 100);
      }

      this.bindViewportScrollTracking();
    },

    async loadMarkdown(url, rawFile, savedProgress, shouldResume) {
      let text = '';
      if (rawFile) text = await rawFile.text();
      else {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        text = await res.text();
      }

      this.dom.markdownStage.style.display = 'block';
      this.showLoading(false);

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
      let src = rawFile ? URL.createObjectURL(rawFile) : url;

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
      let src = rawFile ? URL.createObjectURL(rawFile) : url;

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
        }, 200);
      };
    },

    // =========================================================================
    // 11. Themes, Fullscreen, and Downloads
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

      const media = d.mediaContainer.querySelectorAll('video, audio');
      media.forEach(m => {
        try { m.pause(); m.src = ''; } catch (e) {}
      });

      this.cancelAllRenderTasks();
      if (this.pageObserver) this.pageObserver.disconnect();
      this.renderedPages.clear();
      this.renderingPages.clear();
      this.pdfDoc = null;
      this.activeFile = null;
      AnnotationManager.toggleToolbar(false);
      d.resumeBanner.classList.remove('active');
      d.pdfPagesContainer.innerHTML = '';
    },

    // =========================================================================
    // 12. Markdown Renderer
    // =========================================================================
    renderMarkdownToHTML(md) {
      if (!md) return '';
      let html = md;

      html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      html = html.replace(/```([a-z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
        return `<pre class="dv-md-code-block"><code class="lang-${lang}">${code}</code></pre>`;
      });

      html = html.replace(/`([^`]+)`/g, '<code class="dv-md-inline-code">$1</code>');
      html = html.replace(/^###### (.*$)/gim, '<h6>$1</h6>');
      html = html.replace(/^##### (.*$)/gim, '<h5>$1</h5>');
      html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
      html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
      html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
      html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
      html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
      html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      html = html.replace(/^\> (.*$)/gim, '<blockquote class="dv-md-blockquote">$1</blockquote>');
      html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>');
      html = html.replace(/(<li>.*<\/li>)/gims, '<ul class="dv-md-list">$1</ul>');
      html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

      html = html.split('\n\n').map(p => {
        if (p.startsWith('<h') || p.startsWith('<pre') || p.startsWith('<ul') || p.startsWith('<block')) return p;
        return `<p>${p.replace(/\n/g, '<br>')}</p>`;
      }).join('\n');

      return html;
    },

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

  // =========================================================================
  // Text Selection Tools: Copy / Translate / Highlight (and remove highlight)
  // =========================================================================
  const TextSelectionTools = {
    popup: null,
    current: null, // { text, rects: [{page, x,y,w,h}], hlItems: [{page,id}] }
    colors: ['#facc15', '#4ade80', '#38bdf8', '#f472b6'],
    LANGS: [['en', 'English'], ['bn', 'Bengali'], ['hi', 'Hindi'], ['ar', 'Arabic'], ['es', 'Spanish'],
            ['fr', 'French'], ['de', 'German'], ['zh-CN', 'Chinese'], ['ja', 'Japanese'], ['ru', 'Russian']],

    init() {
      this.buildPopup();
      document.addEventListener('mouseup', (e) => this.onPointerUp(e));
      document.addEventListener('touchend', (e) => this.onPointerUp(e));
      document.addEventListener('mousedown', (e) => {
        if (this.popup && !this.popup.contains(e.target)) this.hide();
      });
      document.addEventListener('scroll', () => this.hide(), true);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.hide(); });
    },

    buildPopup() {
      const p = document.createElement('div');
      p.className = 'dv-sel-popup';
      p.style.display = 'none';
      p.innerHTML = `
        <div class="dv-sel-row">
          <button type="button" data-act="copy" title="Copy">Copy</button>
          <button type="button" data-act="translate" title="Translate">Translate</button>
          <span class="dv-sel-colors">${this.colors.map(c =>
            `<button type="button" class="dv-sel-color" data-act="highlight" data-color="${c}" title="Highlight" style="background:${c}"></button>`).join('')}</span>
          <button type="button" data-act="unhighlight" title="Remove highlight" style="display:none">Remove highlight</button>
        </div>
        <div class="dv-sel-translation" style="display:none">
          <select class="dv-sel-lang">${this.LANGS.map(([c, n]) => `<option value="${c}">${n}</option>`).join('')}</select>
          <div class="dv-sel-result"></div>
        </div>`;
      document.body.appendChild(p);
      this.popup = p;

      const sel = p.querySelector('.dv-sel-lang');
      sel.value = localStorage.getItem('workspace_translate_lang') || 'en';
      sel.addEventListener('change', () => {
        localStorage.setItem('workspace_translate_lang', sel.value);
        this.translate();
      });
      p.addEventListener('mousedown', (e) => { if (e.target.tagName !== 'SELECT') e.preventDefault(); });
      p.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === 'copy') this.copy();
        else if (act === 'translate') this.translate();
        else if (act === 'highlight') this.highlight(btn.dataset.color);
        else if (act === 'unhighlight') this.unhighlight();
      });
    },

    pageOf(el) {
      const layer = el && el.closest ? el.closest('.dv-text-layer') : null;
      return layer ? parseInt(layer.dataset.page, 10) : null;
    },

    onPointerUp(e) {
      if (this.popup && this.popup.contains(e.target)) return;
      setTimeout(() => {
        const sel = window.getSelection();
        const inLayer = e.target && e.target.closest && e.target.closest('.dv-text-layer');
        if (sel && !sel.isCollapsed && sel.rangeCount) {
          const range = sel.getRangeAt(0);
          const node = range.commonAncestorContainer;
          const el = node.nodeType === 1 ? node : node.parentElement;
          if (el && (el.closest('.dv-text-layer') || el.querySelector && el.querySelector('.dv-text-layer'))) {
            this.showForSelection(range, sel);
            return;
          }
        }
        if (inLayer) this.showForClick(e);
      }, 10);
    },

    collectRects(range) {
      const out = [];
      const wrappers = document.querySelectorAll('.dv-page-canvas-wrapper');
      for (const r of range.getClientRects()) {
        if (r.width < 1 || r.height < 1) continue;
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        for (const w of wrappers) {
          const wr = w.getBoundingClientRect();
          if (cx >= wr.left && cx <= wr.right && cy >= wr.top && cy <= wr.bottom) {
            const layer = w.querySelector('.dv-text-layer');
            out.push({
              page: parseInt(layer.dataset.page, 10),
              x: (r.left - wr.left) / wr.width, y: (r.top - wr.top) / wr.height,
              w: r.width / wr.width, h: r.height / wr.height
            });
            break;
          }
        }
      }
      return out;
    },

    showForSelection(range, sel) {
      const text = sel.toString().replace(/\s+/g, ' ').trim();
      if (!text) return;
      this.current = { text, rects: this.collectRects(range), hlItems: [] };
      const box = range.getBoundingClientRect();
      this.open(box.left + box.width / 2, box.top, box.bottom, false);
    },

    showForClick(e) {
      // Click on an existing highlight -> offer removal
      const layer = e.target.closest('.dv-text-layer');
      const page = this.pageOf(layer);
      if (!page) return;
      const wr = layer.getBoundingClientRect();
      const px = (e.clientX - wr.left) / wr.width, py = (e.clientY - wr.top) / wr.height;
      const hits = AnnotationManager.getPageItems(page).filter(it => it.type === 'texthl' &&
        (it.rects || []).some(r => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h));
      if (!hits.length) return;
      this.current = { text: '', rects: [], hlItems: hits.map(h => ({ page, id: h.id })) };
      this.open(e.clientX, e.clientY - 10, e.clientY + 10, true);
    },

    open(cx, top, bottom, onlyRemove) {
      const p = this.popup;
      p.querySelector('.dv-sel-translation').style.display = 'none';
      p.querySelector('[data-act="copy"]').style.display = onlyRemove ? 'none' : '';
      p.querySelector('[data-act="translate"]').style.display = onlyRemove ? 'none' : '';
      p.querySelector('.dv-sel-colors').style.display = onlyRemove ? 'none' : '';

      // Does the selection overlap existing highlights? Then offer removal as well
      let overlapping = onlyRemove;
      if (!onlyRemove) {
        const ids = [];
        for (const r of this.current.rects) {
          for (const it of AnnotationManager.getPageItems(r.page)) {
            if (it.type !== 'texthl' || ids.some(i => i.id === it.id)) continue;
            if ((it.rects || []).some(h => r.x < h.x + h.w && r.x + r.w > h.x && r.y < h.y + h.h && r.y + r.h > h.y)) {
              ids.push({ page: r.page, id: it.id });
            }
          }
        }
        this.current.hlItems = ids;
        overlapping = ids.length > 0;
      }
      p.querySelector('[data-act="unhighlight"]').style.display = overlapping ? '' : 'none';

      p.style.display = 'block';
      const pw = p.offsetWidth, ph = p.offsetHeight;
      let left = Math.max(8, Math.min(window.innerWidth - pw - 8, cx - pw / 2));
      let y = top - ph - 8;
      if (y < 8) y = bottom + 8;
      p.style.left = `${left}px`;
      p.style.top = `${y}px`;
    },

    hide() {
      if (this.popup) this.popup.style.display = 'none';
    },

    async copy() {
      const text = this.current && this.current.text;
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
      } catch (_) {
        document.execCommand('copy');
      }
      WorkspaceViewer.showToast('Copied to clipboard', 'info');
      this.hide();
    },

    async translate() {
      const text = this.current && this.current.text;
      if (!text) return;
      const box = this.popup.querySelector('.dv-sel-translation');
      const out = box.querySelector('.dv-sel-result');
      const lang = box.querySelector('.dv-sel-lang').value;
      box.style.display = 'block';
      out.textContent = 'Translating...';
      try {
        const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&tl=' +
          encodeURIComponent(lang) + '&q=' + encodeURIComponent(text.slice(0, 4000));
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        out.textContent = (data[0] || []).map(s => s[0]).join('') || '(no translation)';
      } catch (err) {
        out.textContent = 'Translation failed. Check your internet connection.';
      }
    },

    highlight(color) {
      const cur = this.current;
      if (!cur || !cur.rects.length) return;
      const byPage = {};
      cur.rects.forEach(r => { (byPage[r.page] = byPage[r.page] || []).push({ x: r.x, y: r.y, w: r.w, h: r.h }); });
      for (const page of Object.keys(byPage)) {
        AnnotationManager.pushHistoryState(page);
        AnnotationManager.getPageItems(page).push({
          id: 'hl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
          type: 'texthl', color, rects: byPage[page], text: cur.text
        });
        AnnotationManager.redrawPage(page);
      }
      AnnotationManager.saveAllAnnotations(WorkspaceViewer.activeFile);
      window.getSelection().removeAllRanges();
      this.hide();
    },

    unhighlight() {
      const cur = this.current;
      if (!cur) return;
      const pages = new Set();
      cur.hlItems.forEach(h => {
        const items = AnnotationManager.getPageItems(h.page);
        const idx = items.findIndex(it => it.id === h.id);
        if (idx !== -1) {
          if (!pages.has(h.page)) AnnotationManager.pushHistoryState(h.page);
          items.splice(idx, 1);
          pages.add(h.page);
        }
      });
      pages.forEach(p => AnnotationManager.redrawPage(p));
      AnnotationManager.saveAllAnnotations(WorkspaceViewer.activeFile);
      window.getSelection().removeAllRanges();
      WorkspaceViewer.showToast('Highlight removed', 'info');
      this.hide();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => TextSelectionTools.init());
  } else {
    TextSelectionTools.init();
  }

  // Expose WorkspaceViewer globally
  window.WorkspaceViewer = WorkspaceViewer;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => WorkspaceViewer.init());
  } else {
    WorkspaceViewer.init();
  }

})();
