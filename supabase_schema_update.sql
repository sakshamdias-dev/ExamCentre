-- 3. Proctoring Logs Table
CREATE TABLE IF NOT EXISTS public.proctoring_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    test_id UUID REFERENCES public.tests(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    event_type TEXT, -- 'tab_switch', 'fullscreen_exit', 'high_noise', 'audio_sample'
    details TEXT,
    audio_data TEXT, -- Base64 audio data for 'audio_sample'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.proctoring_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own logs" ON public.proctoring_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Teachers can view all logs" ON public.proctoring_logs FOR SELECT USING (true);

-- 4. Notifications Table
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT,
    message TEXT,
    type TEXT, -- 'warning', 'audio_request'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Teachers can insert notifications" ON public.notifications FOR INSERT WITH CHECK (true);

-- Enable Realtime for notifications
-- Run this in your Supabase SQL Editor:
-- ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
