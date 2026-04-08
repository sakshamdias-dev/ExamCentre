import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  Upload, 
  Camera, 
  Plus, 
  Trash2, 
  Crop, 
  Check, 
  Loader2, 
  FileText,
  AlertCircle
} from 'lucide-react';
import Cropper from 'react-easy-crop';
import { Area } from 'react-easy-crop';
import { jsPDF } from 'jspdf';
import { getCroppedImg } from '../lib/cropImage';
import { uploadToDrive, authorize, isAuthorized } from '../lib/googleDrive';
import { supabase, Test } from '../lib/supabase';

interface SubmissionModalProps {
  test: Test;
  user: any;
  initialImages?: string[];
  onClose: () => void;
  onSuccess: () => void;
}

interface ImageItem {
  id: string;
  src: string;
  originalSrc: string;
}

export const SubmissionModal: React.FC<SubmissionModalProps> = ({ test, user, initialImages = [], onClose, onSuccess }) => {
  const [images, setImages] = useState<ImageItem[]>(() => 
    initialImages.map(src => ({
      id: Math.random().toString(36).substr(2, 9),
      src,
      originalSrc: src
    }))
  );
  const [isUploading, setIsUploading] = useState(false);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [isAuthorizedState, setIsAuthorizedState] = useState(isAuthorized());

  useEffect(() => {
    const interval = setInterval(() => {
      const authorized = isAuthorized();
      if (authorized !== isAuthorizedState) {
        setIsAuthorizedState(authorized);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isAuthorizedState]);

  const [error, setError] = useState<string | null>(null);
  
  // Cropping state
  const [croppingIndex, setCroppingIndex] = useState<number | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const onCropComplete = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleAuthorize = async () => {
    setIsAuthorizing(true);
    setError(null);
    try {
      await authorize();
      setIsAuthorizedState(true);
    } catch (err: any) {
      console.error("Authorization error:", err);
      setError("Failed to authorize Google Drive. Please allow popups and try again.");
    } finally {
      setIsAuthorizing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    (Array.from(files) as File[]).forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const src = event.target?.result as string;
        const newImage: ImageItem = {
          id: Math.random().toString(36).substr(2, 9),
          src,
          originalSrc: src
        };
        
        setImages(prev => {
          const updated = [...prev, newImage];
          // Prompt to crop for the newly added image
          if (window.confirm("Do you want to crop this image?")) {
            setCroppingIndex(updated.length - 1);
          }
          return updated;
        });
      };
      reader.readAsDataURL(file);
    });
    
    // Reset input
    e.target.value = '';
  };

  const removeImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
  };

  const startCrop = (index: number) => {
    setCroppingIndex(index);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  };

  const applyCrop = async () => {
    if (croppingIndex === null || !croppedAreaPixels) return;

    try {
      const croppedImage = await getCroppedImg(
        images[croppingIndex].originalSrc,
        croppedAreaPixels
      );
      
      const newImages = [...images];
      newImages[croppingIndex].src = croppedImage;
      setImages(newImages);
      setCroppingIndex(null);
    } catch (e) {
      console.error(e);
      setError("Failed to crop image");
    }
  };

  const handleSubmit = async () => {
    if (images.length === 0) {
      setError("Please add at least one image");
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      if (!isAuthorized()) {
        throw new Error("Google Drive not authorized. Please click 'Connect Google Drive' first.");
      }

      // 1. Upload individual images to Google Drive
      const pageIds: string[] = [];
      for (let i = 0; i < images.length; i++) {
        const response = await fetch(images[i].src);
        const blob = await response.blob();
        const fileName = `Page_${i + 1}_${test.title}_${user.email}_${Date.now()}.jpg`;
        const fileId = await uploadToDrive(blob, fileName, 'developer@examfriendly.in', 'image/jpeg');
        pageIds.push(fileId);
      }

      // 2. Save to Supabase
      const { error: supabaseError } = await supabase.from('submissions').insert({
        test_id: test.id,
        student_id: user.id,
        page_ids: pageIds,
        status: 'submitted',
        submitted_at: new Date().toISOString()
      });

      if (supabaseError) throw supabaseError;

      // 3. Update live session if needed
      await supabase.from('live_sessions').update({ is_active: false }).eq('user_id', user.id);

      onSuccess();
    } catch (err: any) {
      console.error("Submission error:", err);
      setError(err.message || "Failed to submit. Please check your internet and Google account permissions.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[300] flex items-center justify-center p-4 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <header className="p-6 border-b flex justify-between items-center bg-gray-50">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Submit Answer Sheets</h2>
            <p className="text-sm text-gray-500">{test.title}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition">
            <X className="w-6 h-6 text-gray-500" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-red-600 text-sm">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
            {images.map((img, index) => (
              <div key={img.id} className="group relative aspect-[3/4] bg-gray-100 rounded-xl overflow-hidden border-2 border-gray-200 hover:border-primary transition shadow-sm">
                <img src={img.src} className="w-full h-full object-cover" alt={`Page ${index + 1}`} />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2">
                  <button 
                    onClick={() => startCrop(index)}
                    className="p-2 bg-white text-gray-900 rounded-lg hover:bg-primary hover:text-white transition shadow-lg"
                    title="Crop Image"
                  >
                    <Crop className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => removeImage(img.id)}
                    className="p-2 bg-white text-red-600 rounded-lg hover:bg-red-600 hover:text-white transition shadow-lg"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="absolute bottom-2 left-2 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">
                  Page {index + 1}
                </div>
              </div>
            ))}
            
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="aspect-[3/4] border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center gap-2 hover:border-primary hover:bg-primary/5 transition text-gray-400 hover:text-primary group"
            >
              <div className="w-12 h-12 rounded-full bg-gray-50 group-hover:bg-primary/10 flex items-center justify-center transition">
                <Plus className="w-6 h-6" />
              </div>
              <span className="text-xs font-bold">Add Image</span>
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 py-4 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-700 hover:bg-gray-100 transition"
            >
              <Upload className="w-5 h-5" />
              Upload Files
            </button>
            <button 
              onClick={() => cameraInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 py-4 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-700 hover:bg-gray-100 transition"
            >
              <Camera className="w-5 h-5" />
              Take Photo
            </button>
          </div>

          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept="image/*" 
            multiple 
            onChange={handleFileChange} 
          />
          <input 
            type="file" 
            ref={cameraInputRef} 
            className="hidden" 
            accept="image/*" 
            capture="environment" 
            onChange={handleFileChange} 
          />
        </div>

        <footer className="p-6 border-t bg-gray-50 flex gap-4">
          <button 
            onClick={onClose}
            className="flex-1 py-4 font-bold text-gray-500 hover:text-gray-700 transition"
            disabled={isUploading || isAuthorizing}
          >
            Cancel
          </button>
          {!isAuthorizedState ? (
            <button 
              onClick={handleAuthorize}
              disabled={isAuthorizing}
              className="flex-[2] py-4 bg-blue-600 text-white rounded-xl font-bold shadow-lg hover:bg-blue-700 transition flex items-center justify-center gap-2"
            >
              {isAuthorizing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Authorizing...
                </>
              ) : (
                <>
                  <Check className="w-5 h-5" />
                  Connect Google Drive
                </>
              )}
            </button>
          ) : (
            <button 
              onClick={handleSubmit}
              disabled={isUploading || images.length === 0}
              className="flex-[2] py-4 bg-primary text-white rounded-xl font-bold shadow-lg shadow-primary/20 hover:bg-primary/90 disabled:opacity-50 disabled:shadow-none transition flex items-center justify-center gap-2"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Check className="w-5 h-5" />
                  Submit Exam
                </>
              )}
            </button>
          )}
        </footer>

        {/* Cropping Overlay */}
        <AnimatePresence>
          {croppingIndex !== null && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black z-[400] flex flex-col"
            >
              <div className="flex-1 relative">
                <Cropper
                  image={images[croppingIndex].originalSrc}
                  crop={crop}
                  zoom={zoom}
                  aspect={3 / 4}
                  onCropChange={setCrop}
                  onCropComplete={onCropComplete}
                  onZoomChange={setZoom}
                />
              </div>
              <div className="p-6 bg-gray-900 flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <span className="text-white text-sm font-bold">Zoom</span>
                  <input
                    type="range"
                    value={zoom}
                    min={1}
                    max={3}
                    step={0.1}
                    aria-labelledby="Zoom"
                    onChange={(e) => setZoom(Number(e.target.value))}
                    className="flex-1 accent-primary"
                  />
                </div>
                <div className="flex gap-4">
                  <button 
                    onClick={() => setCroppingIndex(null)}
                    className="flex-1 py-4 bg-gray-800 text-white rounded-xl font-bold hover:bg-gray-700 transition"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={applyCrop}
                    className="flex-1 py-4 bg-primary text-white rounded-xl font-bold hover:bg-primary/90 transition"
                  >
                    Apply Crop
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};
