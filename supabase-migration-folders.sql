-- =============================================================================
-- Migration: folder hierarchy (parent_id / folder_id), file metadata, RLS hardening
-- Safe to re-run. Existing data is preserved: legacy text columns (folders.parent,
-- items.folder) are kept and backfilled into the new UUID columns, and triggers keep
-- both in sync so the current client keeps working while you migrate.
-- Run in the Supabase SQL editor.
-- =============================================================================

-- 1. Workspaces: optional presentation fields ----------------------------------
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS icon  TEXT;

-- 2. Folders: real parent reference (NULL = workspace root) --------------------
ALTER TABLE public.folders
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.folders(id) ON DELETE CASCADE;

-- 3. Items: real folder reference (NULL = workspace root) + file metadata ------
--    ON DELETE SET NULL: deleting a folder row can never silently delete items;
--    the app decides "move to parent" vs "delete" before removing the folder.
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES public.folders(id) ON DELETE SET NULL;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS mime_type TEXT;
-- file_size (BIGINT) and updated_at already exist on items.
-- Existing items keep folder_id = NULL until the backfill below places them.

-- 4. Helper: resolve a legacy path ("Physics/Notes") to a folder id ------------
CREATE OR REPLACE FUNCTION public.folder_id_for_path(p_user UUID, p_ws TEXT, p_path TEXT)
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT f.id
  FROM public.folders f
  WHERE p_path IS NOT NULL AND p_path <> ''
    AND f.user_id = p_user
    AND f.workspace_id = p_ws
    AND f.name   = regexp_replace(p_path, '^.*/', '')
    AND f.parent = regexp_replace(p_path, '/?[^/]*$', '')
  LIMIT 1;
$$;

-- 5. Backfill (idempotent) ------------------------------------------------------
-- 5a. folders.parent_id from the legacy path column
UPDATE public.folders c
SET parent_id = public.folder_id_for_path(c.user_id, c.workspace_id, c.parent)
WHERE c.parent_id IS NULL AND c.parent IS NOT NULL AND c.parent <> '';

-- 5b. items.folder_id from the legacy path column (root items stay NULL)
UPDATE public.items i
SET folder_id = public.folder_id_for_path(i.user_id, i.workspace_id, i.folder)
WHERE i.folder_id IS NULL AND i.folder IS NOT NULL AND i.folder <> '';

-- 5c. mime_type from the old file_type column where it already holds a MIME type
UPDATE public.items
SET mime_type = file_type
WHERE mime_type IS NULL AND file_type LIKE '%/%';

-- 5d. file_size from Storage metadata where the object still exists.
--     Storage object names are matched against the stored file_path/URL.
UPDATE public.items i
SET file_size = (o.metadata->>'size')::BIGINT,
    mime_type = COALESCE(i.mime_type, o.metadata->>'mimetype')
FROM storage.objects o
WHERE i.type = 'file'
  AND o.bucket_id = 'workspace-files'
  AND i.file_path IS NOT NULL
  AND i.file_path LIKE '%' || o.name
  AND (i.file_size IS NULL OR i.file_size = 0)
  AND o.metadata ? 'size';

-- 5e. Unknown size -> NULL (not a misleading 0): only for files with no storage match
UPDATE public.items i
SET file_size = NULL
WHERE i.type = 'file' AND i.file_size = 0
  AND NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'workspace-files' AND i.file_path IS NOT NULL AND i.file_path LIKE '%' || o.name
  );

-- 6. Keep legacy text columns and new id columns in sync -----------------------
CREATE OR REPLACE FUNCTION public.sync_folder_refs() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'folders' THEN
    IF TG_OP = 'INSERT' OR NEW.parent IS DISTINCT FROM OLD.parent THEN
      IF NEW.parent_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id) THEN
        NEW.parent_id := public.folder_id_for_path(NEW.user_id, NEW.workspace_id, NEW.parent);
      END IF;
    END IF;
  ELSE -- items
    IF TG_OP = 'INSERT' OR NEW.folder IS DISTINCT FROM OLD.folder THEN
      IF NEW.folder_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.folder_id IS NOT DISTINCT FROM OLD.folder_id) THEN
        NEW.folder_id := public.folder_id_for_path(NEW.user_id, NEW.workspace_id, NEW.folder);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_folders_sync_refs ON public.folders;
CREATE TRIGGER trg_folders_sync_refs BEFORE INSERT OR UPDATE ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.sync_folder_refs();

DROP TRIGGER IF EXISTS trg_items_sync_refs ON public.items;
CREATE TRIGGER trg_items_sync_refs BEFORE INSERT OR UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.sync_folder_refs();

-- 7. updated_at maintained on every change --------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_items_updated_at ON public.items;
CREATE TRIGGER trg_items_updated_at BEFORE UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 8. Indexes ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_folders_workspace_parent ON public.folders (workspace_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_items_workspace_folder   ON public.items   (workspace_id, folder_id);

-- 9. Row Level Security -----------------------------------------------------------
-- Owners only, and writes must target a workspace the user owns (blocks inserting
-- rows into someone else's workspace id even with a matching user_id).
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own workspaces" ON public.workspaces;
CREATE POLICY "Users can manage their own workspaces" ON public.workspaces
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own folders" ON public.folders;
CREATE POLICY "Users can manage their own folders" ON public.folders
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = folders.workspace_id AND w.user_id = auth.uid())
    AND (parent_id IS NULL OR EXISTS (SELECT 1 FROM public.folders p WHERE p.id = folders.parent_id AND p.user_id = auth.uid() AND p.workspace_id = folders.workspace_id))
  );

DROP POLICY IF EXISTS "Users can manage their own items" ON public.items;
CREATE POLICY "Users can manage their own items" ON public.items
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = items.workspace_id AND w.user_id = auth.uid())
    AND (folder_id IS NULL OR EXISTS (SELECT 1 FROM public.folders f WHERE f.id = items.folder_id AND f.user_id = auth.uid() AND f.workspace_id = items.workspace_id))
  );
