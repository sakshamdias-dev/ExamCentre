-- Fix Foreign Key for live_sessions
-- This resolves the "Could not find a relationship between 'live_sessions' and 'user_id'" error (PGRST200)

-- 1. Drop existing constraint if it exists
ALTER TABLE public.live_sessions 
DROP CONSTRAINT IF EXISTS live_sessions_user_id_fkey;

-- 2. Add the explicit foreign key constraint to the profiles table
ALTER TABLE public.live_sessions 
ADD CONSTRAINT live_sessions_user_id_fkey 
FOREIGN KEY (user_id) 
REFERENCES public.profiles(id) 
ON DELETE CASCADE;

-- 3. Also ensure other proctoring tables have correct foreign keys for joins
ALTER TABLE public.live_snapshots 
DROP CONSTRAINT IF EXISTS live_snapshots_user_id_fkey;

ALTER TABLE public.live_snapshots 
ADD CONSTRAINT live_snapshots_user_id_fkey 
FOREIGN KEY (user_id) 
REFERENCES public.profiles(id) 
ON DELETE CASCADE;

ALTER TABLE public.proctoring_logs 
DROP CONSTRAINT IF EXISTS proctoring_logs_user_id_fkey;

ALTER TABLE public.proctoring_logs 
ADD CONSTRAINT proctoring_logs_user_id_fkey 
FOREIGN KEY (user_id) 
REFERENCES public.profiles(id) 
ON DELETE CASCADE;

ALTER TABLE public.notifications 
DROP CONSTRAINT IF EXISTS notifications_user_id_fkey;

ALTER TABLE public.notifications 
ADD CONSTRAINT notifications_user_id_fkey 
FOREIGN KEY (user_id) 
REFERENCES public.profiles(id) 
ON DELETE CASCADE;

-- Refresh the PostgREST schema cache (Supabase does this automatically, 
-- but you can also run NOTIFY pgrst, 'reload schema'; if needed)
