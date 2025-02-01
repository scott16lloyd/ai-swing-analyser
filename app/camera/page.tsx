'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, CameraIcon, Download, Upload } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function VideoCapturePage() {
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>(
    'environment'
  );
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const [uploading, setUploading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimerRef = useRef<NodeJS.Timeout>();

  const { toast } = useToast();

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, [cameraFacing]);

  const startCamera = async () => {
    try {
      const constraints = {
        video: {
          facingMode: cameraFacing,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: true, // Enable audio recording
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setError(null);
    } catch (err) {
      console.error('Error accessing the camera:', err);
      setError(
        `No ${cameraFacing === 'user' ? 'front' : 'back'} camera available. Please check your device settings or try switching cameras.`
      );
      stopCamera();
    }
  };

  const stopCamera = () => {
    const stream = videoRef.current?.srcObject as MediaStream;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const toggleCamera = () => {
    setCameraFacing((prev) => (prev === 'user' ? 'environment' : 'user'));
  };

  const uploadVideo = async () => {
    if (!recordedVideoBlob) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('video', recordedVideoBlob, 'captured-video.webm');

      const response = await fetch('/api/upload-video', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Upload failed');

      toast({
        title: 'Success',
        description: 'Video uploaded successfully!',
        variant: 'default',
      });
    } catch (error) {
      console.error('Error uploading video:', error);
      toast({
        title: 'Error',
        description: 'Failed to upload video. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  const startRecording = () => {
    setRecordedVideoBlob(null);
    setRecordingDuration(0);

    const stream = videoRef.current?.srcObject as MediaStream;
    if (!stream) return;

    try {
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp8,opus',
      });

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        setRecordedVideoBlob(blob);
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
        }
      };

      mediaRecorder.start(1000); // Capture data every second
      setIsRecording(true);

      // Start recording duration timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Error starting recording:', err);
      toast({
        title: 'Error',
        description: 'Failed to start recording. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const stopRecording = () => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const downloadVideo = () => {
    if (!recordedVideoBlob) return;

    const url = URL.createObjectURL(recordedVideoBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `captured-video-${new Date().toISOString()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-[calc(100vh-2.5rem)] w-full flex flex-col bg-black text-white">
      <div className="relative flex-grow">
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
            <div className="text-center p-4">
              <AlertCircle className="mx-auto h-12 w-12 text-red-500 mb-4" />
              <p className="text-lg font-semibold mb-2">Camera Error</p>
              <p>{error}</p>
            </div>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover rounded-xl aspect-w-16 aspect-h-9"
            style={{
              transform: cameraFacing === 'user' ? 'scaleX(-1)' : 'none',
            }}
          />
        )}
        {isRecording && (
          <div className="absolute top-4 right-4 bg-red-500 px-3 py-1 rounded-full flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span>{formatDuration(recordingDuration)}</span>
          </div>
        )}
      </div>
      <div className="absolute bottom-0 left-0 right-0 p-4 pb-[calc(1rem+1.25rem)] flex justify-center items-center gap-4">
        <Button
          className="rounded-full p-3 bg-transparent border-2 border-white hover:bg-white/20 transition-colors"
          onClick={toggleCamera}
          disabled={isRecording}
          title="Switch Camera"
        >
          <CameraIcon className="h-6 w-6" />
        </Button>

        <Button
          className={`rounded-full p-4 ${
            isRecording
              ? 'bg-red-500 hover:bg-red-600'
              : 'bg-white hover:bg-gray-200'
          } transition-colors`}
          onClick={isRecording ? stopRecording : startRecording}
          disabled={!!error}
          title={isRecording ? 'Stop Recording' : 'Start Recording'}
        >
          <div
            className={`${
              isRecording
                ? 'h-6 w-6 bg-white rounded-sm'
                : 'h-8 w-8 bg-red-500 rounded-full'
            }`}
          />
        </Button>

        {recordedVideoBlob && (
          <>
            <Button
              className="rounded-full p-3 bg-transparent border-2 border-white hover:bg-white/20 transition-colors"
              onClick={uploadVideo}
              disabled={uploading}
              title="Upload Video"
            >
              <Upload className="h-6 w-6" />
              {uploading && <span className="ml-2">Uploading...</span>}
            </Button>

            <Button
              className="rounded-full p-3 bg-transparent border-2 border-white hover:bg-white/20 transition-colors"
              onClick={downloadVideo}
              title="Download Video"
            >
              <Download className="h-6 w-6" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
