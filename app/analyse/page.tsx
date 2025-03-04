'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, CameraIcon, Download, Upload } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { VideoUploadButton } from '@/components/ui/upload-button';
import Image from 'next/image';
import golfSwingImage from '../public/face-on-golf-swing-soloute.png';

export default function VideoCapturePage() {
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>(
    'environment'
  );
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [countdownTime, setCountdownTime] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimerRef = useRef<NodeJS.Timeout>();
  const countdownTimerRef = useRef<NodeJS.Timeout>();
  const startTimeRef = useRef<number>(0);

  const { toast } = useToast();

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
    };
  }, [cameraFacing]);

  const startCamera = async () => {
    try {
      // Stop any existing stream first
      stopCamera();

      // More balanced constraints for better performance
      const constraints = {
        video: {
          facingMode: cameraFacing,
          width: { ideal: 1280 }, // Reduced from 1920
          height: { ideal: 720 }, // Reduced from 1080
          frameRate: { ideal: 30 }, // Explicitly set frame rate
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

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
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

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
      formData.append('video', recordedVideoBlob, 'captured-video.mp4');

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

  const startCountdown = () => {
    setRecordedVideoBlob(null);
    setCountdownTime(10); // Start with 10 seconds

    // Clear any existing timers
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
    }

    // Set up the countdown timer
    countdownTimerRef.current = setInterval(() => {
      setCountdownTime((prev) => {
        if (prev === null || prev <= 1) {
          // When countdown reaches 0, start recording
          clearInterval(countdownTimerRef.current!);
          setTimeout(() => {
            startRecording();
          }, 500);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const startRecording = () => {
    setRecordingDuration(0);
    chunksRef.current = [];
    startTimeRef.current = Date.now();

    if (!streamRef.current) return;

    try {
      // Try to use better codec options when available
      const mimeType = getSupportedMimeType();

      // Set higher bitrate for better quality
      const options: MediaRecorderOptions = {
        mimeType,
        videoBitsPerSecond: 5000000, // Try higher bitrate (5 Mbps)
        audioBitsPerSecond: 128000, // 128 kbps for audio
      };

      const mediaRecorder = new MediaRecorder(streamRef.current, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        // Create a new blob with the correct MIME type
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setRecordedVideoBlob(blob);
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
        }
      };

      // Request data more frequently for smoother recording
      mediaRecorder.start(500);
      setIsRecording(true);

      // Update timer based on elapsed time since recording started
      recordingTimerRef.current = setInterval(() => {
        const elapsedSeconds = Math.floor(
          (Date.now() - startTimeRef.current) / 1000
        );
        setRecordingDuration(elapsedSeconds);
      }, 500);
    } catch (err) {
      console.error('Error starting recording:', err);
      toast({
        title: 'Error',
        description: 'Failed to start recording. Please try again.',
        variant: 'destructive',
      });
    }
  };

  // Helper function to find the best supported video format
  const getSupportedMimeType = (): string => {
    const types = [
      'video/webm;codecs=h264',
      'video/webm;codecs=vp9',
      'video/mp4;codecs=h264',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log('Using MIME type:', type);
        return type;
      }
    }

    // Fallback to basic webm
    return 'video/webm';
  };

  const cancelCountdown = () => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      setCountdownTime(null);
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
    const extension = recordedVideoBlob.type.includes('mp4') ? 'mp4' : 'webm';
    a.download = `captured-video-${new Date().toISOString()}.${extension}`;
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
    <div className="h-[calc(100vh-4rem)] w-full flex flex-col bg-black text-white">
      <div className="relative flex-grow">
        <Image
          src={golfSwingImage}
          alt="Golf Swing"
          layout="fill"
          objectFit="cover"
        />
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

        {/* Countdown Timer Display */}
        {countdownTime !== null && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="text-8xl font-bold text-white bg-black/50 rounded-full h-40 w-40 flex items-center justify-center">
                {countdownTime}
              </div>
              <Button
                onClick={cancelCountdown}
                className="mt-4 bg-red-500 hover:bg-red-600"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {isRecording && (
          <div className="absolute top-4 right-4 bg-red-500 px-3 py-1 rounded-full flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span>{formatDuration(recordingDuration)}</span>
          </div>
        )}
      </div>
      <div className="relative p-4 mb-16 flex justify-center items-center gap-4">
        <Button
          className="rounded-full p-3 bg-transparent border-2 border-white hover:bg-white/20 transition-colors"
          onClick={toggleCamera}
          disabled={isRecording || countdownTime !== null}
          title="Switch Camera"
        >
          <CameraIcon className="h-6 w-6" />
        </Button>

        {countdownTime === null && !isRecording ? (
          <Button
            className="rounded-full p-4 bg-white hover:bg-gray-200 transition-colors"
            onClick={startCountdown}
            disabled={!!error}
            title="Start Countdown"
          >
            <div className="h-8 w-8 bg-red-500 rounded-full" />
          </Button>
        ) : isRecording ? (
          <Button
            className="rounded-full p-4 bg-red-500 hover:bg-red-600 transition-colors"
            onClick={stopRecording}
            title="Stop Recording"
          >
            <div className="h-6 w-6 bg-white rounded-sm" />
          </Button>
        ) : null}

        {recordedVideoBlob && (
          <>
            <VideoUploadButton
              videoBlob={recordedVideoBlob}
              cameraFacing={cameraFacing}
            />

            <Button
              className="rounded-full p-3 bg-transparent border-2 border-white hover:bg-white/20 transition-colors"
              onClick={downloadVideo}
              disabled={countdownTime !== null}
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
