import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = supabaseUrl !== '' && supabaseAnonKey !== '';

if (!isSupabaseConfigured) {
  console.error('Supabase configuration is missing. Please add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your environment variables.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'teacher' | 'student' | 'co-admin';
};

export type Test = {
  id: string;
  title: string;
  subject: string;
  total_marks: number;
  passing_marks: number;
  description: string;
  question_paper_url: string;
  assigned_students: string[] | null;
  invigilator_id: string;
  proctoring_config: {
    camera: boolean;
    mic: boolean;
    screen: boolean;
  };
  is_low_data_default: boolean;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  is_paused: boolean;
  course_id: string;
  teacher_id: string;
};
