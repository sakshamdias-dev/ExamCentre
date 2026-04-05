-- Supabase Schema for Examfriendly

-- Users table (Extends Supabase Auth)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'student' CHECK (role IN ('admin', 'teacher', 'student', 'co-admin')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Courses table
CREATE TABLE IF NOT EXISTS public.courses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  teacher_id UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tests table
CREATE TABLE IF NOT EXISTS public.tests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subject TEXT,
  total_marks INTEGER DEFAULT 100,
  passing_marks INTEGER DEFAULT 35,
  description TEXT,
  question_paper_url TEXT, -- Google Drive file ID or Google Form link
  assigned_students UUID[], -- Array of profile IDs or NULL for "All"
  invigilator_id UUID REFERENCES public.profiles(id),
  proctoring_config JSONB DEFAULT '{"camera": true, "mic": true, "screen": true}'::jsonb,
  is_low_data_default BOOLEAN DEFAULT false,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_minutes INTEGER NOT NULL,
  is_paused BOOLEAN DEFAULT false,
  teacher_id UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Login Logs table
CREATE TABLE IF NOT EXISTS public.login_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Proctoring Logs (Tab switches, etc.)
CREATE TABLE IF NOT EXISTS public.proctoring_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  test_id UUID REFERENCES public.tests(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id),
  event_type TEXT NOT NULL, -- 'tab_switch', 'camera_off', etc.
  details TEXT,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Submissions table
CREATE TABLE IF NOT EXISTS public.submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  test_id UUID REFERENCES public.tests(id) ON DELETE CASCADE,
  student_id UUID REFERENCES public.profiles(id),
  google_drive_file_id TEXT,
  page_ids TEXT[], -- Array of Google Drive file IDs for individual pages
  marked_paper_drive_id TEXT, -- For graded paper saved back to Drive
  corrected_file_id TEXT, -- For teacher-uploaded corrected copy
  is_released BOOLEAN DEFAULT false, -- Whether marks are visible to student
  returned_at TIMESTAMP WITH TIME ZONE, -- When the paper was returned
  status TEXT DEFAULT 'submitted' CHECK (status IN ('submitted', 'graded', 'recheck_requested')),
  marks_obtained INTEGER,
  teacher_remarks TEXT,
  grade_data JSONB, -- Coordinates for ink-on-paper and text comments
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info',
  is_read BOOLEAN DEFAULT false,
  link TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Chats table
CREATE TABLE IF NOT EXISTS public.chats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  test_id UUID REFERENCES public.tests(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES public.profiles(id),
  message TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Live Snapshots (For Low Data Mode)
CREATE TABLE IF NOT EXISTS public.live_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  test_id UUID REFERENCES public.tests(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id),
  image_data TEXT NOT NULL, -- Base64 JPEG
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Live Sessions (To track active proctoring status and toggles)
CREATE TABLE IF NOT EXISTS public.live_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  test_id UUID REFERENCES public.tests(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id),
  is_low_data BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  last_seen TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(test_id, user_id)
);

-- RLS Policies (Basic)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

-- Profiles: Everyone can read, only user can update own
CREATE POLICY "Public profiles are viewable by everyone." ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert own profile." ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile." ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Tests: Everyone can read, only teachers/admins can create/edit
CREATE POLICY "Tests are viewable by everyone." ON public.tests FOR SELECT USING (true);
CREATE POLICY "Teachers can manage tests." ON public.tests FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('teacher', 'admin'))
);

-- Submissions: Students can read/create own, teachers can read all for their tests
CREATE POLICY "Students can manage own submissions." ON public.submissions FOR ALL USING (auth.uid() = student_id);
CREATE POLICY "Teachers can view submissions for their tests." ON public.submissions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.tests WHERE id = test_id AND teacher_id = auth.uid())
);

-- Notifications: Users can manage their own notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own notifications." ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own notifications." ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "System can insert notifications." ON public.notifications FOR INSERT WITH CHECK (true);
