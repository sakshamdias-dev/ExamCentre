-- Fix missing created_at columns by renaming 'timestamp' to 'created_at'
-- This standardizes the schema across all proctoring and chat tables.

-- 1. Proctoring Logs
DO $$ 
BEGIN 
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='proctoring_logs' AND column_name='timestamp') THEN
        ALTER TABLE public.proctoring_logs RENAME COLUMN "timestamp" TO "created_at";
    END IF;
END $$;

-- 2. Live Snapshots
DO $$ 
BEGIN 
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='live_snapshots' AND column_name='timestamp') THEN
        ALTER TABLE public.live_snapshots RENAME COLUMN "timestamp" TO "created_at";
    END IF;
END $$;

-- 3. Login Logs
DO $$ 
BEGIN 
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='login_logs' AND column_name='timestamp') THEN
        ALTER TABLE public.login_logs RENAME COLUMN "timestamp" TO "created_at";
    END IF;
END $$;

-- 4. Chats (Legacy table if it exists)
DO $$ 
BEGIN 
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='chats' AND column_name='timestamp') THEN
        ALTER TABLE public.chats RENAME COLUMN "timestamp" TO "created_at";
    END IF;
END $$;

-- Ensure all tables have the column if they were created without either
ALTER TABLE IF EXISTS public.proctoring_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());
ALTER TABLE IF EXISTS public.live_snapshots ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());
ALTER TABLE IF EXISTS public.exam_chats ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());
ALTER TABLE IF EXISTS public.notifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());
ALTER TABLE IF EXISTS public.live_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- Reload schema cache for PostgREST
NOTIFY pgrst, 'reload_schema';
