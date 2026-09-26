-- ============================================================
-- Supabase Database Schema for Workspace Hub
-- Run this in your Supabase SQL Editor (https://app.supabase.com)
-- ============================================================

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Profiles Table (Linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  name TEXT,
  avatar_url TEXT,
  provider TEXT DEFAULT 'email',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Workspaces Table
CREATE TABLE IF NOT EXISTS public.workspaces (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Categories Table
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, workspace_id, name)
);

-- 5. Folders Table
CREATE TABLE IF NOT EXISTS public.folders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  parent TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, workspace_id, parent, name)
);

-- 6. Items Table (Links, Notes, Files, PDFs)
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

-- 7. Storage Bucket for PDF and Files
INSERT INTO storage.buckets (id, name, public)
VALUES ('workspace-files', 'workspace-files', true)
ON CONFLICT (id) DO NOTHING;

-- 8. Enable Row Level Security (RLS) on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

-- 9. RLS Policies for Profiles
DROP POLICY IF EXISTS "Users can read their own profile" ON public.profiles;
CREATE POLICY "Users can read their own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- 10. RLS Policies for Workspaces
DROP POLICY IF EXISTS "Users can manage their own workspaces" ON public.workspaces;
CREATE POLICY "Users can manage their own workspaces" ON public.workspaces
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 11. RLS Policies for Categories
DROP POLICY IF EXISTS "Users can manage their own categories" ON public.categories;
CREATE POLICY "Users can manage their own categories" ON public.categories
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 12. RLS Policies for Folders
DROP POLICY IF EXISTS "Users can manage their own folders" ON public.folders;
CREATE POLICY "Users can manage their own folders" ON public.folders
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 13. RLS Policies for Items
DROP POLICY IF EXISTS "Users can manage their own items" ON public.items;
CREATE POLICY "Users can manage their own items" ON public.items
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 14. Storage RLS Policies
DROP POLICY IF EXISTS "Authenticated users can upload files" ON storage.objects;
CREATE POLICY "Authenticated users can upload files" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'workspace-files');

DROP POLICY IF EXISTS "Authenticated users can update their files" ON storage.objects;
CREATE POLICY "Authenticated users can update their files" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'workspace-files');

DROP POLICY IF EXISTS "Authenticated users can delete their files" ON storage.objects;
CREATE POLICY "Authenticated users can delete their files" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'workspace-files');

DROP POLICY IF EXISTS "Anyone can read workspace files" ON storage.objects;
CREATE POLICY "Anyone can read workspace files" ON storage.objects
  FOR SELECT USING (bucket_id = 'workspace-files');

-- 15. Automatic User Profile & Default Workspace Trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  default_ws_id TEXT;
BEGIN
  -- 1. Insert into profiles
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

  -- 2. Insert Default Workspace
  default_ws_id := 'ws_' || replace(NEW.id::text, '-', '_');
  INSERT INTO public.workspaces (id, user_id, name, is_default)
  VALUES (default_ws_id, NEW.id, 'My Workspace', TRUE)
  ON CONFLICT (id) DO NOTHING;

  -- 3. Insert Default Categories
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
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 16. Enable Realtime Publications (safely ignore if table already in publication)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workspaces;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.categories;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.folders;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.items;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
