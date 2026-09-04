const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const WORKSPACES_DIR = path.join(__dirname, 'workspaces');
const REGISTRY_FILE = path.join(WORKSPACES_DIR, 'registry.json');

// Ensure workspaces folder exists
if (!fs.existsSync(WORKSPACES_DIR)) {
  fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
}

// Load or create registry.json
let registry = {
  activeWorkspace: 'default',
  workspaces: [
    { id: 'default', name: 'Default Workspace', createdAt: new Date().toISOString() }
  ]
};

if (fs.existsSync(REGISTRY_FILE)) {
  try {
    registry = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  } catch (error) {
    console.error('Error reading registry.json, resetting structure', error);
  }
} else {
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

// Setup default workspace folders
const defaultWSPath = path.join(WORKSPACES_DIR, 'default');
const defaultWSUploadsPath = path.join(defaultWSPath, 'uploads');
if (!fs.existsSync(defaultWSPath)) {
  fs.mkdirSync(defaultWSPath, { recursive: true });
}
if (!fs.existsSync(defaultWSUploadsPath)) {
  fs.mkdirSync(defaultWSUploadsPath, { recursive: true });
}

// --- Legacy Migration Block ---
const legacyDBFile = path.join(__dirname, 'db.json');
const legacyUploadsDir = path.join(__dirname, 'uploads');
const defaultDBFile = path.join(defaultWSPath, 'db.json');

if (fs.existsSync(legacyDBFile)) {
  try {
    console.log('[MIGRATION] Migrating legacy db.json to workspaces/default/db.json');
    fs.renameSync(legacyDBFile, defaultDBFile);
  } catch (err) {
    console.error('Migration of db.json failed', err);
  }
}

if (!fs.existsSync(defaultDBFile)) {
  const initialData = {
    categories: ['General', 'Work', 'Personal', 'Study', 'Finance'],
    items: []
  };
  fs.writeFileSync(defaultDBFile, JSON.stringify(initialData, null, 2));
}

if (fs.existsSync(legacyUploadsDir)) {
  try {
    console.log('[MIGRATION] Moving files from legacy uploads directory...');
    const files = fs.readdirSync(legacyUploadsDir);
    files.forEach(file => {
      const srcPath = path.join(legacyUploadsDir, file);
      const destPath = path.join(defaultWSUploadsPath, file);
      fs.renameSync(srcPath, destPath);
    });
    fs.rmdirSync(legacyUploadsDir);
    console.log('[MIGRATION] Cleaned up legacy uploads folder.');
  } catch (err) {
    console.error('Migration of uploads folder failed', err);
  }
}
// --- End Migration Block ---

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Multer configured dynamically based on route parameters
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const wsId = req.params.workspaceId || 'default';
    const cleanWsId = path.basename(wsId);
    const destDir = path.join(WORKSPACES_DIR, cleanWsId, 'uploads');
    
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    cb(null, destDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9-_]/g, '_');
    cb(null, `${baseName}-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage });

// Helper to read workspace DB
function readWorkspaceDB(wsId) {
  const cleanWsId = path.basename(wsId);
  const dbFile = path.join(WORKSPACES_DIR, cleanWsId, 'db.json');
  try {
    if (!fs.existsSync(dbFile)) {
      return { categories: ['General', 'Work', 'Personal', 'Study', 'Finance'], items: [] };
    }
    const data = fs.readFileSync(dbFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading database for workspace ${wsId}`, error);
    return { categories: ['General'], items: [] };
  }
}

// Helper to write workspace DB
function writeWorkspaceDB(wsId, data) {
  const cleanWsId = path.basename(wsId);
  const dbFile = path.join(WORKSPACES_DIR, cleanWsId, 'db.json');
  try {
    fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`Error writing database for workspace ${wsId}`, error);
    return false;
  }
}

// Helper to save registry
function saveRegistry() {
  try {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
  } catch (error) {
    console.error('Error saving registry.json', error);
  }
}

// ================= WORKSPACE MANAGE ENDPOINTS =================

// API: Get registry & workspaces list
app.get('/api/workspaces', (req, res) => {
  res.json(registry);
});

// API: Create workspace
app.post('/api/workspaces', (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'Workspace name is required' });
  }

  const cleanName = name.trim();
  // Slugify name to create unique folder ID
  let id = cleanName.toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!id) {
    id = `workspace_${Date.now()}`;
  }

  // Ensure unique ID
  const exists = registry.workspaces.find(ws => ws.id === id);
  if (exists) {
    id = `${id}-${Date.now().toString().slice(-4)}`;
  }

  const newWorkspace = {
    id,
    name: cleanName,
    createdAt: new Date().toISOString()
  };

  // Create folder structures
  const wsDir = path.join(WORKSPACES_DIR, id);
  const uploadsDir = path.join(wsDir, 'uploads');
  fs.mkdirSync(wsDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });

  const initialData = {
    categories: ['General', 'Work', 'Personal', 'Study', 'Finance'],
    items: []
  };
  fs.writeFileSync(path.join(wsDir, 'db.json'), JSON.stringify(initialData, null, 2));

  // Add to registry and save
  registry.workspaces.push(newWorkspace);
  registry.activeWorkspace = id; // auto-switch to new workspace
  saveRegistry();

  res.status(201).json({ registry, newWorkspace });
});

// API: Delete workspace
app.delete('/api/workspaces/:id', (req, res) => {
  const { id } = req.params;

  if (id === 'default') {
    return res.status(400).json({ error: 'Cannot delete the default workspace' });
  }

  const index = registry.workspaces.findIndex(ws => ws.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Workspace not found' });
  }

  // Delete files recursively
  const wsDir = path.join(WORKSPACES_DIR, path.basename(id));
  if (fs.existsSync(wsDir)) {
    try {
      fs.rmSync(wsDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`Failed to delete directory ${wsDir}`, err);
    }
  }

  // Remove from registry list
  registry.workspaces.splice(index, 1);
  
  // If the deleted workspace was active, fall back to default
  if (registry.activeWorkspace === id) {
    registry.activeWorkspace = 'default';
  }
  
  saveRegistry();
  res.json(registry);
});

// API: Set active workspace
app.post('/api/workspaces/active', (req, res) => {
  const { id } = req.body;
  const exists = registry.workspaces.find(ws => ws.id === id);
  if (!exists) {
    return res.status(404).json({ error: 'Workspace not found' });
  }
  registry.activeWorkspace = id;
  saveRegistry();
  res.json(registry);
});

// ================= DYNAMIC WORKSPACE ITEM CRUD ENDPOINTS =================

// API: Get workspace items & categories
app.get('/api/workspaces/:workspaceId/data', (req, res) => {
  res.json(readWorkspaceDB(req.params.workspaceId));
});

// API: Add Link or Note
app.post('/api/workspaces/:workspaceId/items', (req, res) => {
  const { workspaceId } = req.params;
  const { type, title, url, content, description, category } = req.body;
  
  if (!type || !title) {
    return res.status(400).json({ error: 'Type and Title are required' });
  }

  const db = readWorkspaceDB(workspaceId);
  const newItem = {
    id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    type, 
    title,
    category: category || 'General',
    createdAt: new Date().toISOString()
  };

  if (type === 'link') {
    if (!url) return res.status(400).json({ error: 'URL is required for links' });
    newItem.url = url;
    newItem.description = description || '';
  } else if (type === 'note') {
    newItem.content = content || '';
  } else {
    return res.status(400).json({ error: 'Invalid item type' });
  }

  db.items.push(newItem);
  writeWorkspaceDB(workspaceId, db);

  res.status(201).json(newItem);
});

// API: File Upload
app.post('/api/workspaces/:workspaceId/upload', upload.single('file'), (req, res) => {
  const { workspaceId } = req.params;
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const { title, description, category } = req.body;
  const db = readWorkspaceDB(workspaceId);

  const newItem = {
    id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    type: 'file',
    title: title || req.file.originalname,
    fileName: req.file.originalname,
    fileSize: req.file.size,
    filePath: `/uploads/${workspaceId}/${req.file.filename}`, // routed path
    description: description || '',
    category: category || 'General',
    createdAt: new Date().toISOString()
  };

  db.items.push(newItem);
  writeWorkspaceDB(workspaceId, db);

  res.status(201).json(newItem);
});

// API: Delete Item
app.delete('/api/workspaces/:workspaceId/items/:itemId', (req, res) => {
  const { workspaceId, itemId } = req.params;
  const db = readWorkspaceDB(workspaceId);
  const index = db.items.findIndex(item => item.id === itemId);

  if (index === -1) {
    return res.status(404).json({ error: 'Item not found' });
  }

  const itemToDelete = db.items[index];

  // If it's a file, delete the actual file on disk
  if (itemToDelete.type === 'file' && itemToDelete.filePath) {
    const filename = path.basename(itemToDelete.filePath);
    const absolutePath = path.join(WORKSPACES_DIR, path.basename(workspaceId), 'uploads', filename);
    if (fs.existsSync(absolutePath)) {
      try {
        fs.unlinkSync(absolutePath);
      } catch (err) {
        console.error(`Error deleting file at ${absolutePath}`, err);
      }
    }
  }

  db.items.splice(index, 1);
  writeWorkspaceDB(workspaceId, db);

  res.json({ message: 'Item deleted successfully', id: itemId });
});

// API: Add Category
app.post('/api/workspaces/:workspaceId/categories', (req, res) => {
  const { workspaceId } = req.params;
  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'Invalid category name' });
  }

  const trimmedName = name.trim();
  const db = readWorkspaceDB(workspaceId);

  if (db.categories.map(c => c.toLowerCase()).includes(trimmedName.toLowerCase())) {
    return res.status(400).json({ error: 'Category already exists' });
  }

  db.categories.push(trimmedName);
  writeWorkspaceDB(workspaceId, db);

  res.status(201).json({ categories: db.categories, newCategory: trimmedName });
});

// =================== FILE SYSTEM API ===================

// Helper: walk a directory tree and return structured result
function walkFolderTree(dirPath, baseDir) {
  const result = { folders: [], files: [] };
  if (!fs.existsSync(dirPath)) return result;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      result.folders.push({ name: entry.name, path: relativePath, ...walkFolderTree(fullPath, baseDir) });
    } else {
      const stat = fs.statSync(fullPath);
      result.files.push({ name: entry.name, path: relativePath, size: stat.size, modifiedAt: stat.mtime.toISOString() });
    }
  }
  return result;
}

// Helper: safely resolve a path inside uploads, returns null on traversal attempt
function safeUploadsPath(wsId, relPath) {
  const cleanWsId = path.basename(wsId);
  const base = path.join(WORKSPACES_DIR, cleanWsId, 'uploads');
  const resolved = path.resolve(base, relPath || '.');
  if (!resolved.startsWith(base)) return null;
  return { base, resolved };
}

// GET  /api/workspaces/:wsId/folders  — full folder tree
app.get('/api/workspaces/:workspaceId/folders', (req, res) => {
  const { workspaceId } = req.params;
  const p = safeUploadsPath(workspaceId, '.');
  if (!p) return res.status(403).json({ error: 'Forbidden' });
  if (!fs.existsSync(p.base)) fs.mkdirSync(p.base, { recursive: true });
  res.json({ name: 'root', path: '', ...walkFolderTree(p.base, p.base) });
});

// POST /api/workspaces/:wsId/folders  — create folder
app.post('/api/workspaces/:workspaceId/folders', (req, res) => {
  const { workspaceId } = req.params;
  const { parentPath, name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Folder name required' });
  const cleanName = name.trim().replace(/[<>:"/\\|?*]/g, '_');
  const p = safeUploadsPath(workspaceId, parentPath || '.');
  if (!p) return res.status(403).json({ error: 'Forbidden' });
  const newDir = path.join(p.resolved, cleanName);
  if (fs.existsSync(newDir)) return res.status(400).json({ error: 'Folder already exists' });
  fs.mkdirSync(newDir, { recursive: true });
  res.status(201).json({ name: cleanName, path: path.relative(p.base, newDir).replace(/\\/g, '/') });
});

// DELETE /api/workspaces/:wsId/folders  — delete folder
app.delete('/api/workspaces/:workspaceId/folders', (req, res) => {
  const { workspaceId } = req.params;
  const { folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ error: 'folderPath required' });
  const p = safeUploadsPath(workspaceId, folderPath);
  if (!p || p.resolved === p.base) return res.status(403).json({ error: 'Cannot delete root' });
  if (!fs.existsSync(p.resolved)) return res.status(404).json({ error: 'Not found' });
  fs.rmSync(p.resolved, { recursive: true, force: true });
  res.json({ message: 'Folder deleted' });
});

// PATCH /api/workspaces/:wsId/folders  — rename folder
app.patch('/api/workspaces/:workspaceId/folders', (req, res) => {
  const { workspaceId } = req.params;
  const { folderPath, newName } = req.body;
  if (!folderPath || !newName) return res.status(400).json({ error: 'folderPath and newName required' });
  const p = safeUploadsPath(workspaceId, folderPath);
  if (!p || p.resolved === p.base) return res.status(403).json({ error: 'Forbidden' });
  const cleanName = newName.trim().replace(/[<>:"/\\|?*]/g, '_');
  const newPath = path.join(path.dirname(p.resolved), cleanName);
  if (fs.existsSync(newPath)) return res.status(400).json({ error: 'Name already exists' });
  fs.renameSync(p.resolved, newPath);
  res.json({ name: cleanName, path: path.relative(p.base, newPath).replace(/\\/g, '/') });
});

// POST /api/workspaces/:wsId/upload-to-folder  — upload files into a folder
app.post('/api/workspaces/:workspaceId/upload-to-folder', (req, res) => {
  const { workspaceId } = req.params;
  const folderRel = req.query.folder || '';
  const p = safeUploadsPath(workspaceId, folderRel);
  if (!p) return res.status(403).json({ error: 'Forbidden' });
  if (!fs.existsSync(p.resolved)) fs.mkdirSync(p.resolved, { recursive: true });

  const dynStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, p.resolved),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const base = path.basename(file.originalname, ext).replace(/[<>:"/\\|?*]/g, '_');
      const candidate = path.join(p.resolved, file.originalname);
      cb(null, fs.existsSync(candidate) ? `${base}-${Date.now()}${ext}` : file.originalname);
    }
  });
  multer({ storage: dynStorage }).array('files')(req, res, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    const uploaded = req.files.map(f => ({
      name: f.filename,
      size: f.size,
      path: path.relative(p.base, f.path).replace(/\\/g, '/')
    }));
    res.status(201).json({ files: uploaded });
  });
});

// PATCH /api/workspaces/:wsId/files/move  — move file to another folder
app.patch('/api/workspaces/:workspaceId/files/move', (req, res) => {
  const { workspaceId } = req.params;
  const { filePath, targetFolder } = req.body;
  if (!filePath) return res.status(400).json({ error: 'filePath required' });
  const src = safeUploadsPath(workspaceId, filePath);
  const dst = safeUploadsPath(workspaceId, targetFolder || '.');
  if (!src || !dst) return res.status(403).json({ error: 'Forbidden' });
  if (!fs.existsSync(src.resolved)) return res.status(404).json({ error: 'File not found' });
  if (!fs.existsSync(dst.resolved)) fs.mkdirSync(dst.resolved, { recursive: true });
  const destFile = path.join(dst.resolved, path.basename(src.resolved));
  if (src.resolved === destFile) {
    return res.status(400).json({ error: 'File is already in this folder' });
  }
  if (fs.existsSync(destFile)) {
    return res.status(400).json({ error: 'A file with this name already exists in target folder' });
  }
  fs.renameSync(src.resolved, destFile);

  // Synchronize db.json if the file was tracked in dashboard items
  const cleanFilename = path.basename(src.resolved);
  const db = readWorkspaceDB(workspaceId);
  let dbChanged = false;
  const newRelPath = path.relative(src.base, destFile).replace(/\\/g, '/');
  db.items.forEach(item => {
    if (item.type === 'file' && item.filePath && item.filePath.includes(cleanFilename)) {
      item.filePath = `/uploads/${workspaceId}/${newRelPath}`;
      dbChanged = true;
    }
  });
  if (dbChanged) writeWorkspaceDB(workspaceId, db);

  res.json({ name: path.basename(destFile), path: newRelPath });
});

// PATCH /api/workspaces/:wsId/files/rename  — rename file
app.patch('/api/workspaces/:workspaceId/files/rename', (req, res) => {
  const { workspaceId } = req.params;
  const { filePath, newName } = req.body;
  if (!filePath || !newName) return res.status(400).json({ error: 'filePath and newName required' });
  const p = safeUploadsPath(workspaceId, filePath);
  if (!p) return res.status(403).json({ error: 'Forbidden' });
  const cleanName = newName.trim().replace(/[<>:"/\\|?*]/g, '_');
  const newPath = path.join(path.dirname(p.resolved), cleanName);
  if (fs.existsSync(newPath)) return res.status(400).json({ error: 'Name already exists' });
  fs.renameSync(p.resolved, newPath);
  res.json({ name: cleanName, path: path.relative(p.base, newPath).replace(/\\/g, '/') });
});

// DELETE /api/workspaces/:wsId/files  — delete file by path
app.delete('/api/workspaces/:workspaceId/files', (req, res) => {
  const { workspaceId } = req.params;
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'filePath required' });
  const p = safeUploadsPath(workspaceId, filePath);
  if (!p) return res.status(403).json({ error: 'Forbidden' });
  if (!fs.existsSync(p.resolved)) return res.status(404).json({ error: 'File not found' });
  fs.unlinkSync(p.resolved);
  res.json({ message: 'File deleted' });
});

// Dynamic File Streaming — supports nested paths (e.g. /uploads/wsId/folder/sub/file.pdf)
app.get('/uploads/:workspaceId/*', (req, res) => {
  const { workspaceId } = req.params;
  const cleanWsId = path.basename(workspaceId);
  const relFilePath = req.params[0];
  const safePath = path.normalize(relFilePath).replace(/^(\.\.(\/|\\|$))+/, '');
  const base = path.join(WORKSPACES_DIR, cleanWsId, 'uploads');
  const absolutePath = path.join(base, safePath);
  if (!absolutePath.startsWith(base)) return res.status(403).json({ error: 'Forbidden' });
  if (fs.existsSync(absolutePath)) {
    res.sendFile(absolutePath);
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// Start Server (when run standalone)
if (require.main === module || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Workspace server is running at http://localhost:${PORT}`);
  });
}

module.exports = app;
