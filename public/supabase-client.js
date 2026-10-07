/**
 * Supabase Cloud Database & Authentication Integration
 * Enables real-time database sync, multi-device cloud login, and cloud PDF storage.
 */
window.SupabaseManager = (function() {
  const STORAGE_KEY_URL = 'workspace_supabase_url';
  const STORAGE_KEY_ANON = 'workspace_supabase_anon_key';

  let client = null;
  let realtimeChannel = null;
  let isConnected = false;
  let currentConfig = {
    url: localStorage.getItem(STORAGE_KEY_URL) || '',
    anonKey: localStorage.getItem(STORAGE_KEY_ANON) || ''
  };

  // Embedded SQL Schema for 1-Click Copy
  const SQL_SCHEMA = `-- ============================================================
-- Supabase Database Schema for Workspace Hub
-- Run this in your Supabase SQL Editor (https://app.supabase.com)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  name TEXT,
  avatar_url TEXT,
  provider TEXT DEFAULT 'email',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.workspaces (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, workspace_id, name)
);

CREATE TABLE IF NOT EXISTS public.folders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  parent TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, workspace_id, parent, name)
);

CREATE TABLE IF NOT EXISTS public.items (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  workspace_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('link', 'file', 'note')),
  title TEXT NOT NULL,
  url TEXT,
  filename TEXT,
  original_name TEXT,
  file_size BIGINT DEFAULT 0,
  file_type TEXT,
  file_path TEXT,
  content TEXT,
  category TEXT DEFAULT 'General',
  folder TEXT DEFAULT '',
  tags TEXT[] DEFAULT '{}',
  is_pinned BOOLEAN DEFAULT FALSE,
  is_favorite BOOLEAN DEFAULT FALSE,
  priority TEXT DEFAULT 'normal',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO storage.buckets (id, name, public)
VALUES ('workspace-files', 'workspace-files', true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own profile" ON public.profiles;
CREATE POLICY "Users can read their own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can manage their own workspaces" ON public.workspaces;
CREATE POLICY "Users can manage their own workspaces" ON public.workspaces FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own categories" ON public.categories;
CREATE POLICY "Users can manage their own categories" ON public.categories FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own folders" ON public.folders;
CREATE POLICY "Users can manage their own folders" ON public.folders FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own items" ON public.items;
CREATE POLICY "Users can manage their own items" ON public.items FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authenticated users can upload files" ON storage.objects;
CREATE POLICY "Authenticated users can upload files" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'workspace-files');
DROP POLICY IF EXISTS "Authenticated users can update their files" ON storage.objects;
CREATE POLICY "Authenticated users can update their files" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'workspace-files');
DROP POLICY IF EXISTS "Authenticated users can delete their files" ON storage.objects;
CREATE POLICY "Authenticated users can delete their files" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'workspace-files');
DROP POLICY IF EXISTS "Anyone can read workspace files" ON storage.objects;
CREATE POLICY "Anyone can read workspace files" ON storage.objects FOR SELECT USING (bucket_id = 'workspace-files');

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  default_ws_id TEXT;
BEGIN
  INSERT INTO public.profiles (id, email, name, avatar_url, provider)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', NULL),
    COALESCE(NEW.raw_app_meta_data->>'provider', 'email')
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, profiles.name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url),
    updated_at = NOW();

  default_ws_id := 'ws_' || replace(NEW.id::text, '-', '_');
  INSERT INTO public.workspaces (id, user_id, name, is_default)
  VALUES (default_ws_id, NEW.id, 'My Workspace', TRUE)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.categories (user_id, workspace_id, name)
  VALUES 
    (NEW.id, default_ws_id, 'General'),
    (NEW.id, default_ws_id, 'Work'),
    (NEW.id, default_ws_id, 'Personal'),
    (NEW.id, default_ws_id, 'Study'),
    (NEW.id, default_ws_id, 'Finance')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();`;

  // Initialize Supabase Client
  async function init() {
    // 1. Fetch server config if not in localStorage
    if (!currentConfig.url || !currentConfig.anonKey) {
      try {
        const res = await fetch('/api/config');
        if (res.ok) {
          const cfg = await res.json();
          if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
            currentConfig.url = cfg.supabaseUrl;
            currentConfig.anonKey = cfg.supabaseAnonKey;
            localStorage.setItem(STORAGE_KEY_URL, cfg.supabaseUrl);
            localStorage.setItem(STORAGE_KEY_ANON, cfg.supabaseAnonKey);
          }
        }
      } catch (e) {}
    }

    if (currentConfig.url && currentConfig.anonKey && window.supabase) {
      try {
        client = window.supabase.createClient(currentConfig.url, currentConfig.anonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        });
        isConnected = true;
        console.log('[SUPABASE] Client successfully initialized for project:', currentConfig.url);
      } catch (err) {
        console.error('[SUPABASE] Client initialization error:', err);
        isConnected = false;
      }
    } else {
      client = null;
      isConnected = false;
    }

    updateStatusUI();
    setupConfigModalEvents();
  }

  function isConfigured() {
    return Boolean(client && currentConfig.url && currentConfig.anonKey);
  }

  function getClient() {
    return client;
  }

  function getConfig() {
    return { ...currentConfig };
  }

  function getSchemaSQL() {
    return SQL_SCHEMA;
  }

  function updateStatusUI() {
    const btnStatus = document.getElementById('btn-supabase-status');
    const statusDot = document.getElementById('supabase-status-dot');
    const statusText = document.getElementById('supabase-status-text');

    if (!btnStatus || !statusText) return;

    if (isConfigured()) {
      btnStatus.className = 'btn-supabase-status';
      statusText.textContent = 'Supabase Cloud (Active)';
      btnStatus.title = `Connected to Supabase Cloud: ${currentConfig.url}`;
    } else {
      btnStatus.className = 'btn-supabase-status status-offline';
      statusText.textContent = 'Supabase Cloud';
      btnStatus.title = 'Connect Supabase for Cloud Database & Multi-Device Login';
    }

    if (window.lucide) lucide.createIcons();
  }

  async function saveConfig(url, anonKey) {
    currentConfig.url = (url || '').trim();
    currentConfig.anonKey = (anonKey || '').trim();

    if (currentConfig.url && currentConfig.anonKey) {
      localStorage.setItem(STORAGE_KEY_URL, currentConfig.url);
      localStorage.setItem(STORAGE_KEY_ANON, currentConfig.anonKey);

      // Save to server
      try {
        await fetch('/api/config/supabase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            supabaseUrl: currentConfig.url,
            supabaseAnonKey: currentConfig.anonKey
          })
        });
      } catch (e) {}

      if (window.supabase) {
        client = window.supabase.createClient(currentConfig.url, currentConfig.anonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        });
        isConnected = true;
      }
    } else {
      localStorage.removeItem(STORAGE_KEY_URL);
      localStorage.removeItem(STORAGE_KEY_ANON);
      client = null;
      isConnected = false;
    }

    updateStatusUI();
  }

  async function testConnection() {
    if (!client) {
      return { success: false, message: 'Supabase client is not configured.' };
    }
    try {
      const { data, error } = await client.from('workspaces').select('id').limit(1);
      if (error && error.code !== 'PGRST116') {
        // Table might not exist yet
        if (error.message && error.message.includes('relation "public.workspaces" does not exist')) {
          return {
            success: true,
            warning: true,
            message: 'Connected to Supabase! Note: Please execute the SQL Schema in Supabase SQL Editor to create tables.'
          };
        }
        return { success: false, message: error.message || 'Database query error' };
      }
      return { success: true, message: 'Successfully connected to Supabase Cloud Database & Auth!' };
    } catch (err) {
      return { success: false, message: err.message || 'Network error while connecting to Supabase.' };
    }
  }

  // ================================================================
  // Supabase Auth Methods
  // ================================================================
  async function signUp(name, email, password) {
    if (!client) throw new Error('Supabase is not configured');
    const { data, error } = await client.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          name: name.trim(),
          full_name: name.trim()
        }
      }
    });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    if (!client) throw new Error('Supabase is not configured');
    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password
    });
    if (error) throw error;
    return data;
  }

  async function signInWithGoogle() {
    if (!client) throw new Error('Supabase is not configured');
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
    if (error) throw error;
    return data;
  }

  async function signInWithMagicLink(email) {
    if (!client) throw new Error('Supabase is not configured');
    const { data, error } = await client.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: window.location.origin
      }
    });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    if (client) {
      try {
        // Race against a short 1200ms timeout so network delay or hanging auth calls never block logout
        await Promise.race([
          client.auth.signOut(),
          new Promise(resolve => setTimeout(resolve, 1200))
        ]);
      } catch (e) {
        console.warn('Supabase signOut warning:', e);
      }
    }
  }

  async function getSession() {
    if (!client) return null;
    const { data: { session } } = await client.auth.getSession();
    return session;
  }

  async function getUser() {
    if (!client) return null;
    try {
      const { data: { user } } = await client.auth.getUser();
      if (user) return user;
    } catch (e) { }

    try {
      const { data: { session } } = await client.auth.getSession();
      if (session && session.user) return session.user;
    } catch (e) { }

    if (window.Auth && typeof window.Auth.getUser === 'function') {
      const u = window.Auth.getUser();
      if (u && u.id) return u;
    }

    return null;
  }

  async function updateUserProfile(name, newPassword) {
    if (!client) throw new Error('Supabase is not configured');
    const updates = {};
    if (name) {
      updates.data = { name, full_name: name };
    }
    if (newPassword) {
      updates.password = newPassword;
    }
    const { data, error } = await client.auth.updateUser(updates);
    if (error) throw error;

    if (name && data.user) {
      await client.from('profiles').update({ name, updated_at: new Date().toISOString() }).eq('id', data.user.id);
    }
    return data;
  }

  // ================================================================
  // Supabase Database Methods (Workspaces, Items, Categories, Folders)
  // ================================================================
  async function fetchWorkspaces() {
    if (!client) return null;
    const user = await getUser();
    if (!user) return null;

    const { data, error } = await client
      .from('workspaces')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) throw error;

    let workspacesList = data || [];
    if (workspacesList.length === 0) {
      // Create initial default workspace for user
      const defaultWsId = `ws_${user.id.replace(/[^a-z0-9]/gi, '_')}`;
      const { data: created, error: createErr } = await client
        .from('workspaces')
        .insert([{
          id: defaultWsId,
          user_id: user.id,
          name: 'My Workspace',
          is_default: true
        }])
        .select();

      if (!createErr && created) {
        workspacesList = created;
      }
    }

    return {
      activeWorkspace: workspacesList[0] ? workspacesList[0].id : 'default',
      workspaces: workspacesList
    };
  }

  async function createWorkspace(name) {
    if (!client) return null;
    const user = await getUser();
    if (!user) throw new Error('User not logged in. Please sign in to create workspaces.');

    const cleanName = name.trim();
    const id = `ws_${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now().toString().slice(-4)}`;

    const { data, error } = await client
      .from('workspaces')
      .insert([{
        id,
        user_id: user.id,
        name: cleanName,
        is_default: false
      }])
      .select();

    if (error) throw error;

    // Create default categories (safe try-catch)
    try {
      await client.from('categories').insert([
        { user_id: user.id, workspace_id: id, name: 'General' },
        { user_id: user.id, workspace_id: id, name: 'Work' },
        { user_id: user.id, workspace_id: id, name: 'Personal' },
        { user_id: user.id, workspace_id: id, name: 'Study' },
        { user_id: user.id, workspace_id: id, name: 'Finance' }
      ]);
    } catch (e) { }

    return data && data[0] ? data[0] : { id, name: cleanName };
  }

  async function deleteWorkspace(id) {
    if (!client) return null;
    const user = await getUser();
    if (!user) throw new Error('User not logged in');

    const { error } = await client
      .from('workspaces')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) throw error;
    return true;
  }

  async function fetchWorkspaceData(workspaceId) {
    if (!client) return null;
    const user = await getUser();
    if (!user) return null;

    // Fetch categories and items in parallel
    const [catRes, itemsRes, foldersRes] = await Promise.all([
      client.from('categories').select('name').eq('workspace_id', workspaceId).order('created_at', { ascending: true }),
      client.from('items').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
      client.from('folders').select('*').eq('workspace_id', workspaceId).order('name', { ascending: true })
    ]);

    const categories = (catRes.data || []).map(c => c.name);
    if (!categories.includes('General')) categories.unshift('General');

    const items = (itemsRes.data || []).map(item => ({
      id: item.id,
      type: item.type,
      title: item.title,
      url: item.url,
      fileName: item.filename || item.original_name,
      originalName: item.original_name,
      fileSize: item.file_size ? parseInt(item.file_size, 10) : 0,
      fileType: item.file_type,
      filePath: item.file_path,
      content: item.content,
      category: item.category || 'General',
      folder: item.folder || '',
      tags: item.tags || [],
      isPinned: item.is_pinned || false,
      isFavorite: item.is_favorite || false,
      priority: item.priority || 'normal',
      createdAt: item.created_at,
      updatedAt: item.updated_at
    }));

    return {
      categories,
      items,
      folders: foldersRes.data || []
    };
  }

  async function addItem(workspaceId, item) {
    if (!client) return null;
    const user = await getUser();
    if (!user) throw new Error('User not logged in');

    const id = item.id || `item_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const row = {
      id,
      user_id: user.id,
      workspace_id: workspaceId,
      type: item.type,
      title: item.title,
      url: item.url || null,
      filename: item.fileName || item.filename || null,
      original_name: item.originalName || item.fileName || null,
      file_size: item.fileSize || 0,
      file_type: item.fileType || null,
      file_path: item.filePath || null,
      content: item.content || null,
      category: item.category || 'General',
      folder: item.folder || '',
      tags: item.tags || [],
      is_pinned: Boolean(item.isPinned),
      is_favorite: Boolean(item.isFavorite),
      priority: item.priority || 'normal',
      created_at: item.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await client.from('items').insert([row]).select();
    if (error) throw error;
    return data[0];
  }

  async function updateItem(workspaceId, itemId, updates) {
    if (!client) return null;
    const user = await getUser();
    if (!user) throw new Error('User not logged in');

    const patch = { updated_at: new Date().toISOString() };
    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.url !== undefined) patch.url = updates.url;
    if (updates.content !== undefined) patch.content = updates.content;
    if (updates.category !== undefined) patch.category = updates.category;
    if (updates.folder !== undefined) patch.folder = updates.folder;
    if (updates.isPinned !== undefined) patch.is_pinned = updates.isPinned;
    if (updates.isFavorite !== undefined) patch.is_favorite = updates.isFavorite;
    if (updates.priority !== undefined) patch.priority = updates.priority;

    const { data, error } = await client
      .from('items')
      .update(patch)
      .eq('id', itemId)
      .eq('user_id', user.id);

    if (error) throw error;
    return data;
  }

  async function deleteItem(workspaceId, itemId) {
    if (!client) return null;
    const user = await getUser();
    if (!user) throw new Error('User not logged in');

    const { error } = await client
      .from('items')
      .delete()
      .eq('id', itemId)
      .eq('user_id', user.id);

    if (error) throw error;
    return true;
  }

  async function addCategory(workspaceId, name) {
    if (!client) return null;
    const user = await getUser();
    if (!user) throw new Error('User not logged in');

    const { data, error } = await client.from('categories').insert([{
      user_id: user.id,
      workspace_id: workspaceId,
      name: name.trim()
    }]).select();

    if (error) throw error;
    return data[0];
  }

  async function deleteCategory(workspaceId, name) {
    if (!client) return null;
    const user = await getUser();
    if (!user) throw new Error('User not logged in');

    const { error } = await client
      .from('categories')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .eq('name', name);

    if (error) throw error;
    return true;
  }

  // Upload file to Supabase Storage
  async function uploadFile(workspaceId, file, folder = '') {
    if (!client) throw new Error('Supabase is not configured');
    const user = await getUser();
    if (!user) throw new Error('User not logged in');

    const ext = file.name.split('.').pop();
    const cleanBaseName = file.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9-_]/g, '_');
    const storagePath = `${user.id}/${workspaceId}/${folder ? folder + '/' : ''}${cleanBaseName}_${Date.now()}.${ext}`;

    const { data: uploadData, error: uploadErr } = await client.storage
      .from('workspace-files')
      .upload(storagePath, file, {
        cacheControl: '3600',
        upsert: true
      });

    if (uploadErr) throw uploadErr;

    const { data: publicUrlData } = client.storage
      .from('workspace-files')
      .getPublicUrl(storagePath);

    const publicUrl = publicUrlData.publicUrl;

    // Create item in items table
    const item = await addItem(workspaceId, {
      type: 'file',
      title: file.name,
      fileName: file.name,
      originalName: file.name,
      fileSize: file.size,
      fileType: file.type || ext,
      filePath: publicUrl,
      url: publicUrl,
      folder: folder || ''
    });

    return { item, url: publicUrl };
  }

  // Realtime Subscriptions for live multi-device updates
  function subscribeRealtime(workspaceId, onDataChanged) {
    if (!client) return;

    if (realtimeChannel) {
      client.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }

    try {
      realtimeChannel = client
        .channel(`workspace-sync-${workspaceId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'items', filter: `workspace_id=eq.${workspaceId}` },
          (payload) => {
            console.log('[SUPABASE REALTIME] Items table changed on cloud:', payload);
            if (typeof onDataChanged === 'function') onDataChanged();
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'categories', filter: `workspace_id=eq.${workspaceId}` },
          (payload) => {
            console.log('[SUPABASE REALTIME] Categories table changed on cloud:', payload);
            if (typeof onDataChanged === 'function') onDataChanged();
          }
        )
        .subscribe();
    } catch (e) {
      console.warn('[SUPABASE] Realtime subscription warning:', e);
    }
  }

  // Migrate local JSON data to Supabase
  async function migrateLocalData(localWorkspaces, activeWsId, activeData) {
    if (!client) throw new Error('Supabase is not configured');
    const user = await getUser();
    if (!user) throw new Error('Please sign in to Supabase before migrating local data.');

    let migratedWorkspaces = 0;
    let migratedItems = 0;
    let migratedCategories = 0;

    // 1. Workspaces
    if (localWorkspaces && localWorkspaces.length > 0) {
      for (const ws of localWorkspaces) {
        const { error } = await client.from('workspaces').upsert({
          id: ws.id,
          user_id: user.id,
          name: ws.name,
          is_default: ws.id === 'default'
        });
        if (!error) migratedWorkspaces++;
      }
    }

    // 2. Categories
    if (activeData && activeData.categories) {
      for (const cat of activeData.categories) {
        const { error } = await client.from('categories').upsert({
          user_id: user.id,
          workspace_id: activeWsId,
          name: cat
        }, { onConflict: 'user_id,workspace_id,name' });
        if (!error) migratedCategories++;
      }
    }

    // 3. Items
    if (activeData && activeData.items && activeData.items.length > 0) {
      for (const item of activeData.items) {
        const row = {
          id: item.id || `item_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          user_id: user.id,
          workspace_id: activeWsId,
          type: item.type,
          title: item.title,
          url: item.url || null,
          filename: item.fileName || null,
          original_name: item.fileName || null,
          file_size: item.fileSize || 0,
          file_type: item.fileType || null,
          file_path: item.filePath || null,
          content: item.content || null,
          category: item.category || 'General',
          folder: item.folder || '',
          tags: item.tags || [],
          is_pinned: Boolean(item.isPinned),
          is_favorite: Boolean(item.isFavorite),
          priority: item.priority || 'normal',
          created_at: item.createdAt || new Date().toISOString()
        };
        const { error } = await client.from('items').upsert(row);
        if (!error) migratedItems++;
      }
    }

    return {
      workspaces: migratedWorkspaces,
      categories: migratedCategories,
      items: migratedItems
    };
  }

  // Setup modal and UI buttons
  function setupConfigModalEvents() {
    const btnStatus = document.getElementById('btn-supabase-status');
    const modalConfig = document.getElementById('modal-supabase-config');
    const btnCloseModal = document.getElementById('btn-close-supabase-modal');
    const btnCancel = document.getElementById('btn-cancel-supabase');
    const formConfig = document.getElementById('form-supabase-config');
    const inputUrl = document.getElementById('supabase-project-url');
    const inputKey = document.getElementById('supabase-anon-key');
    const btnTest = document.getElementById('btn-test-supabase');
    const btnMigrate = document.getElementById('btn-migrate-to-supabase');
    const btnCopySql = document.getElementById('btn-copy-schema-sql');
    const sqlPreview = document.getElementById('supabase-sql-preview');

    if (sqlPreview) {
      sqlPreview.textContent = SQL_SCHEMA;
    }

    if (btnStatus) {
      btnStatus.addEventListener('click', () => {
        if (inputUrl) inputUrl.value = currentConfig.url || '';
        if (inputKey) inputKey.value = currentConfig.anonKey || '';
        if (modalConfig) modalConfig.classList.add('active');
        if (window.lucide) lucide.createIcons();
      });
    }

    if (btnCloseModal) {
      btnCloseModal.addEventListener('click', () => modalConfig.classList.remove('active'));
    }
    if (btnCancel) {
      btnCancel.addEventListener('click', () => modalConfig.classList.remove('active'));
    }
    if (modalConfig) {
      modalConfig.addEventListener('click', (e) => {
        if (e.target === modalConfig) modalConfig.classList.remove('active');
      });
    }

    if (btnCopySql) {
      btnCopySql.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(SQL_SCHEMA);
          if (typeof showToast === 'function') {
            showToast('Supabase SQL Schema copied to clipboard!', 'check-circle-2');
          }
        } catch {
          const ta = document.createElement('textarea');
          ta.value = SQL_SCHEMA;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
          if (typeof showToast === 'function') {
            showToast('Supabase SQL Schema copied to clipboard!', 'check-circle-2');
          }
        }
      });
    }

    if (btnTest) {
      btnTest.addEventListener('click', async () => {
        const url = inputUrl.value.trim();
        const key = inputKey.value.trim();
        if (!url || !key) {
          alert('Please enter both Supabase Project URL and Anon Key first.');
          return;
        }

        btnTest.disabled = true;
        btnTest.innerHTML = `<i data-lucide="loader-2"></i> Testing...`;
        if (window.lucide) lucide.createIcons();

        try {
          const tempClient = window.supabase.createClient(url, key);
          const { error } = await tempClient.from('workspaces').select('id').limit(1);
          
          if (error && !error.message.includes('relation "public.workspaces" does not exist')) {
            alert(`Connection failed: ${error.message}`);
          } else {
            alert('🟢 Connection successful! Your Supabase project is reachable.');
          }
        } catch (err) {
          alert(`Connection error: ${err.message}`);
        } finally {
          btnTest.disabled = false;
          btnTest.innerHTML = `<i data-lucide="activity"></i> <span>Test Connection</span>`;
          if (window.lucide) lucide.createIcons();
        }
      });
    }

    if (formConfig) {
      formConfig.addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = inputUrl.value.trim();
        const key = inputKey.value.trim();

        await saveConfig(url, key);
        if (modalConfig) modalConfig.classList.remove('active');

        if (typeof showToast === 'function') {
          showToast('Supabase configuration saved & connected!', 'cloud');
        }

        // Re-initialize app data with Supabase
        if (typeof initWorkspaceHub === 'function') {
          await initWorkspaceHub();
        }
      });
    }

    if (btnMigrate) {
      btnMigrate.addEventListener('click', async () => {
        if (!isConfigured()) {
          alert('Please save and connect to Supabase first before migrating.');
          return;
        }
        const user = await getUser();
        if (!user) {
          alert('Please sign in with your Supabase account first, then run migration.');
          return;
        }

        btnMigrate.disabled = true;
        btnMigrate.innerHTML = `<i data-lucide="loader-2"></i> Migrating...`;
        if (window.lucide) lucide.createIcons();

        try {
          const result = await migrateLocalData(window.workspaces, window.activeWorkspaceId, window.dbData);
          alert(`Migration Complete!\n• Workspaces: ${result.workspaces}\n• Categories: ${result.categories}\n• Items: ${result.items}`);
          if (typeof initWorkspaceHub === 'function') {
            await initWorkspaceHub();
          }
        } catch (err) {
          alert(`Migration error: ${err.message}`);
        } finally {
          btnMigrate.disabled = false;
          btnMigrate.innerHTML = `<i data-lucide="upload-cloud"></i> <span>Migrate Local Data to Cloud</span>`;
          if (window.lucide) lucide.createIcons();
        }
      });
    }
  }

  return {
    init,
    isConfigured,
    getClient,
    getConfig,
    getSchemaSQL,
    saveConfig,
    testConnection,
    signUp,
    signIn,
    signInWithGoogle,
    signInWithMagicLink,
    signOut,
    getSession,
    getUser,
    updateUserProfile,
    fetchWorkspaces,
    createWorkspace,
    deleteWorkspace,
    fetchWorkspaceData,
    addItem,
    updateItem,
    deleteItem,
    addCategory,
    deleteCategory,
    uploadFile,
    subscribeRealtime,
    migrateLocalData
  };
})();
