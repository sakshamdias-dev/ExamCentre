import React, { useState, useEffect, useRef } from 'react';
import { supabase, Profile, Test, isSupabaseConfigured } from './lib/supabase';
import { initGoogleApi, uploadToDrive, isAuthorized, authorize, checkAuth, extractDriveId, fetchDriveFileAsBlob } from './lib/googleDrive';
import { cn, formatTime } from './lib/utils';
import { 
  Shield, 
  User, 
  BookOpen, 
  Camera, 
  CameraOff,
  Mic, 
  Monitor, 
  LogOut, 
  Clock, 
  AlertTriangle, 
  CheckCircle,
  FileText,
  Send,
  Wifi,
  WifiOff,
  PenTool,
  Download,
  Upload,
  Lock,
  Menu,
  X,
  Cloud,
  FileCheck,
  ExternalLink,
  Bell,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  MessageCircle,
  Loader2,
  Pencil,
  Eraser,
  Trash2,
  Type,
  ShieldAlert,
  Maximize,
  Video,
  Activity,
  Plus,
  Search,
  Calendar,
  Users,
  Eye,
  RefreshCw,
  Check,
  Save,
  Undo,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { Stage, Layer, Line, Text as KonvaText, Label, Tag } from 'react-konva';

import { SubmissionModal } from './components/SubmissionModal';

// --- Utils ---

const getEmbedUrl = (url: string | undefined) => {
  if (!url) return '';
  
  // Google Drive File Link
  const driveMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (driveMatch) {
    return `https://drive.google.com/file/d/${driveMatch[1]}/preview`;
  }
  
  // Google Docs/Sheets/Slides Link
  const docsMatch = url.match(/\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/);
  if (docsMatch) {
    return `https://docs.google.com/${docsMatch[1]}/d/${docsMatch[2]}/preview`;
  }

  // Raw Google Drive ID (alphanumeric, underscores, hyphens, typically 25-45 chars)
  if (url.match(/^[a-zA-Z0-9_-]{25,45}$/)) {
    return `https://drive.google.com/file/d/${url}/preview`;
  }

  // Use Google Docs Viewer for direct PDF links to ensure they stay in-browser on mobile
  if (url.toLowerCase().endsWith('.pdf') && !url.includes('docs.google.com/viewer')) {
    return `https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`;
  }
  
  return url;
};

const getDriveViewUrl = (idOrUrl: string) => {
  if (!idOrUrl) return '';
  if (idOrUrl.startsWith('http')) return idOrUrl;
  return `https://drive.google.com/file/d/${idOrUrl}/view`;
};

const downloadSubmissionAsPdf = async (submission: any, showNotification: (m: string, t?: 'success' | 'error') => void) => {
  const pageIds = submission.page_ids || [];
  if (pageIds.length === 0) {
    if (submission.google_drive_file_id) {
      window.open(getDriveViewUrl(submission.google_drive_file_id), '_blank');
      return;
    }
    showNotification("No pages found for this submission.", 'error');
    return;
  }

  try {
    showNotification("Preparing PDF download...");
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    for (let i = 0; i < pageIds.length; i++) {
      showNotification(`Fetching page ${i + 1} of ${pageIds.length}...`);
      const blob = await fetchDriveFileAsBlob(pageIds[i]);
      
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });

      const img = new Image();
      await new Promise((resolve) => {
        img.onload = resolve;
        img.src = dataUrl;
      });

      if (i > 0) doc.addPage();

      // Calculate dimensions to fit page while maintaining aspect ratio
      const imgRatio = img.width / img.height;
      const pageRatio = pageWidth / pageHeight;
      let finalWidth, finalHeight, x, y;

      if (imgRatio > pageRatio) {
        finalWidth = pageWidth;
        finalHeight = pageWidth / imgRatio;
        x = 0;
        y = (pageHeight - finalHeight) / 2;
      } else {
        finalHeight = pageHeight;
        finalWidth = pageHeight * imgRatio;
        x = (pageWidth - finalWidth) / 2;
        y = 0;
      }

      doc.addImage(dataUrl, 'JPEG', x, y, finalWidth, finalHeight);
    }

    const fileName = `Submission_${submission.profiles?.full_name || 'Student'}_${Date.now()}.pdf`;
    doc.save(fileName);
    showNotification("PDF downloaded successfully!", 'success');
  } catch (err: any) {
    console.error("PDF generation error:", err);
    showNotification("Failed to generate PDF: " + err.message, 'error');
  }
};

const DriveImage = ({ fileId, className, alt, crossOrigin }: { fileId: string, className?: string, alt?: string, crossOrigin?: React.ImgHTMLAttributes<HTMLImageElement>['crossOrigin'] }) => {
  const [src, setSrc] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const driveId = extractDriveId(fileId);

  useEffect(() => {
    if (!driveId) return;
    
    const fetchImage = async (retryCount = 0) => {
      setLoading(true);
      try {
        // Ensure Google API is initialized
        await initGoogleApi();

        let token = (window as any).gapi?.client?.getToken();
        
        // If no token, try silent authorize if we have authorized before
        if (!token && sessionStorage.getItem('google_drive_authorized') === 'true') {
          try {
            await authorize(true);
            token = (window as any).gapi?.client?.getToken();
          } catch (e) {
            console.warn("Silent authorize failed in DriveImage", e);
          }
        }

        // If it's already a full URL (non-drive), just use it
        if (driveId.startsWith('http')) {
          setSrc(driveId);
          setLoading(false);
          return;
        }

        if (token && token.access_token) {
          const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${driveId}?alt=media`, {
            headers: { 'Authorization': 'Bearer ' + token.access_token }
          });
          if (!resp.ok) {
            const errorText = await resp.text();
            console.error(`Google Drive Fetch Error (DriveImage): ${resp.status} ${resp.statusText}`, errorText);
            
            if (resp.status === 401 && retryCount < 1) {
              // Token might be expired, try to refresh silently
              await authorize(true);
              return fetchImage(retryCount + 1);
            }
            throw new Error(`Failed to fetch image: ${resp.status} ${resp.statusText}`);
          }
          const blob = await resp.blob();
          setSrc(URL.createObjectURL(blob));
        } else {
          // Fallback to public link
          setSrc(`https://drive.google.com/uc?id=${driveId}&export=download`);
        }
      } catch (err: any) {
        console.error("Error fetching drive image:", err);
        if (err.message === 'Failed to fetch') {
          console.warn("CORS or network error fetching drive image. Falling back to public link.");
          setSrc(`https://drive.google.com/uc?id=${driveId}&export=download`);
        } else {
          // Fallback to public link if fetch fails for other reasons
          setSrc(`https://drive.google.com/uc?id=${driveId}&export=download`);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchImage();
  }, [driveId]);

  // Cleanup blob URL
  useEffect(() => {
    return () => {
      if (src && src.startsWith('blob:')) URL.revokeObjectURL(src);
    };
  }, [src]);

  if (loading) return <div className={cn(className, "flex items-center justify-center bg-gray-100")}><Loader2 className="animate-spin text-primary" /></div>;

  return <img src={src} className={className} alt={alt} crossOrigin={crossOrigin} />;
};

// --- Components ---

const Login = ({ onLogin }: { onLogin: (user: any) => void }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    console.log('Attempting login for:', email);
    
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      
      if (authError) {
        console.error('Auth error:', authError);
        throw authError;
      }
      
      console.log('Login successful, user ID:', data.user?.id);
      
      // Capture geolocation (non-blocking)
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            console.log('Geolocation captured:', pos.coords.latitude, pos.coords.longitude);
            const { error: logError } = await supabase.from('login_logs').insert({
              user_id: data.user.id,
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            });
            if (logError) console.error('Login log error:', logError);
          },
          (err) => console.warn("Geolocation failed:", err.message)
        );
      }

      onLogin(data.user);
    } catch (err: any) {
      console.error('Login catch error:', err);
      setError(err.message || "Invalid login credentials. Please check your email and password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-gray-100"
      >
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 rounded-full mb-4">
            <Shield className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900"><img src="Artboard 1.png"></h1>
          <p className="text-gray-500 mt-2">Secure Proctoring Platform</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-lg flex items-start gap-3 text-red-600 text-sm">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
            <input 
              type="email" 
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition"
              placeholder="email@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input 
              type="password" 
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition"
              placeholder="••••••••"
            />
          </div>
          <button 
            type="submit"
            disabled={loading}
            className="w-full bg-primary hover:bg-primary/90 text-white font-bold py-3 rounded-lg transition transform active:scale-95 disabled:opacity-50 mt-4"
          >
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6 text-center text-xs text-gray-400">
          <p>Only authorized users can access the platform.</p>
          <p className="mt-1">Contact your administrator for account creation.</p>
        </div>
      </motion.div>
    </div>
  );
};

// --- Student View ---

const StudentExam = ({ test, user, onFinish, showNotification }: { test: Test, user: any, onFinish: () => void, showNotification: (m: string, t?: 'success' | 'error') => void }) => {
  const [timeLeft, setTimeLeft] = useState(() => {
    const end = new Date(test.end_time).getTime();
    const now = new Date().getTime();
    return Math.max(0, Math.floor((end - now) / 1000));
  });
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [proctorStatus, setProctorStatus] = useState({ camera: false, mic: false, screen: false });
  const [tabSwitches, setTabSwitches] = useState(0);
  const [scannedImages, setScannedImages] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lowDataMode, setLowDataMode] = useState(false);
  const [offlineBuffer, setOfflineBuffer] = useState<{logs: any[], chats: any[]}>({ logs: [], chats: [] });
  const [showSubmissionModal, setShowSubmissionModal] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeWarning, setActiveWarning] = useState<any | null>(null);
  const [isDriveConnected, setIsDriveConnected] = useState(isAuthorized());
  const [isPaused, setIsPaused] = useState(test.is_paused);
  const [showQuestionPaper, setShowQuestionPaper] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isMobile] = useState(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [examChats, setExamChats] = useState<any[]>([]);
  const [showChat, setShowChat] = useState(false);
  const [chatMessage, setChatMessage] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const authorized = isAuthorized();
      if (authorized !== isDriveConnected) {
        setIsDriveConnected(authorized);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isDriveConnected]);

  useEffect(() => {
    const channel = supabase
      .channel(`warnings_${user.id}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'notifications',
        filter: `user_id=eq.${user.id}`
      }, (payload) => {
        if (payload.new.type === 'warning') {
          console.log('Warning received:', payload.new);
          setActiveWarning(payload.new);
        } else if (payload.new.type === 'audio_request') {
          console.log('Audio request received');
          setIsRecordingAudio(true);
          handleAudioRequest().finally(() => {
            setTimeout(() => setIsRecordingAudio(false), 5000);
          });
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user.id]);

  useEffect(() => {
    const fetchChats = async () => {
      const { data } = await supabase
        .from('exam_chats')
        .select('*')
        .eq('test_id', test.id)
        .eq('student_id', user.id)
        .order('created_at', { ascending: true });
      if (data) setExamChats(data);
    };
    fetchChats();

    const channel = supabase
      .channel(`exam_chats_${user.id}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'exam_chats',
        filter: `student_id=eq.${user.id}`
      }, (payload) => {
        if (payload.new.test_id === test.id) {
          setExamChats(prev => [...prev, payload.new]);
          if (!showChat && payload.new.sender_id !== user.id) {
            setUnreadCount(prev => prev + 1);
          }
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user.id, test.id, showChat]);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [examChats, showChat]);

  const sendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;
    const msg = chatMessage;
    setChatMessage('');
    const { error } = await supabase.from('exam_chats').insert({
      test_id: test.id,
      student_id: user.id,
      sender_id: user.id,
      message: msg
    });
    if (error) {
      console.error('Error sending chat message:', error);
      setChatMessage(msg);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFull = !!document.fullscreenElement;
      setIsFullscreen(isFull);
      if (!isFull && !isPaused && showQuestionPaper) {
        const log = {
          test_id: test.id,
          user_id: user.id,
          event_type: 'fullscreen_exit',
          details: `Fullscreen exit detected at ${new Date().toISOString()}`
        };
        if (navigator.onLine) {
          supabase.from('proctoring_logs').insert(log).then();
        } else {
          setOfflineBuffer(prev => ({ ...prev, logs: [...prev.logs, log] }));
        }
        alert("Fullscreen exit detected. This is a violation. Please return to fullscreen.");
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isPaused, showQuestionPaper]);

  useEffect(() => {
    if (!cameraStream) return;

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(cameraStream);
    const analyzer = audioContext.createAnalyser();
    analyzer.fftSize = 256;
    source.connect(analyzer);

    const bufferLength = analyzer.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    let lastViolationTime = 0;

    const checkAudio = () => {
      analyzer.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      setAudioLevel(average);

      // Threshold for noise violation
      if (average > 50 && !isPaused && showQuestionPaper) {
        const now = Date.now();
        if (now - lastViolationTime > 10000) { // Log at most every 10 seconds
          lastViolationTime = now;
          const log = {
            test_id: test.id,
            user_id: user.id,
            event_type: 'high_noise',
            details: `High noise level detected (${Math.round(average)}) at ${new Date().toISOString()}`
          };
          if (navigator.onLine) {
            supabase.from('proctoring_logs').insert(log).then();
          } else {
            setOfflineBuffer(prev => ({ ...prev, logs: [...prev.logs, log] }));
          }
        }
      }
      requestAnimationFrame(checkAudio);
    };

    checkAudio();

    return () => {
      audioContext.close();
    };
  }, [cameraStream, isPaused, showQuestionPaper]);

  const handleAudioRequest = async () => {
    if (!cameraStream) return;
    
    try {
      // Create an audio-only stream from the camera stream's audio tracks
      const audioOnlyStream = new MediaStream(cameraStream.getAudioTracks());
      const mediaRecorder = new MediaRecorder(audioOnlyStream);
      const chunks: Blob[] = [];
      
      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const base64Audio = reader.result as string;
          await supabase.from('proctoring_logs').insert({
            test_id: test.id,
            user_id: user.id,
            event_type: 'audio_sample',
            details: 'Audio sample recorded on request',
            audio_data: base64Audio
          });
        };
      };
      
      mediaRecorder.start();
      setTimeout(() => mediaRecorder.stop(), 5000);
    } catch (err) {
      console.error("Error recording audio sample:", err);
    }
  };

  const requestFullscreen = () => {
    const elem = document.documentElement;
    if (elem.requestFullscreen) {
      elem.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
      });
    }
  };

  const audioLevelRef = useRef(0);
  const proctorStatusRef = useRef(proctorStatus);

  useEffect(() => {
    proctorStatusRef.current = proctorStatus;
  }, [proctorStatus]);

  useEffect(() => {
    audioLevelRef.current = audioLevel;
  }, [audioLevel]);

  useEffect(() => {
    if (cameraStream && videoRef.current) {
      console.log('Attaching stream to video element');
      videoRef.current.srcObject = cameraStream;
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch(error => {
          console.error("Auto-play was prevented:", error);
        });
      }
    }
  }, [cameraStream]);

  useEffect(() => {
    // Initial session upsert to show student as "in room"
    if (user) {
      console.log('Initial session upsert for user:', user.id);
      supabase.from('live_sessions').upsert({
        test_id: test.id,
        user_id: user.id,
        is_active: true,
        last_seen: new Date().toISOString()
      }, { onConflict: 'test_id,user_id' }).then(({ error }) => {
        if (error) console.error('Initial session upsert error:', error);
      });
    }

    // Real-time listener for test updates (Pause/Modify timing)
    const channel = supabase
      .channel(`test_${test.id}`)
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'tests', 
        filter: `id=eq.${test.id}` 
      }, (payload) => {
        const updatedTest = payload.new as Test;
        setIsPaused(updatedTest.is_paused);
        
        // Recalculate time left
        const newEnd = new Date(updatedTest.end_time).getTime();
        const now = new Date().getTime();
        setTimeLeft(Math.max(0, Math.floor((newEnd - now) / 1000)));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [test.id]);

  useEffect(() => {
    // Sync offline data when coming back online
    if (isOnline && (offlineBuffer.logs.length > 0 || offlineBuffer.chats.length > 0)) {
      syncOfflineData();
    }
  }, [isOnline]);

  const syncOfflineData = async () => {
    console.log('Syncing offline data...');
    if (offlineBuffer.logs.length > 0) {
      const { error } = await supabase.from('proctoring_logs').insert(offlineBuffer.logs);
      if (!error) setOfflineBuffer(prev => ({ ...prev, logs: [] }));
    }
  };

  useEffect(() => {
    if (screenStream && screenVideoRef.current) {
      screenVideoRef.current.srcObject = screenStream;
      screenVideoRef.current.play().catch(e => console.error("Error playing screen stream:", e));
    }
  }, [screenStream]);

  useEffect(() => {
    // Snapshot interval for Proctoring
    console.log('Starting snapshot/heartbeat interval for test:', test.id);
    const snapshotInterval = setInterval(() => {
      if (isPaused) return;

      const currentAudioLevel = audioLevelRef.current;
      const currentProctorStatus = proctorStatusRef.current;

      // Camera Snapshot
      if (videoRef.current && currentProctorStatus.camera) {
        const canvas = document.createElement('canvas');
        const scale = lowDataMode ? 0.5 : 1;
        canvas.width = videoRef.current.videoWidth * scale || 320;
        canvas.height = videoRef.current.videoHeight * scale || 240;
        canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const imageData = canvas.toDataURL('image/jpeg', lowDataMode ? 0.3 : 0.6);
        supabase.from('live_snapshots').insert({
          test_id: test.id,
          user_id: user.id,
          image_data: imageData,
          type: 'camera'
        }).then(({ error }) => {
          if (error) console.error('Error sending camera snapshot:', error);
        });
      }

      // Screen Snapshot
      if (screenVideoRef.current && currentProctorStatus.screen) {
        const canvas = document.createElement('canvas');
        const scale = lowDataMode ? 0.3 : 0.6;
        canvas.width = screenVideoRef.current.videoWidth * scale || 640;
        canvas.height = screenVideoRef.current.videoHeight * scale || 480;
        canvas.getContext('2d')?.drawImage(screenVideoRef.current, 0, 0, canvas.width, canvas.height);
        const imageData = canvas.toDataURL('image/jpeg', lowDataMode ? 0.2 : 0.4);
        supabase.from('live_snapshots').insert({
          test_id: test.id,
          user_id: user.id,
          image_data: imageData,
          type: 'screen'
        }).then(({ error }) => {
          if (error) console.error('Error sending screen snapshot:', error);
        });
      }

      // Heartbeat
      console.log('Sending heartbeat for user:', user.id);
      supabase.from('live_sessions').upsert({
        test_id: test.id,
        user_id: user.id,
        is_active: true,
        last_seen: new Date().toISOString(),
        audio_level: Math.round(currentAudioLevel)
      }, { onConflict: 'test_id,user_id' }).then(({ error }) => {
        if (error) console.error('Heartbeat error:', error);
      });

    }, lowDataMode ? 15000 : 5000);

    const timer = setInterval(() => {
      if (isPaused) return;
      
      const end = new Date(test.end_time).getTime();
      const now = new Date().getTime();
      const remaining = Math.max(0, Math.floor((end - now) / 1000));
      
      setTimeLeft(remaining);
      
      if (remaining <= 0) {
        clearInterval(timer);
        showNotification("Time's up! You have been removed from the exam room.", 'error');
        // Mark session as inactive in background
        supabase.from('live_sessions').update({ is_active: false }).eq('user_id', user.id);
        onFinish();
      }
    }, 1000);

    const handleVisibility = () => {
      if (document.hidden && !isPaused) {
        setTabSwitches(s => s + 1);
        const log = {
          test_id: test.id,
          user_id: user.id,
          event_type: 'tab_switch',
          details: `Tab switch detected at ${new Date().toISOString()}`
        };
        
        if (navigator.onLine) {
          supabase.from('proctoring_logs').insert(log).then();
        } else {
          setOfflineBuffer(prev => ({ ...prev, logs: [...prev.logs, log] }));
        }
      }
    };

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      clearInterval(timer);
      clearInterval(snapshotInterval);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, [lowDataMode, isPaused]);

  const startProctoring = async () => {
    try {
      console.log('Requesting camera and microphone...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: { ideal: 640 }, height: { ideal: 480 } }, 
        audio: true 
      });
      
      if (stream.getVideoTracks().length === 0) {
        throw new Error("No video tracks found in stream. Please check your camera connection.");
      }
      
      streamRef.current = stream;
      setCameraStream(stream);
      setProctorStatus(prev => ({ ...prev, camera: true, mic: true }));

      // Listen for camera/mic stop
      stream.getVideoTracks()[0].onended = () => {
        setProctorStatus(prev => ({ ...prev, camera: false }));
      };
      if (stream.getAudioTracks().length > 0) {
        stream.getAudioTracks()[0].onended = () => {
          setProctorStatus(prev => ({ ...prev, mic: false }));
        };
      }

      // Screen share is required for non-mobile or if supported on mobile
      if (navigator.mediaDevices.getDisplayMedia) {
        try {
          console.log('Requesting screen share...');
          const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
            video: true,
            audio: false // Explicitly disable system audio capture
          });
          setScreenStream(screenStream);
          setProctorStatus(prev => ({ ...prev, screen: true }));
          screenStream.getVideoTracks()[0].onended = () => {
            alert("Screen sharing stopped. This is a violation. Please restart proctoring.");
            setProctorStatus(prev => ({ ...prev, screen: false }));
          };
        } catch (screenErr) {
          if (isMobile) {
            console.warn("Screen share failed on mobile, marking as true to allow proceed if not possible:", screenErr);
            setProctorStatus(prev => ({ ...prev, screen: true }));
          } else {
            throw new Error("Screen sharing is required to start the exam.");
          }
        }
      } else {
        // Not supported (likely mobile)
        setProctorStatus(prev => ({ ...prev, screen: true }));
      }

      // Create live session record
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        const { error } = await supabase.from('live_sessions').upsert({
          test_id: test.id,
          user_id: userData.user.id,
          is_active: true,
          last_seen: new Date().toISOString()
        }, { onConflict: 'test_id,user_id' });
        if (error) console.error('Error creating live session:', error);
      }
      
    } catch (err) {
      console.error("Proctoring error:", err);
      alert("Proctoring requirements not met. Please ensure you allow Camera, Microphone, and Screen Sharing.");
    }
  };

  const handleCapture = () => {
    const canvas = document.createElement('canvas');
    if (videoRef.current) {
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0);
      setScannedImages(prev => [...prev, canvas.toDataURL('image/jpeg')]);
    }
  };

  useEffect(() => {
    if (showQuestionPaper && (!proctorStatus.camera || !proctorStatus.mic || !proctorStatus.screen)) {
      setShowQuestionPaper(false);
      alert("Proctoring interrupted. Question paper closed.");
    }
  }, [proctorStatus, showQuestionPaper]);

  const captureCurrentFrame = () => {
    const canvas = document.createElement('canvas');
    if (videoRef.current) {
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0);
      return canvas.toDataURL('image/jpeg');
    }
    return '';
  };

  const timerColor = timeLeft < 300 ? 'timer-critical' : timeLeft < 900 ? 'timer-warning' : 'text-gray-700';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col relative">
      {/* Hidden video elements for proctoring captures */}
      <video ref={videoRef} className="hidden" playsInline muted />
      <video ref={screenVideoRef} className="hidden" playsInline muted />

      {activeWarning && (
        <div className="fixed inset-0 bg-red-600/90 z-[400] flex items-center justify-center p-6 text-center">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white p-8 rounded-3xl shadow-2xl max-w-md border-4 border-red-500"
          >
            <ShieldAlert className="w-20 h-20 text-red-600 mx-auto mb-6 animate-bounce" />
            <h2 className="text-3xl font-black text-red-600 mb-2 uppercase tracking-tighter">PROCTORING WARNING</h2>
            <p className="text-gray-900 font-bold text-lg mb-6 leading-tight">{activeWarning.message}</p>
            <button 
              onClick={() => setActiveWarning(null)}
              className="w-full bg-red-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg hover:bg-red-700 transition"
            >
              I UNDERSTAND
            </button>
          </motion.div>
        </div>
      )}

      {isRecordingAudio && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[400] bg-blue-600 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 animate-bounce">
          <Mic className="w-5 h-5 animate-pulse" />
          <span className="font-bold text-sm uppercase tracking-wider">System Audio Check in Progress...</span>
        </div>
      )}

      {showQuestionPaper && !isFullscreen && !isMobile && (
        <div className="fixed inset-0 bg-black/90 z-[300] flex items-center justify-center p-6 text-center">
          <div className="max-w-md">
            <Maximize className="w-20 h-20 text-primary mx-auto mb-6 animate-pulse" />
            <h2 className="text-3xl font-black text-white mb-4">FULLSCREEN REQUIRED</h2>
            <p className="text-gray-400 mb-8">To prevent cheating, this exam must be taken in fullscreen mode. Your actions are being logged.</p>
            <button 
              onClick={requestFullscreen}
              className="w-full bg-primary text-white py-4 rounded-xl font-bold text-lg shadow-lg hover:bg-primary/90 transition"
            >
              Enter Fullscreen Mode
            </button>
          </div>
        </div>
      )}

      {isPaused && (
        <div className="fixed inset-0 bg-black/80 z-[200] flex items-center justify-center text-center p-6">
          <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }}>
            <AlertTriangle className="w-20 h-20 text-orange-500 mx-auto mb-6" />
            <h2 className="text-4xl font-black text-white mb-2">EXAM PAUSED</h2>
            <p className="text-gray-400 max-w-md mx-auto">The invigilator has temporarily paused the exam. Your timer is stopped. Please wait for the resume signal.</p>
          </motion.div>
        </div>
      )}

      {showQuestionPaper && (
        <div className="fixed inset-0 bg-white z-[150] flex flex-col">
          <header className="p-4 border-b flex justify-between items-center bg-gray-50">
            <h3 className="font-bold">Question Paper: {test.title}</h3>
            <button onClick={() => setShowQuestionPaper(false)} className="bg-primary text-white px-4 py-2 rounded-lg font-bold">Close Paper</button>
          </header>
          <div className="flex-1 p-0 md:p-8 overflow-auto flex justify-center bg-gray-100">
            <div className="max-w-5xl w-full bg-white shadow-2xl min-h-full border flex flex-col">
              {test.question_paper_url?.includes('drive.google.com') || test.question_paper_url?.includes('docs.google.com') || /^[a-zA-Z0-9_-]{25,45}$/.test(test.question_paper_url || '') ? (
                <iframe 
                  src={getEmbedUrl(test.question_paper_url)} 
                  className="w-full flex-1 border-0" 
                  allow="autoplay; fullscreen"
                  title="Question Paper"
                  style={{ minHeight: isMobile ? '80vh' : 'auto' }}
                />
              ) : test.question_paper_url?.startsWith('http') ? (
                <iframe 
                  src={test.question_paper_url} 
                  className="w-full flex-1 border-0" 
                  title="Question Paper" 
                  allow="autoplay; fullscreen"
                  style={{ minHeight: isMobile ? '80vh' : 'auto' }}
                />
              ) : (
                <div className="text-center py-20 flex-1 flex flex-col items-center justify-center">
                  <FileText className="w-20 h-20 text-gray-200 mb-4" />
                  <p className="text-gray-400 font-bold">Question Paper (ID: {test.question_paper_url})</p>
                  <p className="text-xs text-gray-300 mt-2 italic">Please ensure the URL is a valid web link or Google Drive preview link.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Chat Box */}
      <div className={cn(
        "fixed bottom-6 right-6 z-[250] flex flex-col items-end gap-4 transition-all duration-300",
        showChat ? "w-80 h-[450px]" : "w-14 h-14"
      )}>
        {showChat && (
          <motion.div 
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="bg-white rounded-2xl shadow-2xl border border-gray-200 flex-1 w-full flex flex-col overflow-hidden"
          >
            <div className="bg-primary p-4 text-white flex justify-between items-center">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5" />
                <span className="font-bold text-sm">Ask Doubt (Invigilator)</span>
              </div>
              <button onClick={() => setShowChat(false)} className="hover:bg-white/20 p-1 rounded transition">
                <ChevronDown className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
              {examChats.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 text-center p-4">
                  <MessageCircle className="w-10 h-10 mb-2 opacity-20" />
                  <p className="text-xs">Have a doubt? Send a message to the invigilator.</p>
                </div>
              ) : (
                examChats.map((chat, i) => (
                  <div key={i} className={cn(
                    "flex flex-col max-w-[85%]",
                    chat.sender_id === user.id ? "ml-auto items-end" : "mr-auto items-start"
                  )}>
                    <div className={cn(
                      "px-3 py-2 rounded-2xl text-sm shadow-sm",
                      chat.sender_id === user.id 
                        ? "bg-primary text-white rounded-tr-none" 
                        : "bg-white text-gray-800 border border-gray-100 rounded-tl-none"
                    )}>
                      {chat.message}
                    </div>
                    <span className="text-[8px] text-gray-400 mt-1">
                      {new Date(chat.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            <form onSubmit={sendChatMessage} className="p-3 border-t bg-white flex gap-2">
              <input 
                type="text"
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                placeholder="Type your doubt..."
                className="flex-1 bg-gray-100 border-none rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-primary outline-none"
              />
              <button 
                type="submit"
                disabled={!chatMessage.trim()}
                className="bg-primary text-white p-2 rounded-xl hover:bg-primary/90 transition disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </motion.div>
        )}

        <button 
          onClick={() => {
            setShowChat(!showChat);
            setUnreadCount(0);
          }}
          className={cn(
            "w-14 h-14 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 relative",
            showChat ? "bg-gray-100 text-gray-600 rotate-180" : "bg-primary text-white hover:scale-110"
          )}
        >
          {showChat ? <ChevronDown className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
          {!showChat && unreadCount > 0 && (
            <div className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-white animate-bounce">
              {unreadCount}
            </div>
          )}
        </button>
      </div>

      {/* Proctoring Status Bar */}
      <div className="bg-gray-900 text-white px-4 py-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest border-b border-white/10 shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className={cn("w-2 h-2 rounded-full", proctorStatus.camera ? "bg-green-500" : "bg-red-500 animate-pulse")} />
            CAMERA: {proctorStatus.camera ? 'ACTIVE' : 'OFF'}
          </div>
          <div className="flex items-center gap-2">
            <div className={cn("w-2 h-2 rounded-full", proctorStatus.mic ? "bg-green-500" : "bg-red-500 animate-pulse")} />
            MIC: {proctorStatus.mic ? 'ACTIVE' : 'OFF'}
          </div>
          <div className="flex items-center gap-2">
            <div className={cn("w-2 h-2 rounded-full", proctorStatus.screen ? "bg-green-500" : "bg-red-500 animate-pulse")} />
            SCREEN: {proctorStatus.screen ? 'ACTIVE' : 'OFF'}
          </div>
          <div className="flex items-center gap-2">
            <div className="w-20 h-2 bg-gray-700 rounded-full overflow-hidden">
              <motion.div 
                animate={{ width: `${Math.min(100, audioLevel * 2)}%` }}
                className={cn("h-full", audioLevel > 50 ? "bg-red-500" : "bg-green-500")}
              />
            </div>
            AUDIO LEVEL
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={cn("w-2 h-2 rounded-full", isOnline ? "bg-green-500" : "bg-red-500")} />
            {isOnline ? 'ONLINE' : 'OFFLINE'}
          </div>
          {offlineBuffer.logs.length > 0 && (
            <div className="text-orange-500 animate-pulse">
              {offlineBuffer.logs.length} PENDING LOGS
            </div>
          )}
        </div>
      </div>

      {/* Header */}
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <BookOpen className="text-primary w-6 h-6" />
          <h2 className="font-bold text-lg truncate max-w-[200px]">{test.title}</h2>
        </div>
        <div className={cn("flex items-center gap-2 text-xl font-mono", timerColor)}>
          <Clock className="w-5 h-5" />
          {formatTime(timeLeft)}
        </div>
        <div className="flex items-center gap-4">
          {!isDriveConnected && (
            <button 
              onClick={async () => {
                try {
                  await authorize();
                  setIsDriveConnected(true);
                } catch (err) {
                  console.error(err);
                  alert("Failed to connect Google Drive. Please allow popups.");
                }
              }}
              className="bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg font-bold text-sm flex items-center gap-1 hover:bg-blue-100 transition"
            >
              <Cloud className="w-4 h-4" /> Connect Drive
            </button>
          )}
          <button 
            onClick={() => {
              if (!proctorStatus.camera || !proctorStatus.mic || !proctorStatus.screen) {
                alert("Please enable Camera, Microphone, and Screen Sharing first to view the paper.");
                return;
              }
              setShowQuestionPaper(true);
            }}
            className="text-primary font-bold text-sm flex items-center gap-1 hover:underline"
          >
            <FileText className="w-4 h-4" /> View Paper
          </button>
          {isOnline ? <Wifi className="text-green-500 w-5 h-5" /> : <WifiOff className="text-red-500 w-5 h-5" />}
        </div>
      </header>

      <main className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {!proctorStatus.camera ? (
            <div className="bg-white rounded-xl p-12 text-center border-2 border-dashed border-gray-200">
              <Shield className="w-16 h-16 text-primary mx-auto mb-4" />
              <h3 className="text-xl font-bold mb-2">Hardware Gate</h3>
              <p className="text-gray-500 mb-6">You must enable Camera, Microphone, and Screen Sharing to start the exam.</p>
              <button 
                onClick={startProctoring}
                className="bg-primary text-white px-8 py-3 rounded-lg font-bold hover:bg-primary/90 transition"
              >
                Enable Hardware & Start
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
                <h3 className="font-bold mb-4 flex items-center gap-2">
                  <FileText className="text-primary" /> Exam Instructions
                </h3>
                <p className="text-gray-600 leading-relaxed">{test.description}</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {scannedImages.map((img, i) => (
                  <div key={i} className="relative group aspect-[3/4] bg-gray-200 rounded-lg overflow-hidden border">
                    <img src={img} alt={`Page ${i+1}`} className="w-full h-full object-cover" />
                    <div className="absolute top-2 right-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition">
                      <button 
                        onClick={() => setScannedImages(prev => prev.filter((_, idx) => idx !== i))}
                        className="bg-red-500 text-white p-1 rounded-full"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      {i > 0 && (
                        <button 
                          onClick={() => {
                            const newImages = [...scannedImages];
                            [newImages[i], newImages[i-1]] = [newImages[i-1], newImages[i]];
                            setScannedImages(newImages);
                          }}
                          className="bg-primary text-white p-1 rounded-full"
                        >
                          <Menu className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <div className="absolute bottom-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
                      Page {i+1}
                    </div>
                  </div>
                ))}
                <button 
                  onClick={handleCapture}
                  className="aspect-[3/4] border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:border-primary hover:text-primary transition"
                >
                  <Camera className="w-8 h-8 mb-2" />
                  <span className="text-sm font-medium">Capture Page</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="bg-black rounded-xl overflow-hidden aspect-video relative shadow-lg min-h-[180px] flex items-center justify-center border-2 border-gray-800">
            {!cameraStream && (
              <div className="text-center p-4 z-20">
                <CameraOff className="w-8 h-8 text-gray-600 mx-auto mb-2 animate-pulse" />
                <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Awaiting Camera Feed...</p>
              </div>
            )}
            <video 
              ref={videoRef} 
              autoPlay 
              muted 
              playsInline 
              className={cn(
                "absolute inset-0 w-full h-full object-cover transition-opacity duration-700",
                cameraStream ? "opacity-100" : "opacity-0"
              )} 
              onLoadedMetadata={() => {
                console.log('Video metadata loaded, attempting play');
                videoRef.current?.play().catch(e => console.error('Play failed on metadata load:', e));
              }}
            />
            <div className="absolute top-2 left-2 z-30 flex gap-2">
              <button 
                onClick={() => {
                  if (streamRef.current && videoRef.current) {
                    console.log('Manually refreshing video feed');
                    videoRef.current.srcObject = streamRef.current;
                    videoRef.current.play().catch(e => console.error('Manual play failed:', e));
                  }
                }}
                className="bg-black/50 text-white p-1.5 rounded-lg hover:bg-black/70 transition flex items-center gap-1"
                title="Refresh Feed"
              >
                <Wifi className="w-3 h-3" />
                <span className="text-[8px] font-bold uppercase tracking-tighter">Refresh</span>
              </button>
            </div>
            <div className="absolute top-2 right-2 z-30">
              <div className={cn(
                "w-2 h-2 rounded-full",
                cameraStream ? "bg-green-500 animate-pulse" : "bg-red-500"
              )} />
            </div>
            <div className="absolute bottom-2 left-2 flex gap-2 z-30">
              <span className="bg-green-500 w-2 h-2 rounded-full animate-pulse" />
              <span className="text-[10px] text-white font-mono">LIVE PROCTORING</span>
            </div>
          </div>

          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <h4 className="font-bold mb-4">Security Status</h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Tab Switches</span>
                <span className={cn("font-bold", tabSwitches > 0 ? "text-red-500" : "text-green-500")}>{tabSwitches}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Camera</span>
                {proctorStatus.camera ? <CheckCircle className="text-green-500 w-4 h-4" /> : <AlertTriangle className="text-red-500 w-4 h-4" />}
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Microphone</span>
                {proctorStatus.mic ? <CheckCircle className="text-green-500 w-4 h-4" /> : <AlertTriangle className="text-red-500 w-4 h-4" />}
              </div>
            </div>
          </div>

          <button 
            onClick={() => setShowSubmissionModal(true)}
            className="w-full bg-primary text-white font-bold py-4 rounded-xl shadow-lg hover:bg-primary/90 transition flex items-center justify-center gap-2"
          >
            <Send className="w-5 h-5" /> Submit Exam
          </button>
        </div>
      </main>

      {showSubmissionModal && (
        <SubmissionModal 
          test={test}
          user={user}
          initialImages={scannedImages}
          onClose={() => setShowSubmissionModal(false)}
          onSuccess={() => {
            setShowSubmissionModal(false);
            onFinish();
          }}
        />
      )}
    </div>
  );
};

// --- Grading View ---

const GradingView = ({ submission, onBack, showNotification }: { submission: any, onBack: () => void, showNotification: (m: string, t?: 'success' | 'error') => void }) => {
  const stageRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [isDrawing, setIsDrawing] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  
  // inkData and textComments are now objects keyed by page index
  const [inkData, setInkData] = useState<{[key: number]: any[]}>(() => {
    const raw = submission.grade_data?.ink || {};
    const normalized: {[key: number]: any[]} = {};
    Object.keys(raw).forEach(key => {
      const idx = parseInt(key);
      normalized[idx] = (raw[key] || []).map((stroke: any) => {
        if (!stroke.points) return { ...stroke, points: [] };
        let flat: number[] = [];
        if (typeof stroke.points[0] === 'number') {
          flat = stroke.points;
        } else {
          stroke.points.forEach((p: any) => {
            if (p && typeof p.x === 'number' && typeof p.y === 'number') {
              flat.push(p.x, p.y);
            }
          });
        }
        return { ...stroke, points: flat.filter(v => typeof v === 'number' && Number.isFinite(v)) };
      });
    });
    return normalized;
  });
  const [textComments, setTextComments] = useState<{[key: number]: any[]}>(submission.grade_data?.comments || {});
  
  const [marks, setMarks] = useState(submission.marks_obtained || 0);
  const [remarks, setRemarks] = useState(submission.teacher_remarks || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isReturning, setIsReturning] = useState(false);
  const [activeTool, setActiveTool] = useState<'pen' | 'eraser' | 'text'>('pen');
  const [correctedFile, setCorrectedFile] = useState<File | null>(null);
  const [isUploadingCorrected, setIsUploadingCorrected] = useState(false);
  const [correctedFileId, setCorrectedFileId] = useState<string | null>(submission.corrected_file_id || null);
  const [googleAuthorized, setGoogleAuthorized] = useState(isAuthorized());

  const pageIds = submission.page_ids || [];
  const totalPages = pageIds.length;

  useEffect(() => {
    checkAuth().then(authorized => {
      setGoogleAuthorized(authorized);
    });
  }, []);

  useEffect(() => {
    const resize = () => {
      if (containerRef.current) {
        setStageSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight
        });
      }
    };

    window.addEventListener('resize', resize);
    resize();
    // Initial resize might need a small delay for container to be ready
    const timer = setTimeout(resize, 100);
    return () => {
      window.removeEventListener('resize', resize);
      clearTimeout(timer);
    };
  }, []);

  const handleMouseDown = (e: any) => {
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos || !stageSize.width || !stageSize.height) return;

    const normalizedPos = {
      x: pos.x / stageSize.width,
      y: pos.y / stageSize.height
    };

    if (!Number.isFinite(normalizedPos.x) || !Number.isFinite(normalizedPos.y)) return;

    if (activeTool === 'eraser') {
      eraseAt(normalizedPos);
      setIsDrawing(true);
      return;
    }

    if (activeTool === 'text') {
      const text = prompt("Enter comment:");
      if (text) {
        setTextComments(prev => {
          const current = prev[currentPage] || [];
          return { ...prev, [currentPage]: [...current, { text, x: normalizedPos.x, y: normalizedPos.y }] };
        });
      }
      return;
    }

    setIsDrawing(true);
    setInkData(prev => {
      const current = prev[currentPage] || [];
      return { ...prev, [currentPage]: [...current, { points: [normalizedPos.x, normalizedPos.y] }] };
    });
  };

  const handleMouseMove = (e: any) => {
    if (!isDrawing) return;
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos || !stageSize.width || !stageSize.height) return;

    const normalizedPos = {
      x: pos.x / stageSize.width,
      y: pos.y / stageSize.height
    };

    if (!Number.isFinite(normalizedPos.x) || !Number.isFinite(normalizedPos.y)) return;

    if (activeTool === 'eraser') {
      eraseAt(normalizedPos);
      return;
    }

    if (activeTool === 'text') return;

    setInkData(prev => {
      const current = [...(prev[currentPage] || [])];
      if (current.length === 0) return prev;
      const lastStroke = { ...current[current.length - 1] };
      lastStroke.points = [...lastStroke.points, normalizedPos.x, normalizedPos.y];
      current[current.length - 1] = lastStroke;
      return { ...prev, [currentPage]: current };
    });
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
  };

  const eraseAt = (pos: { x: number, y: number }) => {
    setInkData(prev => {
      const current = prev[currentPage] || [];
      const updated = current.filter(stroke => {
        for (let i = 0; i < stroke.points.length; i += 2) {
          const px = stroke.points[i];
          const py = stroke.points[i + 1];
          const dx = px - pos.x;
          const dy = py - pos.y;
          if (Math.sqrt(dx * dx + dy * dy) < 0.02) return false;
        }
        return true;
      });
      if (updated.length === current.length) return prev;
      return { ...prev, [currentPage]: updated };
    });
  };

  const handleCorrectedFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!googleAuthorized) {
      showNotification("Please authorize Google Drive first", 'error');
      return;
    }
    
    setIsUploadingCorrected(true);
    try {
      const fileId = await uploadToDrive(file, `Corrected_${submission.profiles?.full_name}_${file.name}`, submission.profiles?.email);
      setCorrectedFileId(fileId);
      setCorrectedFile(file);
      showNotification("Corrected copy uploaded successfully!");
    } catch (err: any) {
      showNotification("Error uploading corrected copy: " + err.message, 'error');
    } finally {
      setIsUploadingCorrected(false);
    }
  };

  const generateCorrectedPdf = async () => {
    const doc = new jsPDF({
      orientation: 'p',
      unit: 'mm',
      format: 'a4'
    });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const originalStyles: any[] = [];
    const styleSheets = Array.from(document.styleSheets);
    
    // Pre-process all stylesheets to remove oklch which crashes html2canvas
    let oklchCount = 0;
    styleSheets.forEach((sheet, sIdx) => {
      try {
        if (sheet.href && !sheet.href.startsWith(window.location.origin)) return;
        const rules = Array.from(sheet.cssRules || sheet.rules);
        rules.forEach((rule, rIdx) => {
          if (rule instanceof CSSStyleRule && rule.style) {
            const cssText = rule.style.cssText;
            if (cssText.includes('oklch')) {
              oklchCount++;
              originalStyles.push({ sIdx, rIdx, original: cssText });
              rule.style.cssText = cssText.replace(/oklch\([^)]+\)/g, '#000000');
            }
          }
        });
      } catch (e) {
        console.warn("Could not access stylesheet rules for", sheet.href);
      }
    });

    for (let i = 0; i < totalPages; i++) {
      showNotification(`Capturing page ${i + 1} of ${totalPages}...`);
      if (i > 0) doc.addPage();
      
      setCurrentPage(i);
      await new Promise(resolve => setTimeout(resolve, 1500));

      if (containerRef.current) {
        const images = Array.from(containerRef.current.getElementsByTagName('img')) as HTMLImageElement[];
        const imagePromises = images.map(img => {
          if (img.complete) return Promise.resolve();
          return new Promise(resolve => {
            img.onload = resolve;
            img.onerror = resolve;
          });
        });
        await Promise.all(imagePromises);

        const canvas = await html2canvas(containerRef.current, {
          useCORS: true,
          allowTaint: true,
          scale: 2,
          logging: false,
          backgroundColor: '#ffffff',
          onclone: (clonedDoc) => {
            const styles = Array.from(clonedDoc.getElementsByTagName('style'));
            const links = Array.from(clonedDoc.getElementsByTagName('link'));
            styles.forEach(s => s.remove());
            links.forEach(l => l.remove());
            
            const allElements = clonedDoc.getElementsByTagName('*');
            for (let j = 0; j < allElements.length; j++) {
              const el = allElements[j] as HTMLElement;
              
              // Konva uses canvas internally, html2canvas should capture it
              // but we need to make sure the stage is rendered
              
              if (el.style) {
                for (let k = 0; k < el.style.length; k++) {
                  const propName = el.style[k];
                  const propValue = el.style.getPropertyValue(propName);
                  if (propValue && propValue.includes('oklch')) {
                    el.style.setProperty(propName, '#000000', 'important');
                  }
                }
                
                const styleAttr = el.getAttribute('style');
                if (styleAttr && styleAttr.includes('oklch')) {
                  el.setAttribute('style', styleAttr.replace(/oklch\([^)]+\)/g, '#000000'));
                }
              }
            }

            const styleTag = clonedDoc.createElement('style');
            styleTag.innerHTML = `
              * { 
                color: #000000 !important; 
                background-color: transparent !important; 
                border-color: #000000 !important;
                outline-color: #000000 !important;
                fill: #000000 !important;
                stroke: #000000 !important;
              }
              .bg-primary, .text-primary, .border-primary {
                background-color: #ff0000 !important;
                color: #ffffff !important;
                border-color: #ff0000 !important;
              }
            `;
            clonedDoc.head.appendChild(styleTag);
          }
        });
        const imgData = canvas.toDataURL('image/jpeg', 0.9);
        doc.addImage(imgData, 'JPEG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
      }
    }
    
    originalStyles.forEach(({ sIdx, rIdx, original }) => {
      try {
        const sheet = document.styleSheets[sIdx];
        const rule = (sheet.cssRules || sheet.rules)[rIdx] as CSSStyleRule;
        rule.style.cssText = original;
      } catch (e) {}
    });
    
    showNotification("Uploading corrected PDF to Drive...");
    const pdfBlob = doc.output('blob') as Blob;
    const fileName = `Corrected_Submission_${submission.profiles?.full_name}_${Date.now()}.pdf`;
    return await uploadToDrive(pdfBlob, fileName, submission.profiles?.email);
  };

  const saveGrading = async (isReturn = false) => {
    if (isReturn) setIsReturning(true);
    else setIsSaving(true);
    
    const finalMarks = isNaN(marks) ? 0 : marks;
    
    try {
      let finalCorrectedId = correctedFileId;
      
      // If returning and no corrected file uploaded, generate one from annotations
      if (isReturn && !finalCorrectedId) {
        showNotification("Generating corrected PDF from annotations...");
        finalCorrectedId = await generateCorrectedPdf();
      }

      const { error } = await supabase.from('submissions').update({
        status: 'graded',
        marks_obtained: finalMarks,
        teacher_remarks: remarks,
        grade_data: { ink: inkData, comments: textComments },
        corrected_file_id: finalCorrectedId,
        is_released: isReturn ? true : submission.is_released,
        returned_at: isReturn ? new Date().toISOString() : submission.returned_at
      }).eq('id', submission.id);
      
      if (error) throw error;

      if (isReturn) {
        await supabase.from('notifications').insert({
          user_id: submission.student_id,
          title: 'Paper Returned',
          message: `Your submission for "${submission.tests?.title || 'the exam'}" has been graded and returned.`,
          type: 'grade'
        });
      }

      showNotification(isReturn ? "Submission returned to student!" : "Grading saved successfully!");
      onBack();
    } catch (err: any) {
      showNotification("Error saving grade: " + err.message, 'error');
    } finally {
      setIsSaving(false);
      setIsReturning(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex flex-col">
      <header className="bg-white p-4 flex justify-between items-center shadow-md">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-full transition"><X /></button>
          <div>
            <h3 className="font-bold">Grading: {submission.profiles?.full_name}</h3>
            <p className="text-xs text-gray-400">Submission ID: {submission.id}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-bold text-gray-500">Marks:</label>
            <input 
              type="number" 
              value={isNaN(marks) ? '' : marks} 
              onChange={(e) => {
                const val = parseInt(e.target.value);
                setMarks(isNaN(val) ? 0 : val);
              }}
              className="w-20 px-2 py-1 border rounded font-bold text-primary outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <button onClick={() => saveGrading(false)} disabled={isSaving || isReturning} className="bg-gray-100 text-gray-600 px-4 py-2 rounded-lg font-bold hover:bg-gray-200 transition disabled:opacity-50">
            {isSaving ? 'Saving...' : 'Save Draft'}
          </button>
          <button onClick={() => saveGrading(true)} disabled={isSaving || isReturning} className="bg-primary text-white px-6 py-2 rounded-lg font-bold hover:bg-primary/90 transition shadow-lg disabled:opacity-50 flex items-center gap-2">
            <Send className="w-4 h-4" />
            {isReturning ? 'Returning...' : 'Return to Student'}
          </button>
        </div>
      </header>
      
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative overflow-hidden flex flex-col items-center justify-start p-4 md:p-8 bg-gray-900 overflow-y-auto">
          <div className="relative bg-white shadow-2xl w-full max-w-5xl aspect-[3/4] md:aspect-auto md:h-[85vh] overflow-hidden shrink-0" ref={containerRef}>
            {/* Tool Selector Overlay */}
            <div className="absolute left-4 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-2 bg-white/90 backdrop-blur-sm p-2 rounded-xl shadow-xl border border-gray-200 pointer-events-auto">
              <button 
                onClick={() => setActiveTool('pen')}
                className={cn(
                  "p-3 rounded-lg transition-all duration-200",
                  activeTool === 'pen' ? "bg-primary text-white shadow-lg scale-110" : "text-gray-400 hover:bg-gray-100"
                )}
                title="Pen Tool"
              >
                <Pencil className="w-5 h-5" />
              </button>
              <button 
                onClick={() => setActiveTool('eraser')}
                className={cn(
                  "p-3 rounded-lg transition-all duration-200",
                  activeTool === 'eraser' ? "bg-primary text-white shadow-lg scale-110" : "text-gray-400 hover:bg-gray-100"
                )}
                title="Eraser Tool"
              >
                <Eraser className="w-5 h-5" />
              </button>
              <button 
                onClick={() => setActiveTool('text')}
                className={cn(
                  "p-3 rounded-lg transition-all duration-200",
                  activeTool === 'text' ? "bg-primary text-white shadow-lg scale-110" : "text-gray-400 hover:bg-gray-100"
                )}
                title="Text Tool"
              >
                <Type className="w-5 h-5" />
              </button>
              <div className="h-px bg-gray-200 my-1" />
              <button 
                onClick={() => {
                  if (window.confirm("Clear all annotations on this page?")) {
                    setInkData(prev => ({ ...prev, [currentPage]: [] }));
                    setTextComments(prev => ({ ...prev, [currentPage]: [] }));
                  }
                }}
                className="p-3 rounded-lg text-red-400 hover:bg-red-50 transition-all duration-200"
                title="Clear Page"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>

            {/* Image Page */}
            {pageIds.length > 0 ? (
              <DriveImage 
                fileId={pageIds[currentPage]}
                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                alt={`Page ${currentPage + 1}`}
                crossOrigin="anonymous"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                No images submitted
              </div>
            )}
            
            {/* Annotation Overlay */}
            <div className="absolute inset-0 z-20 pointer-events-none">
              <Stage 
                width={stageSize.width} 
                height={stageSize.height}
                ref={stageRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onTouchStart={handleMouseDown}
                onTouchMove={handleMouseMove}
                onTouchEnd={handleMouseUp}
                className="pointer-events-auto"
              >
                <Layer>
                  {(inkData[currentPage] || []).map((stroke, i) => (
                    <Line
                      key={i}
                      points={stroke.points.map((p: number, idx: number) => idx % 2 === 0 ? p * stageSize.width : p * stageSize.height)}
                      stroke="#ff0000"
                      strokeWidth={2}
                      tension={0.5}
                      lineCap="round"
                      lineJoin="round"
                    />
                  ))}
                  {(textComments[currentPage] || []).map((c, i) => (
                    <Label
                      key={i}
                      x={c.x * stageSize.width}
                      y={c.y * stageSize.height}
                      offsetX={50}
                      offsetY={20}
                    >
                      <Tag
                        fill="#fef9c3"
                        cornerRadius={4}
                        stroke="#facc15"
                        strokeWidth={1}
                        shadowBlur={2}
                      />
                      <KonvaText
                        text={c.text}
                        fontSize={14}
                        fill="#854d0e"
                        fontStyle="bold"
                        padding={8}
                      />
                    </Label>
                  ))}
                </Layer>
              </Stage>
            </div>
          </div>

          {/* Page Navigation */}
          {totalPages > 1 && (
            <div className="fixed bottom-8 left-[calc(50%-160px)] -translate-x-1/2 flex items-center gap-6 bg-white/10 px-6 py-3 rounded-full backdrop-blur-md z-30 border border-white/10">
              <button 
                onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="p-2 text-white hover:bg-white/20 rounded-full transition disabled:opacity-30"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <span className="text-white font-bold text-sm min-w-[100px] text-center">
                Page {currentPage + 1} of {totalPages}
              </span>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage === totalPages - 1}
                className="p-2 text-white hover:bg-white/20 rounded-full transition disabled:opacity-30"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </div>
          )}
        </div>
        
        <div className="w-80 bg-white border-l p-6 flex flex-col gap-4">
          <h4 className="font-bold text-gray-900 border-b pb-2">Grading Panel</h4>
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Teacher Remarks</label>
            <textarea 
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="w-full h-32 p-3 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary transition"
              placeholder="Add feedback for the student..."
            />
          </div>
          
          <div className="border-t pt-4">
            <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Corrected Copy</label>
            {!googleAuthorized ? (
              <button 
                onClick={async () => {
                  try {
                    await authorize();
                    setGoogleAuthorized(true);
                  } catch (err) {
                    showNotification("Google Drive authorization failed", 'error');
                  }
                }}
                className="w-full p-4 border-2 border-dashed border-primary/30 rounded-lg text-primary font-bold text-xs hover:bg-primary/5 transition flex flex-col items-center gap-2"
              >
                <Lock className="w-6 h-6" />
                Authorize Google Drive
              </button>
            ) : correctedFileId ? (
              <div className="bg-green-50 p-3 rounded-lg border border-green-100 mb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-green-700">
                    <FileCheck className="w-4 h-4" />
                    <span className="text-xs font-bold truncate max-w-[150px]">
                      {correctedFile ? correctedFile.name : 'File Uploaded'}
                    </span>
                  </div>
                  <button 
                    onClick={() => setCorrectedFileId(null)}
                    className="text-red-500 hover:bg-red-50 p-1 rounded"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <button 
                  onClick={() => window.open(getDriveViewUrl(correctedFileId), '_blank')}
                  className="mt-2 text-[10px] text-green-600 font-bold hover:underline flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" /> View Uploaded File
                </button>
              </div>
            ) : (
              <div className="relative">
                <input 
                  type="file" 
                  accept=".pdf,.doc,.docx"
                  onChange={handleCorrectedFileUpload}
                  className="hidden" 
                  id="corrected-upload"
                  disabled={isUploadingCorrected}
                />
                <label 
                  htmlFor="corrected-upload"
                  className={cn(
                    "flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-lg cursor-pointer transition hover:bg-gray-50",
                    isUploadingCorrected ? "opacity-50 cursor-not-allowed" : "border-gray-200"
                  )}
                >
                  <Upload className="w-6 h-6 text-gray-400 mb-2" />
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                    {isUploadingCorrected ? 'Uploading...' : 'Upload Corrected Copy'}
                  </span>
                  <span className="text-[8px] text-gray-400 mt-1">PDF or Word format</span>
                </label>
              </div>
            )}
          </div>

          <div className="mt-auto space-y-2">
            <p className="text-[10px] text-gray-400 text-center">
              Select the Text Tool and click anywhere on the paper to add a comment.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Submission Viewer ---

const SubmissionViewer = ({ submission, onBack }: { submission: any, onBack: () => void }) => {
  const [currentPage, setCurrentPage] = useState(0);
  const [googleAuthorized, setGoogleAuthorized] = useState(isAuthorized());
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  
  const pageIds = submission.page_ids || [];
  const totalPages = pageIds.length;
  
  const [inkData, setInkData] = useState<{[key: number]: any[]}>(() => {
    const raw = submission.grade_data?.ink || {};
    const normalized: {[key: number]: any[]} = {};
    Object.keys(raw).forEach(key => {
      const idx = parseInt(key);
      normalized[idx] = (raw[key] || []).map((stroke: any) => {
        if (!stroke.points) return { ...stroke, points: [] };
        let flat: number[] = [];
        if (typeof stroke.points[0] === 'number') {
          flat = stroke.points;
        } else {
          stroke.points.forEach((p: any) => {
            if (p && typeof p.x === 'number' && typeof p.y === 'number') {
              flat.push(p.x, p.y);
            }
          });
        }
        return { ...stroke, points: flat.filter(v => typeof v === 'number' && Number.isFinite(v)) };
      });
    });
    return normalized;
  });
  const textComments = submission.grade_data?.comments || {};

  useEffect(() => {
    checkAuth().then(authorized => {
      setGoogleAuthorized(authorized);
    });
  }, []);

  useEffect(() => {
    const resize = () => {
      if (containerRef.current) {
        setStageSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight
        });
      }
    };

    window.addEventListener('resize', resize);
    resize();
    const timer = setTimeout(resize, 100);
    return () => {
      window.removeEventListener('resize', resize);
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-black/95 z-[200] flex flex-col">
      <header className="bg-white p-4 flex justify-between items-center shadow-md">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-full transition"><X /></button>
          <div>
            <h3 className="font-bold text-sm md:text-base">View Submission: {submission.profiles?.full_name}</h3>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-400">ID: {submission.id}</span>
              {submission.status === 'graded' && (
                <span className="text-[10px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded font-bold">GRADED</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {submission.corrected_file_id && (
            <button 
              onClick={() => window.open(getDriveViewUrl(submission.corrected_file_id), '_blank')}
              className="flex items-center gap-2 bg-green-50 text-green-600 px-3 py-1.5 md:px-4 md:py-2 rounded-lg hover:bg-green-100 transition text-xs md:text-sm font-bold border border-green-100"
            >
              <FileCheck className="w-4 h-4" /> View Corrected Copy
            </button>
          )}
          {!googleAuthorized && (
            <button 
              onClick={async () => {
                try {
                  await authorize();
                  setGoogleAuthorized(true);
                } catch (err) {
                  console.error("Auth failed", err);
                }
              }}
              className="flex items-center gap-2 bg-primary text-white px-3 py-1.5 md:px-4 md:py-2 rounded-lg hover:bg-primary/90 transition text-xs md:text-sm font-bold shadow-sm"
            >
              <Lock className="w-4 h-4" /> Authorize Drive
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden p-4 md:p-8 bg-gray-900 overflow-y-auto flex-col items-center">
        <div className="relative bg-white shadow-2xl w-full max-w-5xl aspect-[3/4] md:aspect-auto md:h-[85vh] overflow-hidden shrink-0" ref={containerRef}>
          {pageIds.length > 0 ? (
            <>
              <DriveImage 
                fileId={pageIds[currentPage]}
                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                alt={`Page ${currentPage + 1}`}
                crossOrigin="anonymous"
              />
              
              {/* Annotation Overlay */}
              <div className="absolute inset-0 z-20 pointer-events-none">
                <Stage width={stageSize.width} height={stageSize.height}>
                  <Layer>
                    {(inkData[currentPage] || []).map((stroke: any, i: number) => (
                      <Line
                        key={i}
                        points={stroke.points.map((p: number, idx: number) => idx % 2 === 0 ? p * stageSize.width : p * stageSize.height)}
                        stroke="#ff0000"
                        strokeWidth={2}
                        tension={0.5}
                        lineCap="round"
                        lineJoin="round"
                      />
                    ))}
                    {(textComments[currentPage] || []).map((c: any, i: number) => (
                      <Label
                        key={i}
                        x={c.x * stageSize.width}
                        y={c.y * stageSize.height}
                        offsetX={50}
                        offsetY={20}
                      >
                        <Tag
                          fill="#fef9c3"
                          cornerRadius={4}
                          stroke="#facc15"
                          strokeWidth={1}
                          shadowBlur={2}
                        />
                        <KonvaText
                          text={c.text}
                          fontSize={14}
                          fill="#854d0e"
                          fontStyle="bold"
                          padding={8}
                        />
                      </Label>
                    ))}
                  </Layer>
                </Stage>
              </div>
            </>
          ) : submission.google_drive_file_id ? (
            <iframe 
              src={getEmbedUrl(getDriveViewUrl(submission.google_drive_file_id))}
              className="absolute inset-0 w-full h-full border-none"
              title="Submission PDF"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-gray-400">
              No content available
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-6 bg-white/10 px-6 py-3 rounded-full backdrop-blur-md z-30 border border-white/10">
            <button 
              onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="p-2 text-white hover:bg-white/20 rounded-full transition disabled:opacity-30"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <span className="text-white font-bold text-sm min-w-[100px] text-center">
              Page {currentPage + 1} of {totalPages}
            </span>
            <button 
              onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage === totalPages - 1}
              className="p-2 text-white hover:bg-white/20 rounded-full transition disabled:opacity-30"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// --- Notification Bell Component ---

const NotificationBell = ({ userId }: { userId: string }) => {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    fetchNotifications();
    const channel = supabase
      .channel(`notifications_${userId}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'notifications',
        filter: `user_id=eq.${userId}`
      }, () => {
        fetchNotifications();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const fetchNotifications = async () => {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);
    setNotifications(data || []);
  };

  const markAsRead = async (id: string) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    fetchNotifications();
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <div className="relative">
      <button 
        onClick={() => setShowDropdown(!showDropdown)}
        className="relative p-2 hover:bg-gray-100 rounded-full transition"
      >
        <Bell className="w-6 h-6 text-gray-600" />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full border-2 border-white">
            {unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {showDropdown && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-2xl border border-gray-100 z-50 overflow-hidden"
          >
            <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
              <h4 className="font-bold text-sm">Notifications</h4>
              <button 
                onClick={() => setShowDropdown(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">
                  No notifications yet
                </div>
              ) : (
                notifications.map(n => (
                  <div 
                    key={n.id} 
                    className={cn(
                      "p-4 border-b last:border-0 transition cursor-pointer hover:bg-gray-50",
                      !n.is_read ? "bg-blue-50/30" : ""
                    )}
                    onClick={() => markAsRead(n.id)}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <h5 className="font-bold text-xs text-gray-900">{n.title}</h5>
                      <span className="text-[10px] text-gray-400">{new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed">{n.message}</p>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- Live Proctoring View ---

const LiveProctoringView = ({ test, onBack }: { test: Test, onBack: () => void }) => {
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [viewMode, setViewMode] = useState<Record<string, 'camera' | 'screen'>>({});
  const [loading, setLoading] = useState(true);
  const [isRequestingAudio, setIsRequestingAudio] = useState<string | null>(null);
  const [isSendingWarning, setIsSendingWarning] = useState<string | null>(null);
  const [activeChatStudent, setActiveChatStudent] = useState<string | null>(null);
  const [allChats, setAllChats] = useState<any[]>([]);
  const [chatMessage, setChatMessage] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchActiveSessions();
    fetchLogs();
    fetchSnapshots();
    fetchChats();

    const sessionChannel = supabase
      .channel(`live_sessions_${test.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_sessions', filter: `test_id=eq.${test.id}` }, (payload) => {
        console.log('Session change detected:', payload);
        fetchActiveSessions();
      })
      .subscribe();

    const logChannel = supabase
      .channel(`proctoring_logs_${test.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'proctoring_logs', filter: `test_id=eq.${test.id}` }, (payload) => {
        console.log('Log change detected:', payload);
        fetchLogs();
      })
      .subscribe();

    const snapshotChannel = supabase
      .channel(`live_snapshots_${test.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_snapshots', filter: `test_id=eq.${test.id}` }, (payload) => {
        console.log('Snapshot change detected:', payload);
        fetchSnapshots();
      })
      .subscribe();

    const chatChannel = supabase
      .channel(`exam_chats_all_${test.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'exam_chats', filter: `test_id=eq.${test.id}` }, (payload) => {
        setAllChats(prev => [...prev, payload.new]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(sessionChannel);
      supabase.removeChannel(logChannel);
      supabase.removeChannel(snapshotChannel);
      supabase.removeChannel(chatChannel);
    };
  }, [test.id]);

  const fetchChats = async () => {
    const { data } = await supabase
      .from('exam_chats')
      .select('*')
      .eq('test_id', test.id)
      .order('created_at', { ascending: true });
    if (data) setAllChats(data);
  };

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [allChats, activeChatStudent]);

  const sendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim() || !activeChatStudent) return;
    const msg = chatMessage;
    const studentId = activeChatStudent;
    setChatMessage('');
    const { error } = await supabase.from('exam_chats').insert({
      test_id: test.id,
      student_id: studentId,
      sender_id: (await supabase.auth.getUser()).data.user?.id,
      message: msg
    });
    if (error) {
      console.error('Error sending chat message:', error);
      setChatMessage(msg);
    }
  };

  const fetchActiveSessions = async () => {
    console.log('Fetching active sessions for test:', test.id);
    // Use a more robust join syntax or fallback
    const { data, error } = await supabase
      .from('live_sessions')
      .select(`
        *,
        profiles (
          full_name,
          email
        )
      `)
      .eq('test_id', test.id);
    
    if (error) {
      console.error('Error fetching active sessions:', error);
      // Fallback: try without profiles join if it fails
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('live_sessions')
        .select('*')
        .eq('test_id', test.id);
      if (fallbackError) console.error('Fallback fetch error:', fallbackError);
      if (fallbackData) setActiveSessions(fallbackData);
    } else if (data) {
      console.log('Active sessions data:', data);
      setActiveSessions(data);
    }
    setLoading(false);
  };

  const fetchLogs = async () => {
    const { data, error } = await supabase
      .from('proctoring_logs')
      .select('*')
      .eq('test_id', test.id)
      .order('created_at', { ascending: false });
    if (error) console.error('Error fetching logs:', error);
    if (data) setLogs(data);
  };

  const fetchSnapshots = async () => {
    // Fetch latest snapshots for each student and type
    const { data, error } = await supabase
      .from('live_snapshots')
      .select('*')
      .eq('test_id', test.id)
      .order('created_at', { ascending: false })
      .limit(100); // Limit to recent snapshots to keep state manageable
    if (error) console.error('Error fetching snapshots:', error);
    if (data) setSnapshots(data);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <header className="p-6 bg-gray-800 border-b border-gray-700 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-gray-700 rounded-full transition"><ChevronLeft /></button>
          <div>
            <h2 className="text-xl font-bold">Live Proctoring: {test.title}</h2>
            <p className="text-xs text-gray-400">{activeSessions.filter(s => s.is_active).length} Students Active</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => {
              setLoading(true);
              fetchActiveSessions();
              fetchLogs();
              fetchSnapshots();
            }}
            className="p-2 hover:bg-gray-700 rounded-full transition text-gray-400 hover:text-white"
            title="Refresh Data"
          >
            <RefreshCw className={cn("w-5 h-5", loading && "animate-spin")} />
          </button>
          <div className="flex items-center gap-2 bg-green-500/10 text-green-500 px-3 py-1 rounded-full text-xs font-bold border border-green-500/20">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            LIVE MONITORING
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Active Students Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && activeSessions.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-4">
              <Loader2 className="w-12 h-12 animate-spin text-primary" />
              <p className="text-lg font-medium">Connecting to live streams...</p>
            </div>
          ) : activeSessions.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-4">
              <div className="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center">
                <Users className="w-10 h-10 text-gray-600" />
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-gray-300">No Students Active</p>
                <p className="text-sm max-w-xs mt-2">Students will appear here once they start their proctoring session.</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {activeSessions.map(session => {
                const studentLogs = logs.filter(l => l.user_id === session.user_id);
                const currentView = viewMode[session.user_id] || 'camera';
                const latestSnapshot = snapshots.find(s => s.user_id === session.user_id && s.type === currentView);
                const isOnline = session.is_active && (new Date().getTime() - new Date(session.last_seen).getTime() < 30000);
                const studentName = session.profiles?.full_name || session.user_id.split('-')[0];

                return (
                  <div key={session.id} className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden flex flex-col shadow-xl">
                    {/* Header */}
                    <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-800/50">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center text-primary font-bold">
                            {studentName[0]}
                          </div>
                          <div className={cn(
                            "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-gray-800",
                            isOnline ? "bg-green-500" : "bg-gray-500"
                          )} />
                        </div>
                        <div>
                          <h3 className="font-bold text-sm truncate max-w-[120px]">{studentName}</h3>
                          <p className="text-[10px] text-gray-400">{isOnline ? 'Online' : 'Offline'}</p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button 
                          onClick={() => setViewMode(prev => ({ ...prev, [session.user_id]: 'camera' }))}
                          className={cn("p-1.5 rounded-lg transition", currentView === 'camera' ? "bg-primary text-white" : "text-gray-400 hover:bg-gray-700")}
                          title="Camera View"
                        >
                          <Camera className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setViewMode(prev => ({ ...prev, [session.user_id]: 'screen' }))}
                          className={cn("p-1.5 rounded-lg transition", currentView === 'screen' ? "bg-primary text-white" : "text-gray-400 hover:bg-gray-700")}
                          title="Screen View"
                        >
                          <Monitor className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setActiveChatStudent(session.user_id)}
                          className={cn(
                            "p-1.5 rounded-lg transition relative",
                            activeChatStudent === session.user_id ? "bg-primary text-white" : "text-gray-400 hover:bg-gray-700"
                          )}
                          title="Chat with Student"
                        >
                          <MessageCircle className="w-4 h-4" />
                          {allChats.filter(c => c.student_id === session.user_id && c.sender_id === session.user_id).length > 0 && (
                            <div className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full border border-gray-800" />
                          )}
                        </button>
                      </div>
                    </div>
                
                <div className="aspect-video bg-black relative flex items-center justify-center overflow-hidden group">
                  {latestSnapshot ? (
                    <img src={latestSnapshot.image_data} className="w-full h-full object-cover" alt="Live Feed" />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-gray-600">
                      {currentView === 'camera' ? <User className="w-8 h-8" /> : <Monitor className="w-8 h-8" />}
                      <span className="text-[10px] font-bold uppercase tracking-widest">Waiting for {currentView}...</span>
                    </div>
                  )}
                  
                  {/* Audio Level Overlay */}
                  <div className="absolute bottom-2 left-2 flex items-center gap-2 bg-black/50 px-2 py-1 rounded-full backdrop-blur-sm">
                    <Mic className={cn("w-3 h-3", session.audio_level > 30 ? "text-red-500 animate-pulse" : "text-green-500")} />
                    <div className="w-12 h-1 bg-gray-700 rounded-full overflow-hidden">
                      <motion.div 
                        animate={{ width: `${Math.min(100, (session.audio_level || 0) * 2)}%` }}
                        className={cn("h-full", session.audio_level > 50 ? "bg-red-500" : "bg-green-500")}
                      />
                    </div>
                  </div>

                  {session.is_low_data && (
                    <div className="absolute top-2 right-2 bg-blue-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded uppercase">Low Data</div>
                  )}
                </div>

                <div className="p-4 flex-1 flex flex-col gap-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold text-gray-500 uppercase">Recent Violations</span>
                    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", studentLogs.length > 0 ? "bg-red-500/20 text-red-500" : "bg-green-500/20 text-green-500")}>
                      {studentLogs.length} Events
                    </span>
                  </div>
                  <div className="flex-1 max-h-24 overflow-y-auto space-y-2">
                    {studentLogs.length === 0 ? (
                      <div className="text-[10px] text-gray-600 italic">No violations detected</div>
                    ) : (
                      studentLogs.map((log, i) => (
                        <div key={i} className="text-[9px] bg-red-500/10 border border-red-500/20 p-2 rounded flex flex-col gap-2">
                          <div className="flex justify-between items-center">
                            <span className={cn("font-medium", log.event_type === 'audio_sample' ? "text-blue-400" : "text-red-400")}>
                              {log.event_type.replace('_', ' ').toUpperCase()}
                            </span>
                            <span className="text-gray-500">{new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          {log.audio_data && (
                            <audio src={log.audio_data} controls className="w-full h-6 scale-90 origin-left" />
                          )}
                        </div>
                      ))
                    )}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button 
                      disabled={isRequestingAudio === session.user_id}
                      onClick={async () => {
                        setIsRequestingAudio(session.user_id);
                        try {
                          const { error } = await supabase.from('notifications').insert({
                            user_id: session.user_id,
                            title: 'AUDIO CHECK',
                            message: 'Please stay quiet, recording a short audio sample for verification.',
                            type: 'audio_request'
                          });
                          if (error) throw error;
                          alert("Audio request sent!");
                        } catch (err) {
                          console.error("Error sending audio request:", err);
                          alert("Failed to send audio request.");
                        } finally {
                          setIsRequestingAudio(null);
                        }
                      }}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold py-2 rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      {isRequestingAudio === session.user_id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Request Audio'}
                    </button>
                    <button 
                      disabled={isSendingWarning === session.user_id}
                      onClick={async () => {
                        const msg = prompt("Enter warning message:");
                        if (msg) {
                          setIsSendingWarning(session.user_id);
                          try {
                            const { error } = await supabase.from('notifications').insert({
                              user_id: session.user_id,
                              title: 'PROCTORING WARNING',
                              message: msg,
                              type: 'warning'
                            });
                            if (error) throw error;
                            alert("Warning sent to student!");
                          } catch (err) {
                            console.error("Error sending warning:", err);
                            alert("Failed to send warning.");
                          } finally {
                            setIsSendingWarning(null);
                          }
                        }
                      }}
                      className="flex-1 bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold py-2 rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      {isSendingWarning === session.user_id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Send Warning'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          </div>
        )}
        </div>

        {/* Global Activity Log */}
        <div className="w-80 bg-gray-800 border-l border-gray-700 flex flex-col">
          {activeChatStudent ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-4 border-b border-gray-700 font-bold text-sm flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-primary" />
                  Chat: {activeSessions.find(s => s.user_id === activeChatStudent)?.profiles?.full_name || 'Student'}
                </div>
                <button onClick={() => setActiveChatStudent(null)} className="text-gray-500 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-900/50">
                {allChats.filter(c => c.student_id === activeChatStudent).length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-gray-600 text-center p-4">
                    <MessageCircle className="w-8 h-8 mb-2 opacity-20" />
                    <p className="text-[10px]">No messages yet. Start a conversation with the student.</p>
                  </div>
                ) : (
                  allChats.filter(c => c.student_id === activeChatStudent).map((chat, i) => (
                    <div key={i} className={cn(
                      "flex flex-col max-w-[90%]",
                      chat.sender_id !== activeChatStudent ? "ml-auto items-end" : "mr-auto items-start"
                    )}>
                      <div className={cn(
                        "px-3 py-2 rounded-xl text-[11px] shadow-sm",
                        chat.sender_id !== activeChatStudent 
                          ? "bg-primary text-white rounded-tr-none" 
                          : "bg-gray-700 text-gray-200 rounded-tl-none"
                      )}>
                        {chat.message}
                      </div>
                      <span className="text-[8px] text-gray-500 mt-1">
                        {new Date(chat.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))
                )}
                <div ref={chatEndRef} />
              </div>

              <form onSubmit={sendChatMessage} className="p-3 border-t border-gray-700 bg-gray-800 flex gap-2">
                <input 
                  type="text"
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 bg-gray-900 border-none rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-primary outline-none"
                />
                <button 
                  type="submit"
                  disabled={!chatMessage.trim()}
                  className="bg-primary text-white p-2 rounded-lg hover:bg-primary/90 transition disabled:opacity-50"
                >
                  <Send className="w-3 h-3" />
                </button>
              </form>
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-gray-700 font-bold text-sm flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                Global Activity Log
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {logs.map((log, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <div className={cn(
                      "p-1.5 rounded-lg shrink-0",
                      log.event_type === 'tab_switch' ? "bg-orange-500/10 text-orange-500" : "bg-red-500/10 text-red-500"
                    )}>
                      {log.event_type === 'tab_switch' ? <AlertTriangle className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-gray-300">{log.event_type.replace('_', ' ').toUpperCase()}</div>
                      <p className="text-[9px] text-gray-500 leading-tight">{log.details}</p>
                      <div className="text-[8px] text-gray-600 mt-1">{new Date(log.created_at).toLocaleTimeString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Teacher View ---

const TeacherDashboard = ({ user, profile, showNotification, setConfirmAction }: { user: any, profile: Profile | null, showNotification: (m: string, t?: 'success' | 'error') => void, setConfirmAction: (a: { message: string, onConfirm: () => void } | null) => void }) => {
  const [tests, setTests] = useState<Test[]>([]);
  const [selectedTest, setSelectedTest] = useState<Test | null>(null);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [isLowData, setIsLowData] = useState(false);
  const [gradingSubmission, setGradingSubmission] = useState<any | null>(null);
  const [viewingSubmission, setViewingSubmission] = useState<any | null>(null);
  const [isProctoringViewOpen, setIsProctoringViewOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'tests' | 'users'>('tests');
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingTestId, setEditingTestId] = useState<string | null>(null);
  const [googleAuthorized, setGoogleAuthorized] = useState(isAuthorized());
  const [showQuestionPaper, setShowQuestionPaper] = useState(false);
  const [newTestData, setNewTestData] = useState({
    title: '',
    subject: '',
    total_marks: 100,
    passing_marks: 35,
    description: '',
    question_paper_url: '',
    assigned_students: null as string[] | null,
    invigilator_id: user.id,
    proctoring_config: { camera: true, mic: true, screen: true },
    is_low_data_default: false,
    start_time: new Date().toISOString().slice(0, 16),
    end_time: new Date(Date.now() + 3600000).toISOString().slice(0, 16)
  });

  const calculateDuration = (start: string, end: string) => {
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    return Math.max(0, Math.floor((e - s) / 60000));
  };

  useEffect(() => {
    fetchTests();
    fetchAllProfiles();
    checkAuth().then(setGoogleAuthorized);
  }, [profile]);

  const fetchTests = async () => {
    const { data } = await supabase.from('tests').select('*').eq('teacher_id', user.id);
    if (data) setTests(data);
  };

  const fetchAllProfiles = async () => {
    const { data, error } = await supabase.from('profiles').select('*');
    if (error) console.error('Error fetching profiles:', error);
    if (data) setAllProfiles(data);
  };

  const fetchSubmissions = async (testId: string) => {
    const { data } = await supabase.from('submissions').select('*, profiles(full_name, email)').eq('test_id', testId);
    if (data) setSubmissions(data);
  };

  const handleCreateTest = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Ensure a course exists
    let courseId = '';
    const { data: courses } = await supabase.from('courses').select('id').limit(1);
    if (courses && courses.length > 0) {
      courseId = courses[0].id;
    } else {
      const { data: newCourse, error: courseError } = await supabase.from('courses').insert({
        name: 'General Course',
        teacher_id: user.id
      }).select().single();
      if (courseError) {
        alert("Error creating course: " + courseError.message);
        return;
      }
      courseId = newCourse.id;
    }

    const duration = calculateDuration(newTestData.start_time, newTestData.end_time);

    if (editingTestId) {
      const { error } = await supabase.from('tests').update({
        ...newTestData,
        duration_minutes: duration,
        start_time: new Date(newTestData.start_time).toISOString(),
        end_time: new Date(newTestData.end_time).toISOString()
      }).eq('id', editingTestId);

      if (error) {
        alert("Error updating test: " + error.message);
      } else {
        setIsCreateModalOpen(false);
        setEditingTestId(null);
        fetchTests();
        resetTestData();
        showNotification("Test updated successfully!", 'success');
      }
    } else {
      const { error } = await supabase.from('tests').insert({
        ...newTestData,
        course_id: courseId,
        teacher_id: user.id,
        duration_minutes: duration,
        start_time: new Date(newTestData.start_time).toISOString(),
        end_time: new Date(newTestData.end_time).toISOString()
      });

      if (error) {
        alert("Error creating test: " + error.message);
      } else {
        setIsCreateModalOpen(false);
        fetchTests();
        resetTestData();
        showNotification("Test created successfully!", 'success');
      }
    }
  };

  const resetTestData = () => {
    setNewTestData({
      title: '',
      subject: '',
      total_marks: 100,
      passing_marks: 35,
      description: '',
      question_paper_url: '',
      assigned_students: null,
      invigilator_id: user.id,
      proctoring_config: { camera: true, mic: true, screen: true },
      is_low_data_default: false,
      start_time: new Date().toISOString().slice(0, 16),
      end_time: new Date(Date.now() + 3600000).toISOString().slice(0, 16)
    });
  };

  const startEditingTest = (test: Test) => {
    setEditingTestId(test.id);
    setNewTestData({
      title: test.title,
      subject: test.subject,
      total_marks: test.total_marks,
      passing_marks: test.passing_marks,
      description: test.description || '',
      question_paper_url: test.question_paper_url || '',
      assigned_students: test.assigned_students,
      invigilator_id: test.invigilator_id,
      proctoring_config: test.proctoring_config,
      is_low_data_default: test.is_low_data_default,
      start_time: new Date(test.start_time).toISOString().slice(0, 16),
      end_time: new Date(test.end_time).toISOString().slice(0, 16)
    });
    setIsCreateModalOpen(true);
  };

  const handleTogglePause = async (testId: string, currentPaused: boolean) => {
    const { error } = await supabase
      .from('tests')
      .update({ is_paused: !currentPaused })
      .eq('id', testId);
    if (error) alert(error.message);
    else fetchTests();
  };

  const handleModifyTiming = async (testId: string, extraMinutes: number) => {
    const test = tests.find(t => t.id === testId);
    if (!test) return;
    
    const newEndTime = new Date(new Date(test.end_time).getTime() + extraMinutes * 60000).toISOString();
    const newDuration = test.duration_minutes + extraMinutes;

    const { error } = await supabase
      .from('tests')
      .update({ end_time: newEndTime, duration_minutes: newDuration })
      .eq('id', testId);
    if (error) alert(error.message);
    else fetchTests();
  };

  const handleDeleteTest = async (testId: string) => {
    setConfirmAction({
      message: "Are you sure you want to delete this test? This action cannot be undone and all submissions will be lost.",
      onConfirm: async () => {
        const { error } = await supabase.from('tests').delete().eq('id', testId);
        if (error) showNotification(error.message, 'error');
        else {
          showNotification("Test deleted successfully", 'success');
          fetchTests();
        }
      }
    });
  };

  if (gradingSubmission) {
    return <GradingView 
      submission={gradingSubmission} 
      onBack={() => {
        setGradingSubmission(null);
        if (selectedTest) fetchSubmissions(selectedTest.id);
      }} 
      showNotification={showNotification}
    />;
  }

  if (viewingSubmission) {
    return <SubmissionViewer 
      submission={viewingSubmission} 
      onBack={() => setViewingSubmission(null)} 
    />;
  }

  if (isProctoringViewOpen && selectedTest) {
    return <LiveProctoringView 
      test={selectedTest} 
      onBack={() => setIsProctoringViewOpen(false)} 
    />;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Question Paper Overlay */}
      {showQuestionPaper && selectedTest && (
        <div className="fixed inset-0 bg-black/80 z-[200] flex flex-col">
          <header className="p-4 bg-white flex justify-between items-center">
            <h3 className="font-bold">Question Paper Preview: {selectedTest.title}</h3>
            <button onClick={() => setShowQuestionPaper(false)} className="bg-primary text-white px-4 py-2 rounded-lg font-bold">Close Preview</button>
          </header>
          <div className="flex-1 p-0 md:p-8 overflow-auto flex justify-center bg-gray-100">
            <div className="max-w-5xl w-full bg-white shadow-2xl min-h-full border flex flex-col">
              {selectedTest.question_paper_url?.includes('drive.google.com') || selectedTest.question_paper_url?.includes('docs.google.com') || /^[a-zA-Z0-9_-]{25,45}$/.test(selectedTest.question_paper_url || '') ? (
                <iframe 
                  src={getEmbedUrl(selectedTest.question_paper_url)} 
                  className="w-full flex-1 border-0" 
                  allow="autoplay; fullscreen"
                  title="Question Paper Preview"
                  style={{ minHeight: '80vh' }}
                />
              ) : selectedTest.question_paper_url?.startsWith('http') ? (
                <iframe 
                  src={selectedTest.question_paper_url} 
                  className="w-full flex-1 border-0" 
                  title="Question Paper Preview" 
                  allow="autoplay; fullscreen"
                  style={{ minHeight: '80vh' }}
                />
              ) : (
                <div className="text-center py-20 flex-1 flex flex-col items-center justify-center">
                  <FileText className="w-20 h-20 text-gray-200 mb-4" />
                  <p className="text-gray-400 font-bold">Question Paper (ID: {selectedTest.question_paper_url})</p>
                  <p className="text-xs text-gray-300 mt-2 italic">Please ensure the URL is a valid web link or Google Drive preview link.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-64 bg-white border-r hidden md:flex flex-col">
        <div className="p-6 border-b">
          <h1 className="text-xl font-bold text-primary">Examfriendly</h1>
          <p className="text-xs text-gray-400">{profile?.role === 'admin' ? 'Admin' : 'Teacher'} Dashboard</p>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          <button 
            onClick={() => setActiveTab('tests')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition",
              activeTab === 'tests' ? "bg-primary/10 text-primary" : "text-gray-600 hover:bg-gray-50"
            )}
          >
            <BookOpen className="w-5 h-5" /> My Tests
          </button>
          {profile?.role === 'admin' && (
            <button 
              onClick={() => setActiveTab('users')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition",
                activeTab === 'users' ? "bg-primary/10 text-primary" : "text-gray-600 hover:bg-gray-50"
              )}
            >
              <User className="w-5 h-5" /> User Management
            </button>
          )}
        </nav>
        <div className="p-4 border-t">
          <button onClick={() => supabase.auth.signOut()} className="w-full flex items-center gap-3 px-4 py-3 text-red-500 hover:bg-red-50 rounded-lg font-medium">
            <LogOut className="w-5 h-5" /> Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b px-8 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">Welcome, {profile?.full_name || user.email}</h2>
          <div className="flex items-center gap-6">
            {!googleAuthorized && (
              <button 
                onClick={async () => {
                  try {
                    await authorize();
                    setGoogleAuthorized(isAuthorized());
                    showNotification("Google Drive connected successfully!", 'success');
                  } catch (err) {
                    showNotification("Failed to connect Google Drive.", 'error');
                  }
                }}
                className="bg-red-100 text-red-600 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-red-200 transition flex items-center gap-2"
              >
                <ShieldAlert className="w-4 h-4" />
                Connect Drive
              </button>
            )}
            <NotificationBell userId={user.id} />
            <label className="flex items-center gap-2 text-sm font-medium text-gray-600 cursor-pointer">
              <input 
                type="checkbox" 
                checked={isLowData} 
                onChange={async (e) => {
                  const checked = e.target.checked;
                  setIsLowData(checked);
                  if (selectedTest) {
                    const { error } = await supabase
                      .from('live_sessions')
                      .update({ is_low_data: checked })
                      .eq('test_id', selectedTest.id);
                    if (error) console.error('Error updating low data mode:', error);
                  }
                }}
                className="w-4 h-4 text-primary rounded"
              />
              Low Data Mode
            </label>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          {activeTab === 'tests' ? (
            !selectedTest ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {tests.map(test => (
                  <motion.div 
                    key={test.id}
                    whileHover={{ y: -4 }}
                    onClick={() => {
                      setSelectedTest(test);
                      fetchSubmissions(test.id);
                    }}
                    className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 cursor-pointer hover:shadow-md transition"
                  >
                    <div 
                      onClick={() => {
                        setSelectedTest(test);
                        fetchSubmissions(test.id);
                      }}
                      className="cursor-pointer"
                    >
                      <div className="flex justify-between items-start mb-4">
                        <div className="p-3 bg-primary/10 rounded-xl">
                          <FileText className="text-primary w-6 h-6" />
                        </div>
                        <div className="flex gap-2">
                          {test.is_paused && <span className="text-[10px] font-bold bg-orange-100 text-orange-600 px-2 py-1 rounded uppercase">PAUSED</span>}
                          <span className="text-[10px] font-bold bg-green-100 text-green-600 px-2 py-1 rounded uppercase">ACTIVE</span>
                        </div>
                      </div>
                      <h3 className="font-bold text-lg mb-1">{test.title}</h3>
                      <div className="text-xs font-bold text-primary mb-2 uppercase tracking-wider">{test.subject}</div>
                      <p className="text-gray-500 text-sm line-clamp-2 mb-4">{test.description}</p>
                      <div className="flex items-center gap-4 text-xs text-gray-400 mb-4">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {test.duration_minutes}m</span>
                        <span className="flex items-center gap-1"><User className="w-3 h-3" /> {test.assigned_students?.length || 'All'} Students</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 pt-4 border-t">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleTogglePause(test.id, test.is_paused); }}
                        className={cn(
                          "flex-1 py-2 rounded-lg text-xs font-bold transition",
                          test.is_paused ? "bg-green-500 text-white" : "bg-orange-500 text-white"
                        )}
                      >
                        {test.is_paused ? 'Resume' : 'Pause'}
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleModifyTiming(test.id, 15); }}
                        className="flex-1 bg-gray-100 text-gray-600 py-2 rounded-lg text-xs font-bold hover:bg-gray-200 transition"
                      >
                        +15m
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); startEditingTest(test); }}
                        className="flex-1 bg-primary/10 text-primary py-2 rounded-lg text-xs font-bold hover:bg-primary/20 transition"
                      >
                        Edit
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleDeleteTest(test.id); }}
                        className="p-2 bg-red-50 text-red-500 rounded-lg hover:bg-red-100 transition"
                        title="Delete Test"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                ))}
                  <button 
                    onClick={() => setIsCreateModalOpen(true)}
                    className="border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center text-gray-400 hover:border-primary hover:text-primary transition p-6"
                  >
                    <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mb-2">
                      <BookOpen className="w-6 h-6" />
                    </div>
                    <span className="font-bold">Create New Test</span>
                  </button>
                </div>
              ) : (
              <div className="space-y-6">
                <button onClick={() => setSelectedTest(null)} className="text-primary font-bold flex items-center gap-2 mb-4">
                  ← Back to Tests
                </button>
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-6 border-b flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <h3 className="font-bold text-lg">Submissions: {selectedTest.title}</h3>
                      <button 
                        onClick={() => setShowQuestionPaper(true)}
                        className="text-primary font-bold text-sm flex items-center gap-1 hover:underline"
                      >
                        <FileText className="w-4 h-4" /> View Paper
                      </button>
                      <button 
                        onClick={() => setIsProctoringViewOpen(true)}
                        className="text-orange-600 font-bold text-sm flex items-center gap-1 hover:underline ml-4"
                      >
                        <ShieldAlert className="w-4 h-4" /> Live Proctoring
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => {
                          setConfirmAction({
                            message: `Are you sure you want to release scores for all ${submissions.length} students?`,
                            onConfirm: async () => {
                              const { error } = await supabase
                                .from('submissions')
                                .update({ 
                                  is_released: true,
                                  returned_at: new Date().toISOString()
                                })
                                .eq('test_id', selectedTest.id)
                                .eq('status', 'graded');
                              
                              if (error) showNotification(error.message, 'error');
                              else {
                                showNotification("All graded scores released successfully!");
                                fetchSubmissions(selectedTest.id);
                              }
                              setConfirmAction(null);
                            }
                          });
                        }}
                        className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-green-700 transition shadow-sm"
                      >
                        <Send className="w-4 h-4" /> Release All Scores
                      </button>
                      <button 
                        onClick={() => {
                          submissions.forEach(sub => {
                            if (sub.google_drive_file_id) {
                              window.open(getDriveViewUrl(sub.google_drive_file_id), '_blank');
                            }
                          });
                        }}
                        className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2"
                      >
                        <Download className="w-4 h-4" /> Bulk Download
                      </button>
                    </div>
                  </div>
                  <table className="w-full text-left">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase font-bold">
                      <tr>
                        <th className="px-6 py-4">Student</th>
                        <th className="px-6 py-4">Submitted At</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {submissions.map(sub => (
                        <tr key={sub.id} className="hover:bg-gray-50 transition">
                          <td className="px-6 py-4">
                            <div className="font-bold">{sub.profiles?.full_name || 'Student'}</div>
                            <div className="text-xs text-gray-400">{sub.profiles?.email}</div>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500">
                            {new Date(sub.submitted_at).toLocaleString()}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col gap-1">
                              <span className={cn(
                                "text-[10px] font-bold px-2 py-1 rounded uppercase w-fit",
                                sub.is_released ? "bg-green-100 text-green-600" : 
                                sub.status === 'graded' ? "bg-blue-100 text-blue-600" : 
                                "bg-orange-100 text-orange-600"
                              )}>
                                {sub.is_released ? 'Released' : sub.status === 'graded' ? 'Graded (Draft)' : sub.status}
                              </span>
                              {sub.is_released && sub.returned_at && (
                                <span className="text-[8px] text-gray-400 font-bold uppercase">
                                  Returned {new Date(sub.returned_at).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 flex items-center gap-3">
                            <button 
                              onClick={() => setGradingSubmission(sub)}
                              className="text-primary font-bold text-sm flex items-center gap-1 hover:underline"
                            >
                              <PenTool className="w-4 h-4" /> {sub.status === 'graded' ? 'Edit Grade' : 'Grade'}
                            </button>
                            {sub.status === 'graded' && !sub.is_released && (
                              <button 
                                onClick={async () => {
                                  const { error } = await supabase
                                    .from('submissions')
                                    .update({ is_released: true, returned_at: new Date().toISOString() })
                                    .eq('id', sub.id);
                                  if (!error) {
                                    showNotification("Submission returned successfully!");
                                    fetchSubmissions(selectedTest.id);
                                  } else {
                                    showNotification(error.message, 'error');
                                  }
                                }}
                                className="text-green-600 font-bold text-sm flex items-center gap-1 hover:underline"
                              >
                                <Send className="w-4 h-4" /> Return
                              </button>
                            )}
                            <button 
                              onClick={() => setViewingSubmission(sub)}
                              className="text-gray-600 font-bold text-sm flex items-center gap-1 hover:underline"
                            >
                              <FileText className="w-4 h-4" /> View
                            </button>
                            <button 
                              onClick={() => downloadSubmissionAsPdf(sub, showNotification)}
                              className="text-blue-600 font-bold text-sm flex items-center gap-1 hover:underline"
                            >
                              <Download className="w-4 h-4" /> PDF
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          ) : (
            <div className="space-y-6">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="font-bold text-lg">User Management</h3>
                  <div className="bg-blue-50 text-blue-600 p-3 rounded-lg text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Admin Note: Use Supabase Dashboard to create Auth accounts, then assign roles here.</span>
                  </div>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase font-bold">
                      <tr>
                        <th className="px-6 py-4">User</th>
                        <th className="px-6 py-4">Role</th>
                        <th className="px-6 py-4">Joined</th>
                        <th className="px-6 py-4">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {allProfiles.map(p => (
                        <tr key={p.id} className="hover:bg-gray-50 transition">
                          <td className="px-6 py-4">
                            <div className="font-bold">{p.full_name || 'No Name'}</div>
                            <div className="text-xs text-gray-400">{p.email}</div>
                          </td>
                          <td className="px-6 py-4">
                            <select 
                              value={p.role}
                              onChange={async (e) => {
                                const newRole = e.target.value as any;
                                const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', p.id);
                                if (!error) fetchAllProfiles();
                                else alert(error.message);
                              }}
                              className="text-sm border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-primary"
                            >
                              <option value="student">Student</option>
                              <option value="teacher">Teacher</option>
                              <option value="admin">Admin</option>
                              <option value="co-admin">Co-Admin</option>
                            </select>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500">
                            {/* @ts-ignore */}
                            {new Date(p.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4">
                            <button className="text-red-500 hover:underline text-sm font-bold">Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Create Test Modal */}
        <AnimatePresence>
          {isCreateModalOpen && (
            <div className="fixed inset-0 bg-black/50 z-[110] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden"
              >
                <div className="p-6 border-b flex justify-between items-center">
                  <h3 className="text-xl font-bold">{editingTestId ? 'Edit Test' : 'Create New Test'}</h3>
                  <button onClick={() => { setIsCreateModalOpen(false); setEditingTestId(null); resetTestData(); }} className="p-2 hover:bg-gray-100 rounded-full"><X /></button>
                </div>
                <form onSubmit={handleCreateTest} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Test Title</label>
                      <input 
                        type="text" 
                        required
                        value={newTestData.title}
                        onChange={(e) => setNewTestData(prev => ({ ...prev, title: e.target.value }))}
                        className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary outline-none transition"
                        placeholder="e.g. Midterm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                      <input 
                        type="text" 
                        required
                        value={newTestData.subject}
                        onChange={(e) => setNewTestData(prev => ({ ...prev, subject: e.target.value }))}
                        className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary outline-none transition"
                        placeholder="e.g. Mathematics"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Total Marks</label>
                      <input 
                        type="number" 
                        required
                        value={newTestData.total_marks || ''}
                        onChange={(e) => setNewTestData(prev => ({ ...prev, total_marks: parseInt(e.target.value) || 0 }))}
                        className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary outline-none transition"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Passing Marks</label>
                      <input 
                        type="number" 
                        required
                        value={newTestData.passing_marks || ''}
                        onChange={(e) => setNewTestData(prev => ({ ...prev, passing_marks: parseInt(e.target.value) || 0 }))}
                        className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary outline-none transition"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                      <input 
                        type="datetime-local" 
                        required
                        value={newTestData.start_time}
                        onChange={(e) => setNewTestData(prev => ({ ...prev, start_time: e.target.value }))}
                        className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary outline-none transition"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                      <input 
                        type="datetime-local" 
                        required
                        value={newTestData.end_time}
                        onChange={(e) => setNewTestData(prev => ({ ...prev, end_time: e.target.value }))}
                        className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary outline-none transition"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Question Paper (PDF or Link)</label>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        value={newTestData.question_paper_url}
                        onChange={(e) => setNewTestData(prev => ({ ...prev, question_paper_url: e.target.value }))}
                        className="flex-1 px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary outline-none transition"
                        placeholder="Google Drive ID or Form Link"
                      />
                      <label className="bg-gray-100 hover:bg-gray-200 text-gray-600 px-4 py-2 rounded-lg font-bold cursor-pointer transition flex items-center gap-2">
                        <Upload className="w-4 h-4" />
                        <span className="text-xs">Upload PDF</span>
                        <input 
                          type="file" 
                          accept="application/pdf" 
                          className="hidden" 
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            if (!isAuthorized()) {
                              alert("Google Drive not connected. Please connect Drive first using the button in the dashboard.");
                              return;
                            }
                            try {
                              const fileId = await uploadToDrive(file, `${newTestData.title}_QuestionPaper.pdf`, user.email!);
                              const previewUrl = getEmbedUrl(fileId);
                              setNewTestData(prev => ({ ...prev, question_paper_url: previewUrl }));
                              showNotification("Question paper uploaded successfully to Google Drive!", 'success');
                            } catch (err) {
                              console.error("Upload error:", err);
                              showNotification("Failed to upload to Google Drive. Please check your connection.", 'error');
                            }
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Assign Students</label>
                    <select 
                      multiple
                      className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary outline-none transition h-24"
                      onChange={(e) => {
                        const select = e.target as HTMLSelectElement;
                        const values = Array.from(select.selectedOptions, option => option.value);
                        setNewTestData(prev => ({ ...prev, assigned_students: values.includes('all') ? null : values }));
                      }}
                    >
                      <option value="all">All Students</option>
                      {allProfiles.filter(p => p.role === 'student').map(s => (
                        <option key={s.id} value={s.id}>{s.full_name || s.email}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Assign Invigilator</label>
                    <select 
                      value={newTestData.invigilator_id}
                      onChange={(e) => setNewTestData(prev => ({ ...prev, invigilator_id: e.target.value }))}
                      className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-primary outline-none transition"
                    >
                      {allProfiles.filter(p => p.role === 'teacher' || p.role === 'admin').map(t => (
                        <option key={t.id} value={t.id}>{t.full_name || t.email}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2 pt-2 border-t">
                    <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Advanced Settings</h4>
                    <div className="flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={newTestData.proctoring_config.camera}
                          onChange={(e) => setNewTestData(prev => ({ ...prev, proctoring_config: { ...prev.proctoring_config, camera: e.target.checked } }))}
                          className="w-4 h-4 text-primary rounded"
                        />
                        Camera
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={newTestData.proctoring_config.mic}
                          onChange={(e) => setNewTestData(prev => ({ ...prev, proctoring_config: { ...prev.proctoring_config, mic: e.target.checked } }))}
                          className="w-4 h-4 text-primary rounded"
                        />
                        Mic
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={newTestData.proctoring_config.screen}
                          onChange={(e) => setNewTestData(prev => ({ ...prev, proctoring_config: { ...prev.proctoring_config, screen: e.target.checked } }))}
                          className="w-4 h-4 text-primary rounded"
                        />
                        Screen
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={newTestData.is_low_data_default}
                          onChange={(e) => setNewTestData(prev => ({ ...prev, is_low_data_default: e.target.checked }))}
                          className="w-4 h-4 text-primary rounded"
                        />
                        Low Data Mode
                      </label>
                    </div>
                  </div>

                  <button 
                    type="submit"
                    className="w-full bg-primary text-white font-bold py-3 rounded-lg hover:bg-primary/90 transition shadow-lg mt-4"
                  >
                    {editingTestId ? 'Update Test' : 'Create Test'}
                  </button>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
};

const StudentDashboard = ({ user, profile, onEnterExam, showNotification }: { user: any, profile: Profile, onEnterExam: (test: Test) => void, showNotification: (m: string, t?: 'success' | 'error') => void }) => {
  const [tests, setTests] = useState<Test[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingSubmission, setViewingSubmission] = useState<any | null>(null);

  useEffect(() => {
    fetchData();

    // Subscribe to submission changes
    const subChannel = supabase
      .channel(`student_subs_${user.id}`)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'submissions',
        filter: `student_id=eq.${user.id}`
      }, () => {
        fetchData();
      })
      .subscribe();

    // Subscribe to test changes (auto-refresh dashboard)
    const testChannel = supabase
      .channel(`student_tests_${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'tests'
      }, () => {
        fetchData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subChannel);
      supabase.removeChannel(testChannel);
    };
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch tests assigned to this student or all students
      const { data: testsData } = await supabase
        .from('tests')
        .select('*')
        .or(`assigned_students.is.null,assigned_students.cs.{"${user.id}"}`)
        .order('start_time', { ascending: false });

      // Fetch student's submissions
      const { data: subsData } = await supabase
        .from('submissions')
        .select('*')
        .eq('student_id', user.id);

      setTests(testsData || []);
      setSubmissions(subsData || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getSubmissionForTest = (testId: string) => {
    return submissions.find(s => s.test_id === testId);
  };

  const handleRequestRecheck = async (subId: string) => {
    const sub = submissions.find(s => s.id === subId);
    if (!sub) return;
    
    const test = tests.find(t => t.id === sub.test_id);
    if (!test) return;

    const { error } = await supabase
      .from('submissions')
      .update({ status: 'recheck_requested' })
      .eq('id', subId);
      
    if (!error) {
      // Send notification to teacher
      await supabase.from('notifications').insert({
        user_id: test.teacher_id,
        title: 'Recheck Requested',
        message: `${profile.full_name || 'A student'} has requested a recheck for the test "${test.title}".`,
        type: 'recheck'
      });
      fetchData();
      showNotification("Recheck requested successfully!");
    } else showNotification(error.message, 'error');
  };

  if (loading) return <div className="p-12 text-center text-gray-400">Loading exams...</div>;

  if (viewingSubmission) {
    return <SubmissionViewer 
      submission={viewingSubmission} 
      onBack={() => setViewingSubmission(null)} 
    />;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <header className="max-w-6xl mx-auto flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold">My Exams</h1>
          <p className="text-gray-500">Welcome back, {profile.full_name || user.email}</p>
        </div>
        <button onClick={() => supabase.auth.signOut()} className="text-red-500 font-bold flex items-center gap-2">
          <LogOut className="w-5 h-5" /> Logout
        </button>
      </header>

      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tests.map(test => {
          const sub = getSubmissionForTest(test.id);
          const isUpcoming = new Date(test.start_time) > new Date();
          const isPast = new Date(test.end_time) < new Date();
          const isActive = !isUpcoming && !isPast;

          return (
            <motion.div 
              key={test.id}
              whileHover={{ y: -4 }}
              className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-primary/10 rounded-xl">
                  <BookOpen className="text-primary w-6 h-6" />
                </div>
                <div className="flex flex-col items-end gap-1">
                  {isUpcoming && <span className="text-[10px] font-bold bg-blue-100 text-blue-600 px-2 py-1 rounded uppercase">UPCOMING</span>}
                  {isActive && <span className="text-[10px] font-bold bg-green-100 text-green-600 px-2 py-1 rounded uppercase">ACTIVE</span>}
                  {isPast && <span className="text-[10px] font-bold bg-gray-100 text-gray-600 px-2 py-1 rounded uppercase">EXPIRED</span>}
                  {sub && <span className="text-[10px] font-bold bg-primary/10 text-primary px-2 py-1 rounded uppercase">SUBMITTED</span>}
                </div>
              </div>
              
              <h3 className="font-bold text-lg mb-1">{test.title}</h3>
              <div className="text-xs font-bold text-primary mb-2 uppercase tracking-wider">{test.subject}</div>
              <p className="text-gray-500 text-sm mb-4 line-clamp-2">{test.description}</p>
              
              <div className="space-y-2 mb-6 mt-auto">
                <div className="flex items-center justify-between text-[10px] text-gray-400 font-medium uppercase tracking-wider">
                  <span>Start</span>
                  <span>{new Date(test.start_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-gray-400 font-medium uppercase tracking-wider">
                  <span>End</span>
                  <span>{new Date(test.end_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-400 pt-2 border-t border-gray-50">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {test.duration_minutes}m</span>
                  <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> Proctoring</span>
                </div>
              </div>

              {sub ? (
                <div className="space-y-3 pt-4 border-t">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-gray-400 uppercase">Result</span>
                    <span className={cn(
                      "text-sm font-bold",
                      sub.is_released === true ? "text-green-600" : "text-orange-500"
                    )}>
                      {sub.is_released === true ? `${sub.marks_obtained} / ${test.total_marks}` : 'Awaiting Grade'}
                    </span>
                  </div>
                  {sub.is_released === true && (
                    <>
                      <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-600 italic">
                        "{sub.teacher_remarks || 'No remarks provided.'}"
                      </div>
                      <div className="flex flex-col gap-2">
                        <div className="flex gap-2">
                          <button 
                            onClick={() => setViewingSubmission(sub)}
                            className="flex-1 bg-gray-100 text-gray-600 py-2 rounded-lg text-xs font-bold hover:bg-gray-200 transition flex items-center justify-center gap-1"
                          >
                            <FileText className="w-3 h-3" /> View Paper
                          </button>
                          {sub.corrected_file_id && (
                            <button 
                              onClick={() => window.open(getDriveViewUrl(sub.corrected_file_id), '_blank')}
                              className="flex-1 bg-green-50 text-green-600 py-2 rounded-lg text-xs font-bold hover:bg-green-100 transition border border-green-100 flex items-center justify-center gap-1"
                            >
                              <FileCheck className="w-3 h-3" /> Corrected Copy
                            </button>
                          )}
                        </div>
                        {sub.status !== 'recheck_requested' && (
                          <button 
                            onClick={() => handleRequestRecheck(sub.id)}
                            className="w-full bg-primary/10 text-primary py-2 rounded-lg text-xs font-bold hover:bg-primary/20 transition"
                          >
                            Request Recheck
                          </button>
                        )}
                      </div>
                    </>
                  )}
                  {sub.is_released !== true && sub.status === 'graded' && (
                    <div className="text-center py-2 bg-blue-50 text-blue-600 text-[10px] font-bold rounded uppercase">
                      Graded • Awaiting Release
                    </div>
                  )}
                  {sub.status === 'recheck_requested' && (
                    <div className="text-center py-2 bg-orange-50 text-orange-600 text-[10px] font-bold rounded uppercase">
                      Recheck Requested
                    </div>
                  )}
                </div>
              ) : (
                <button 
                  disabled={!isActive || test.is_paused}
                  onClick={() => onEnterExam(test)}
                  className={cn(
                    "w-full font-bold py-3 rounded-lg transition shadow-lg",
                    isActive && !test.is_paused ? "bg-primary text-white hover:bg-primary/90" : "bg-gray-100 text-gray-400 cursor-not-allowed"
                  )}
                >
                  {test.is_paused ? 'Exam Paused' : isActive ? 'Enter Exam Room' : isUpcoming ? 'Starts Soon' : 'Exam Ended'}
                </button>
              )}
            </motion.div>
          );
        })}
        {tests.length === 0 && (
          <div className="col-span-full py-20 text-center bg-white rounded-2xl border-2 border-dashed border-gray-200">
            <BookOpen className="w-12 h-12 text-gray-200 mx-auto mb-4" />
            <p className="text-gray-400 font-medium">No exams assigned to you yet.</p>
          </div>
        )}
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTest, setActiveTest] = useState<Test | null>(null);
  const [previewRole, setPreviewRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ message: string, onConfirm: () => void } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('Unhandled Rejection:', event.reason);
      if (event.reason?.message === 'Failed to fetch') {
        showNotification("Network error: Failed to fetch. Please check your internet connection or API configuration.", 'error');
      }
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    initGoogleApi();

    // Test Supabase connection
    const testConnection = async () => {
      try {
        const { error } = await supabase.from('profiles').select('id').limit(1);
        if (error && error.message === 'Failed to fetch') {
          showNotification("Supabase connection failed: Failed to fetch. Please check your Supabase URL and Anon Key.", 'error');
        }
      } catch (err: any) {
        if (err.message === 'Failed to fetch') {
          showNotification("Supabase connection failed: Failed to fetch. Please check your Supabase URL and Anon Key.", 'error');
        }
      }
    };
    testConnection();
    
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setUser(session.user);
        fetchProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
        // 12-hour session auto-logout
        const loginTime = new Date().getTime();
        localStorage.setItem('login_time', loginTime.toString());
      } else {
        setProfile(null);
        localStorage.removeItem('login_time');
      }
    });

    // Check session duration every minute
    const sessionCheck = setInterval(() => {
      const loginTime = localStorage.getItem('login_time');
      if (loginTime) {
        const elapsed = new Date().getTime() - parseInt(loginTime);
        if (elapsed > 12 * 60 * 60 * 1000) {
          supabase.auth.signOut();
          alert("Session expired (12 hours). Please login again.");
        }
      }
    }, 60000);

    return () => {
      subscription.unsubscribe();
      clearInterval(sessionCheck);
    };
  }, []);

  const fetchProfile = async (id: string) => {
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', id).single();
      if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows returned"
        console.error("Error fetching profile:", error);
        if (error.message === 'Failed to fetch') {
          setError("Connection failed. Please check your Supabase configuration and network.");
        }
      }
      setProfile(data || null);
    } catch (err: any) {
      console.error("Unexpected error fetching profile:", err);
      if (err.message === 'Failed to fetch') {
        setError("Connection failed. Please check your Supabase configuration and network.");
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
    </div>
  );

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-red-100 text-center">
          <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2 text-gray-900">Configuration Missing</h2>
          <p className="text-gray-500 mb-6">
            Supabase environment variables are not set. Please add them to the <b>Secrets</b> panel in the AI Studio settings.
          </p>
          <div className="bg-gray-50 p-4 rounded-lg text-left text-xs font-mono space-y-2">
            <p>VITE_SUPABASE_URL</p>
            <p>VITE_SUPABASE_ANON_KEY</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) return <Login onLogin={(u) => setUser(u)} />;

  const effectiveRole = previewRole || profile?.role;

  // Profile Setup Mode (if logged in but no profile exists)
  if (!profile && !loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-gray-100 text-center">
          <User className="w-16 h-16 text-primary mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">Complete Your Profile</h2>
          <p className="text-gray-500 mb-6">We couldn't find a profile for your account. Please select your role to continue.</p>
          
          <div className="space-y-4">
            <button 
              onClick={async () => {
                console.log('Setting role to admin for user:', user.id);
                const { error } = await supabase.from('profiles').insert({
                  id: user.id,
                  email: user.email,
                  role: 'admin'
                });
                if (!error) {
                  console.log('Admin profile created successfully');
                  fetchProfile(user.id);
                } else {
                  console.error('Admin profile creation error:', error);
                  alert('Error creating profile: ' + error.message);
                }
              }}
              className="w-full bg-gray-900 text-white font-bold py-3 rounded-lg hover:bg-gray-800 transition"
            >
              I am an Admin
            </button>
            <button 
              onClick={async () => {
                console.log('Setting role to teacher for user:', user.id);
                const { error } = await supabase.from('profiles').insert({
                  id: user.id,
                  email: user.email,
                  role: 'teacher'
                });
                if (!error) {
                  console.log('Teacher profile created successfully');
                  fetchProfile(user.id);
                } else {
                  console.error('Teacher profile creation error:', error);
                  alert('Error creating profile: ' + error.message);
                }
              }}
              className="w-full border-2 border-primary text-primary font-bold py-3 rounded-lg hover:bg-primary/5 transition"
            >
              I am a Teacher
            </button>
            <button 
              onClick={async () => {
                console.log('Setting role to student for user:', user.id);
                const { error } = await supabase.from('profiles').insert({
                  id: user.id,
                  email: user.email,
                  role: 'student'
                });
                if (!error) {
                  console.log('Student profile created successfully');
                  fetchProfile(user.id);
                } else {
                  console.error('Student profile creation error:', error);
                  alert('Error creating profile: ' + error.message);
                }
              }}
              className="w-full bg-primary text-white font-bold py-3 rounded-lg hover:bg-primary/90 transition"
            >
              I am a Student
            </button>
            <button onClick={() => {
              console.log('Signing out from profile setup');
              supabase.auth.signOut();
            }} className="text-sm text-gray-400 hover:underline mt-4 block w-full">
              Sign out and try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col relative">
      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {effectiveRole === 'student' ? (
          activeTest ? (
            <StudentExam test={activeTest} user={user} onFinish={() => setActiveTest(null)} showNotification={showNotification} />
          ) : (
            <>
              {profile?.role === 'admin' && (
              <div className="fixed bottom-4 right-4 z-[100] flex gap-2">
                <button 
                  onClick={() => setPreviewRole(null)}
                  className={cn("px-3 py-1 rounded-full text-xs font-bold shadow-lg transition", !previewRole ? "bg-primary text-white" : "bg-white text-gray-600")}
                >
                  Admin View
                </button>
                <button 
                  onClick={() => setPreviewRole('teacher')}
                  className={cn("px-3 py-1 rounded-full text-xs font-bold shadow-lg transition", previewRole === 'teacher' ? "bg-primary text-white" : "bg-white text-gray-600")}
                >
                  Teacher View
                </button>
                <button 
                  onClick={() => setPreviewRole('student')}
                  className={cn("px-3 py-1 rounded-full text-xs font-bold shadow-lg transition", previewRole === 'student' ? "bg-primary text-white" : "bg-white text-gray-600")}
                >
                  Student View
                </button>
              </div>
            )}
            <StudentDashboard 
              user={user} 
              profile={profile!} 
              onEnterExam={(test) => setActiveTest(test)} 
              showNotification={showNotification}
            />
          </>
        )
      ) : (effectiveRole === 'teacher' || effectiveRole === 'admin') ? (
          <>
            {profile?.role === 'admin' && (
              <div className="fixed bottom-4 right-4 z-[100] flex gap-2">
                <button 
                  onClick={() => setPreviewRole(null)}
                  className={cn("px-3 py-1 rounded-full text-xs font-bold shadow-lg transition", !previewRole ? "bg-primary text-white" : "bg-white text-gray-600")}
                >
                  Admin View
                </button>
                <button 
                  onClick={() => setPreviewRole('teacher')}
                  className={cn("px-3 py-1 rounded-full text-xs font-bold shadow-lg transition", previewRole === 'teacher' ? "bg-primary text-white" : "bg-white text-gray-600")}
                >
                  Teacher View
                </button>
                <button 
                  onClick={() => setPreviewRole('student')}
                  className={cn("px-3 py-1 rounded-full text-xs font-bold shadow-lg transition", previewRole === 'student' ? "bg-primary text-white" : "bg-white text-gray-600")}
                >
                  Student View
                </button>
              </div>
            )}
            <TeacherDashboard user={user} profile={profile} showNotification={showNotification} setConfirmAction={setConfirmAction} />
          </>
        ) : (
          <div className="min-h-screen flex items-center justify-center">
            <div className="text-center">
              <AlertTriangle className="w-12 h-12 text-secondary mx-auto mb-4" />
              <h2 className="text-xl font-bold">Role not assigned</h2>
              <p className="text-gray-500">Please contact your administrator.</p>
              <button onClick={() => supabase.auth.signOut()} className="mt-4 text-primary font-bold">Logout</button>
            </div>
          </div>
        )}
      </div>

      {/* Custom Notification */}
      <AnimatePresence>
        {notification && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className={cn(
              "fixed bottom-8 right-8 z-[100] px-6 py-3 rounded-xl shadow-2xl font-bold text-sm flex items-center gap-3",
              notification.type === 'success' ? "bg-green-600 text-white" : "bg-red-600 text-white"
            )}
          >
            {notification.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            {notification.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom Confirm Modal */}
      <AnimatePresence>
        {confirmAction && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full"
            >
              <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center mb-6 mx-auto">
                <AlertTriangle className="w-8 h-8 text-orange-600" />
              </div>
              <h3 className="text-xl font-bold text-center mb-2">Confirm Action</h3>
              <p className="text-gray-500 text-center mb-8">{confirmAction.message}</p>
              <div className="flex gap-4">
                <button 
                  onClick={() => setConfirmAction(null)}
                  className="flex-1 py-3 rounded-xl font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 transition"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmAction.onConfirm}
                  className="flex-1 py-3 rounded-xl font-bold text-white bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition"
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
