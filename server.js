// Load .env manually — ensures our values always win over any pre-injected env vars
(function loadEnv() {
  try {
    const fs = require('fs');
    const path = require('path');
    const envFile = path.join(__dirname, '.env');
    const lines = fs.readFileSync(envFile, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      process.env[key] = value; // Always override
    }
  } catch (e) {
    console.warn('[ENV] Could not load .env file:', e.message);
  }
})();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'workspace_hub_super_secret_jwt_key_2026_x99';

// ================= SUPABASE CLIENT INITIALIZATION =================
let supabaseClient = null;
function initSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (url && key) {
    try {
      supabaseClient = createClient(url, key, { auth: { persistSession: false } });
      console.log('[SUPABASE] Server initialized with project:', url);
    } catch (e) {
      console.error('[SUPABASE] Failed to initialize Supabase client:', e.message);
    }
  } else {
    supabaseClient = null;
  }
}
initSupabase();

const WORKSPACES_DIR = path.join(__dirname, 'workspaces');
const REGISTRY_FILE = path.join(WORKSPACES_DIR, 'registry.json');
const USERS_FILE = path.join(WORKSPACES_DIR, 'users.json');

// Ensure workspaces folder exists
try {
  if (!fs.existsSync(WORKSPACES_DIR)) {
    fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
  }
} catch (e) { }

// ================= USER STORAGE & HELPERS =================
function readUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      return [];
    }
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading users.json', error);
    return [];
  }
}

function writeUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing users.json', error);
    return false;
  }
}

function normalizeUserRole(role) {
  const value = String(role || '').trim().toLowerCase();
  return value === 'admin' ? 'admin' : 'client';
}

function sanitizeUser(user) {
  if (!user) return user;
  return {
    ...user,
    role: normalizeUserRole(user.role),
    provider: user.provider || 'local'
  };
}

function generateUserToken(user) {
  const safeUser = sanitizeUser(user);
  return jwt.sign(
    {
      id: safeUser.id,
      email: safeUser.email,
      name: safeUser.name,
      avatar: safeUser.avatar || null,
      role: safeUser.role,
      provider: safeUser.provider
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

async function ensureDefaultAdminUser() {
  const users = readUsers();
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@workspace.local').trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin1234';

  let adminUser = users.find(u => u.email && u.email.toLowerCase() === adminEmail);

  if (!adminUser) {
    adminUser = {
      id: `admin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: 'Site Admin',
      email: adminEmail,
      password: await bcrypt.hash(adminPassword, 10),
      provider: 'local',
      role: 'admin',
      avatar: null,
      createdAt: new Date().toISOString()
    };
    users.push(adminUser);
    writeUsers(users);
    console.log(`[AUTH] Default admin account created for ${adminEmail}`);
  } else {
    adminUser.role = 'admin';
    adminUser.provider = adminUser.provider || 'local';
    const index = users.findIndex(u => u.id === adminUser.id);
    if (index >= 0) {
      users[index] = adminUser;
      writeUsers(users);
    }
  }

  return adminUser;
}

// Authentication Middleware (Supports both Supabase Cloud Auth and Local JWT)
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token && req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  // 1. Try Supabase verification if Supabase is active
  if (supabaseClient) {
    try {
      const { data: { user }, error } = await supabaseClient.auth.getUser(token);
      if (!error && user) {
        req.user = {
          id: user.id,
          email: user.email,
          name: user.user_metadata?.name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
          avatar: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
          provider: user.app_metadata?.provider || 'supabase'
        };
        return next();
      }
    } catch (e) {
      // Fall through to local JWT check
    }
  }

  // 2. Local JWT Token Verification
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Session expired or invalid token. Please log in again.' });
    }
    req.user = decoded;
    next();
  });
}

// Optional Auth (for public resources or backwards compatibility)
async function optionalAuthenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token && req.query && req.query.token) {
    token = req.query.token;
  }

  if (token) {
    if (supabaseClient) {
      try {
        const { data: { user } } = await supabaseClient.auth.getUser(token);
        if (user) {
          req.user = {
            id: user.id,
            email: user.email,
            name: user.user_metadata?.name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
            avatar: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
            provider: user.app_metadata?.provider || 'supabase'
          };
          return next();
        }
      } catch (e) { }
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (!err && decoded) {
        req.user = decoded;
      }
      next();
    });
  } else {
    next();
  }
}

// Load or create registry.json
let registry = {
  activeWorkspace: 'default',
  workspaces: [
    { id: 'default', name: 'Default Workspace', ownerId: null, createdAt: new Date().toISOString() }
  ]
};

if (fs.existsSync(REGISTRY_FILE)) {
  try {
    registry = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    if (!registry.workspaces) registry.workspaces = [];
  } catch (error) {
    console.error('Error reading registry.json, resetting structure', error);
  }
} else {
  try {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
  } catch (e) { }
}

// Setup default workspace folders
const defaultWSPath = path.join(WORKSPACES_DIR, 'default');
const defaultWSUploadsPath = path.join(defaultWSPath, 'uploads');
try {
  if (!fs.existsSync(defaultWSPath)) {
    fs.mkdirSync(defaultWSPath, { recursive: true });
  }
  if (!fs.existsSync(defaultWSUploadsPath)) {
    fs.mkdirSync(defaultWSUploadsPath, { recursive: true });
  }
} catch (e) { }

// --- Legacy Migration Block ---
const legacyDBFile = path.join(__dirname, 'db.json');
const legacyUploadsDir = path.join(__dirname, 'uploads');
const defaultDBFile = path.join(defaultWSPath, 'db.json');

try {
  if (fs.existsSync(legacyDBFile)) {
    console.log('[MIGRATION] Migrating legacy db.json to workspaces/default/db.json');
    fs.renameSync(legacyDBFile, defaultDBFile);
  }
} catch (err) { }

try {
  if (!fs.existsSync(defaultDBFile)) {
    const initialData = {
      categories: ['General', 'Work', 'Personal', 'Study', 'Finance'],
      items: []
    };
    fs.writeFileSync(defaultDBFile, JSON.stringify(initialData, null, 2));
  }
} catch (e) { }

try {
  if (fs.existsSync(legacyUploadsDir)) {
    console.log('[MIGRATION] Moving files from legacy uploads directory...');
    const files = fs.readdirSync(legacyUploadsDir);
    files.forEach(file => {
      const srcPath = path.join(legacyUploadsDir, file);
      const destPath = path.join(defaultWSUploadsPath, file);
      fs.renameSync(srcPath, destPath);
    });
    fs.rmdirSync(legacyUploadsDir);
    console.log('[MIGRATION] Cleaned up legacy uploads folder.');
  }
} catch (err) { }
// --- End Migration Block ---

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Serve static files — disable cache for JS/HTML/CSS so changes are always picked up
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.html') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
  }
}));

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

// Helper: Ensure a user has at least one workspace
function ensureUserWorkspace(userId, userName) {
  const userWorkspaces = registry.workspaces.filter(ws => ws.ownerId === userId);
  if (userWorkspaces.length === 0) {
    const wsId = `ws_${userId.replace(/[^a-z0-9]/gi, '_')}`;
    const newWs = {
      id: wsId,
      name: `${userName || 'My'} Workspace`,
      ownerId: userId,
      createdAt: new Date().toISOString()
    };

    // Create folders
    const wsDir = path.join(WORKSPACES_DIR, wsId);
    const uploadsDir = path.join(wsDir, 'uploads');
    try {
      if (!fs.existsSync(wsDir)) fs.mkdirSync(wsDir, { recursive: true });
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

      const dbFile = path.join(wsDir, 'db.json');
      if (!fs.existsSync(dbFile)) {
        const initialData = {
          categories: ['General', 'Work', 'Personal', 'Study', 'Finance'],
          items: []
        };
        fs.writeFileSync(dbFile, JSON.stringify(initialData, null, 2));
      }
    } catch (e) {
      console.error('Error creating user workspace directory:', e);
    }

    registry.workspaces.push(newWs);
    saveRegistry();
    return newWs;
  }
  return userWorkspaces[0];
}

// ================= CONFIGURATION ENDPOINTS =================

// GET /api/config — Expose public Supabase URL & Anon key to frontend
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
    isSupabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)
  });
});

// POST /api/config/supabase — Save or update Supabase credentials
app.post('/api/config/supabase', (req, res) => {
  try {
    const { supabaseUrl, supabaseAnonKey } = req.body;
    if (!supabaseUrl || !supabaseAnonKey) {
      return res.status(400).json({ error: 'Supabase URL and Anon Key are required.' });
    }

    process.env.SUPABASE_URL = supabaseUrl.trim();
    process.env.SUPABASE_ANON_KEY = supabaseAnonKey.trim();
    initSupabase();

    // Persist to .env file
    const envPath = path.join(__dirname, '.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    if (envContent.includes('SUPABASE_URL=')) {
      envContent = envContent.replace(/SUPABASE_URL=.*/, `SUPABASE_URL=${process.env.SUPABASE_URL}`);
    } else {
      envContent += `\nSUPABASE_URL=${process.env.SUPABASE_URL}`;
    }
    if (envContent.includes('SUPABASE_ANON_KEY=')) {
      envContent = envContent.replace(/SUPABASE_ANON_KEY=.*/, `SUPABASE_ANON_KEY=${process.env.SUPABASE_ANON_KEY}`);
    } else {
      envContent += `\nSUPABASE_ANON_KEY=${process.env.SUPABASE_ANON_KEY}`;
    }
    fs.writeFileSync(envPath, envContent.trim() + '\n');

    res.json({
      message: 'Supabase credentials saved successfully',
      supabaseUrl: process.env.SUPABASE_URL,
      isSupabaseConfigured: true
    });
  } catch (err) {
    console.error('Error updating Supabase credentials:', err);
    res.status(500).json({ error: 'Failed to save Supabase credentials' });
  }
});

// ================= AUTHENTICATION ENDPOINTS =================

// Helper to fetch Google Token Info
function verifyGoogleIdToken(token) {
  return new Promise((resolve, reject) => {
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error_description || parsed.error) {
            reject(new Error(parsed.error_description || parsed.error));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();
    const users = readUsers();

    if (users.some(u => u.email && u.email.toLowerCase() === cleanEmail)) {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }

    if (normalizeUserRole(role) === 'admin') {
      return res.status(403).json({ error: 'Admin accounts are created by the site administrator only.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = `usr_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    const newUser = {
      id: userId,
      name: cleanName,
      email: cleanEmail,
      password: hashedPassword,
      provider: 'local',
      role: 'client',
      avatar: null,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    writeUsers(users);

    const userWorkspace = ensureUserWorkspace(userId, cleanName);
    const token = generateUserToken(newUser);

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        avatar: newUser.avatar,
        provider: newUser.provider,
        role: newUser.role
      },
      activeWorkspace: userWorkspace.id
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const users = readUsers();
    const user = users.find(u => u.email && u.email.toLowerCase() === cleanEmail);

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.role) user.role = cleanEmail === (process.env.ADMIN_EMAIL || 'admin@workspace.local').toLowerCase() ? 'admin' : 'client';
    user.role = normalizeUserRole(user.role);

    if (user.provider === 'google' && !user.password) {
      return res.status(400).json({ error: 'This account uses Google Sign-In. Please click "Continue with Google".' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const userWs = ensureUserWorkspace(user.id, user.name);
    const token = generateUserToken(user);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        provider: user.provider,
        role: user.role
      },
      activeWorkspace: userWs.id
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// POST /api/auth/google
app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential, profile } = req.body;
    let googleUser = null;

    if (credential) {
      try {
        // First try official tokeninfo verification
        googleUser = await verifyGoogleIdToken(credential);
      } catch (err) {
        console.warn('Google tokeninfo lookup warning, falling back to decoded payload:', err.message);
        // Decode JWT payload as fallback
        const decoded = jwt.decode(credential);
        if (decoded && decoded.email) {
          googleUser = decoded;
        } else {
          return res.status(400).json({ error: 'Invalid Google authentication credential' });
        }
      }
    } else if (profile && profile.email) {
      // Direct OAuth profile (demo or client-side verified)
      googleUser = profile;
    } else {
      return res.status(400).json({ error: 'Missing Google credential or profile data' });
    }

    const email = (googleUser.email || '').toLowerCase().trim();
    const name = googleUser.name || googleUser.given_name || email.split('@')[0] || 'Google User';
    const avatar = googleUser.picture || null;
    const googleId = googleUser.sub || googleUser.id || `g_${Date.now()}`;

    if (!email) {
      return res.status(400).json({ error: 'Could not retrieve email from Google account' });
    }

    const users = readUsers();
    let user = users.find(u => u.email.toLowerCase() === email);

    if (user) {
      // Update existing user with Google details
      user.googleId = googleId;
      if (!user.avatar && avatar) user.avatar = avatar;
      if (user.provider !== 'local') user.provider = 'google';
      writeUsers(users);
    } else {
      // Create new user
      const userId = `usr_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      user = {
        id: userId,
        name: name,
        email: email,
        password: null,
        provider: 'google',
        googleId: googleId,
        avatar: avatar,
        createdAt: new Date().toISOString()
      };
      users.push(user);
      writeUsers(users);
    }

    // Ensure user has default workspace
    const userWs = ensureUserWorkspace(user.id, user.name);

    const token = generateUserToken(user);
    res.json({
      message: 'Google authentication successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        provider: user.provider
      },
      activeWorkspace: userWs.id
    });
  } catch (error) {
    console.error('Google Auth error:', error);
    res.status(500).json({ error: 'Internal server error during Google authentication' });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', authenticateToken, (req, res) => {
  const users = readUsers();
  const user = users.find(u => u.id === req.user.id);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const safeUser = sanitizeUser(user);

  res.json({
    user: {
      id: safeUser.id,
      name: safeUser.name,
      email: safeUser.email,
      avatar: safeUser.avatar,
      provider: safeUser.provider,
      role: safeUser.role,
      createdAt: safeUser.createdAt
    }
  });
});

// POST /api/auth/update-profile
app.post('/api/auth/update-profile', authenticateToken, async (req, res) => {
  try {
    const { name, currentPassword, newPassword } = req.body;
    const users = readUsers();
    const user = users.find(u => u.id === req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (name && typeof name === 'string' && name.trim()) {
      user.name = name.trim();
    }

    if (newPassword) {
      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters long' });
      }
      if (user.password) {
        if (!currentPassword) {
          return res.status(400).json({ error: 'Current password is required to set a new password' });
        }
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
          return res.status(400).json({ error: 'Current password is incorrect' });
        }
      }
      user.password = await bcrypt.hash(newPassword, 10);
    }

    writeUsers(users);
    const newToken = generateUserToken(user);

    const safeUser = sanitizeUser(user);

    res.json({
      message: 'Profile updated successfully',
      token: newToken,
      user: {
        id: safeUser.id,
        name: safeUser.name,
        email: safeUser.email,
        avatar: safeUser.avatar,
        provider: safeUser.provider,
        role: safeUser.role
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

// ================= WORKSPACE MANAGE ENDPOINTS =================

// API: Get registry & workspaces list (scoped to authenticated user)
app.get('/api/workspaces', optionalAuthenticateToken, (req, res) => {
  const userId = req.user ? req.user.id : null;

  if (userId) {
    ensureUserWorkspace(userId, req.user.name);
    // Return workspaces owned by user or shared/unowned
    const userWorkspaces = registry.workspaces.filter(ws => !ws.ownerId || ws.ownerId === userId);

    // Choose active workspace
    let activeWs = userWorkspaces.find(ws => ws.id === registry.activeWorkspace);
    if (!activeWs && userWorkspaces.length > 0) {
      activeWs = userWorkspaces[0];
    }

    return res.json({
      activeWorkspace: activeWs ? activeWs.id : 'default',
      workspaces: userWorkspaces
    });
  }

  // Fallback for standalone/guest mode
  res.json(registry);
});

// API: Create workspace
app.post('/api/workspaces', authenticateToken, (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'Workspace name is required' });
  }

  const cleanName = name.trim();
  const userId = req.user.id;

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
    ownerId: userId,
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

  const userWorkspaces = registry.workspaces.filter(ws => !ws.ownerId || ws.ownerId === userId);

  res.status(201).json({
    registry: {
      activeWorkspace: id,
      workspaces: userWorkspaces
    },
    newWorkspace
  });
});

// API: Delete workspace
app.delete('/api/workspaces/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  if (id === 'default') {
    return res.status(400).json({ error: 'Cannot delete the default workspace' });
  }

  const index = registry.workspaces.findIndex(ws => ws.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Workspace not found' });
  }

  const targetWs = registry.workspaces[index];
  if (targetWs.ownerId && targetWs.ownerId !== userId) {
    return res.status(403).json({ error: 'You do not have permission to delete this workspace' });
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

  // Find fallback workspace for this user
  const userWorkspaces = registry.workspaces.filter(ws => !ws.ownerId || ws.ownerId === userId);
  const nextActive = userWorkspaces.length > 0 ? userWorkspaces[0].id : 'default';
  registry.activeWorkspace = nextActive;

  saveRegistry();
  res.json({
    activeWorkspace: nextActive,
    workspaces: userWorkspaces
  });
});

// API: Set active workspace
app.post('/api/workspaces/active', optionalAuthenticateToken, (req, res) => {
  const { id } = req.body;
  const userId = req.user ? req.user.id : null;
  const exists = registry.workspaces.find(ws => ws.id === id);
  if (!exists) {
    return res.status(404).json({ error: 'Workspace not found' });
  }
  registry.activeWorkspace = id;
  saveRegistry();

  const userWorkspaces = userId
    ? registry.workspaces.filter(ws => !ws.ownerId || ws.ownerId === userId)
    : registry.workspaces;

  res.json({
    activeWorkspace: id,
    workspaces: userWorkspaces
  });
});

// ================= DYNAMIC WORKSPACE ITEM CRUD ENDPOINTS =================

// API: Get workspace items & categories
app.get('/api/workspaces/:workspaceId/data', optionalAuthenticateToken, (req, res) => {
  res.json(readWorkspaceDB(req.params.workspaceId));
});

// API: Add Link or Note
app.post('/api/workspaces/:workspaceId/items', optionalAuthenticateToken, (req, res) => {
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
app.delete('/api/workspaces/:workspaceId/items/:itemId', optionalAuthenticateToken, (req, res) => {
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
app.post('/api/workspaces/:workspaceId/categories', optionalAuthenticateToken, (req, res) => {
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
app.get('/api/workspaces/:workspaceId/folders', optionalAuthenticateToken, (req, res) => {
  const { workspaceId } = req.params;
  const p = safeUploadsPath(workspaceId, '.');
  if (!p) return res.status(403).json({ error: 'Forbidden' });
  if (!fs.existsSync(p.base)) fs.mkdirSync(p.base, { recursive: true });
  res.json({ name: 'root', path: '', ...walkFolderTree(p.base, p.base) });
});

// POST /api/workspaces/:wsId/folders  — create folder
app.post('/api/workspaces/:workspaceId/folders', optionalAuthenticateToken, (req, res) => {
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
app.delete('/api/workspaces/:workspaceId/folders', optionalAuthenticateToken, (req, res) => {
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
app.patch('/api/workspaces/:workspaceId/folders', optionalAuthenticateToken, (req, res) => {
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
app.patch('/api/workspaces/:workspaceId/files/move', optionalAuthenticateToken, (req, res) => {
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
app.patch('/api/workspaces/:workspaceId/files/rename', optionalAuthenticateToken, (req, res) => {
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
app.delete('/api/workspaces/:workspaceId/files', optionalAuthenticateToken, (req, res) => {
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

// Fallback to index.html for frontend
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server (when run standalone)
if (require.main === module || !process.env.VERCEL) {
  ensureDefaultAdminUser().then(() => {
    app.listen(PORT, () => {
      console.log(`Workspace server is running at http://localhost:${PORT}`);
    });
  }).catch((err) => {
    console.error('[AUTH] Failed to initialize admin account:', err);
    app.listen(PORT, () => {
      console.log(`Workspace server is running at http://localhost:${PORT}`);
    });
  });
}

module.exports = app;
