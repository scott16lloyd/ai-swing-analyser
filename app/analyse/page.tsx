'use client';
import VideoPlayer from '@/components/ui/videoPlayer';
import {
  getBestVideoFormat,
  formatDuration,
  getVideoDuration,
} from '@/lib/videoUtils';
import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, CameraIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ProcessVideoResponse } from '@/components/ui/upload-button';
import Image from 'next/image';
import golfSwingImage from '../public/face-on-golf-swing-soloute.png';
import { useRouter } from 'next/navigation';
import { EnhancedVideoUploadButton } from '@/components/ui/enhanced-video-upload-button';

export default function VideoCapturePage() {
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>(
    'environment'
  );
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [countdownTime, setCountdownTime] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout>();
  const countdownTimerRef = useRef<NodeJS.Timeout>();
  const startTimeRef = useRef<number>(0);
  const autoStopTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { toast } = useToast();
  const router = useRouter();

  const handleProcessingComplete = (result: ProcessVideoResponse) => {
    if (result.success) {
      // Extract the filename from the full path
      const fileName = result.fileName.split('/').pop();

      if (!fileName) {
        console.error('Could not extract filename from path:', result.fileName);
        toast({
          title: 'Error',
          description: 'Could not process video path',
          variant: 'destructive',
        });
        return;
      }

      // Show a toast notification
      toast({
        title: 'Video Uploaded',
        description:
          'Your swing is being analysed. You will be redirected shortly...',
        variant: 'default',
      });

      // Navigate to analysis page
      router.push(
        `/analysis-results?fileName=${fileName}&bucketName=${result.bucketName}`
      );
    }
  };

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

  const startCamera = async (): Promise<void> => {
    try {
      // Stop any existing stream first
      stopCamera();

      console.log('Starting camera...');

      // Balanced constraints for better performance
      const constraints = {
        video: {
          facingMode: cameraFacing,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false, // No need for audio anymore
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      setError(null);
    } catch (err) {
      console.error('Error accessing camera:', err);
      setError(
        `Could not access ${cameraFacing === 'user' ? 'front' : 'back'} camera.`
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

  const startCountdown = () => {
    setRecordedVideoBlob(null);
    setCountdownTime(5);

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

  /**
   * Start recording video with improved format detection and error handling
   */
  const startRecording = (): void => {
    setRecordingDuration(0);
    chunksRef.current = [];
    startTimeRef.current = Date.now();

    if (!streamRef.current) {
      console.error('No stream available for recording');
      toast({
        title: 'Error',
        description:
          'No camera stream available. Please allow camera access and try again.',
        variant: 'destructive',
      });
      return;
    }

    try {
      // Get the best supported format
      const { mimeType, extension } = getBestVideoFormat();
      console.log(
        `Starting recording with format: ${mimeType || 'browser default'} (${extension})`
      );

      // Set appropriate options for better quality and compatibility
      const options: MediaRecorderOptions = {};

      // Only set mimeType if one was found and supported
      if (mimeType) {
        options.mimeType = mimeType;
      }

      try {
        // For video-only recording, we need to create a new stream with just video tracks
        const videoStream = new MediaStream(streamRef.current.getVideoTracks());
        const mediaRecorder = new MediaRecorder(videoStream, options);
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event: BlobEvent): void => {
          if (event.data.size > 0) {
            chunksRef.current.push(event.data);
          }
        };

        // When recording stops, create the final video blob
        mediaRecorder.onstop = async (): Promise<void> => {
          if (chunksRef.current.length === 0) {
            console.error('No data collected during recording');
            toast({
              title: 'Error',
              description: 'No video data was recorded. Please try again.',
              variant: 'destructive',
            });
            return;
          }

          // Determine the type to use for the blob
          const blobType: string = mimeType || 'video/webm';

          try {
            const recordedBlob: Blob = new Blob(chunksRef.current, {
              type: blobType,
            });

            // Get the actual duration of the recorded video
            try {
              const duration = await getVideoDuration(recordedBlob);
              setVideoDuration(duration);
              console.log(`Video duration calculated: ${duration}s`);
            } catch (durationError) {
              console.error('Error getting video duration:', durationError);
              // Fall back to the tracked recording duration
              setVideoDuration(recordingDuration);
            }

            setRecordedVideoBlob(recordedBlob);
            console.log(
              `Recording completed: ${recordedBlob.size} bytes, type: ${blobType}`
            );
          } catch (error) {
            console.error('Error creating video blob:', error);
            toast({
              title: 'Error',
              description: 'Failed to process recorded video.',
              variant: 'destructive',
            });
          }

          // Clear recording timer
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
          }
        };

        // Request data more frequently for smoother recording
        mediaRecorder.start(500);
        setIsRecording(true);

        // Update the timer based on elapsed time
        recordingTimerRef.current = setInterval(() => {
          const elapsedSeconds: number =
            (Date.now() - startTimeRef.current) / 1000;
          setRecordingDuration(elapsedSeconds);
        }, 200);

        // Set a maximum recording time (30 seconds) to prevent very large files
        const maxRecordingTimeout: NodeJS.Timeout = setTimeout(() => {
          if (
            mediaRecorderRef.current &&
            mediaRecorderRef.current.state !== 'inactive'
          ) {
            console.log(
              'Maximum recording time reached (30s), stopping recorder'
            );
            stopRecording();
          }
        }, 30000); // 30 seconds max

        // Store the timeout so we can clear it if recording is stopped manually
        autoStopTimeoutRef.current = maxRecordingTimeout;
      } catch (err) {
        console.error('Error creating MediaRecorder:', err);
        toast({
          title: 'Recording Error',
          description:
            'Your browser does not support video recording with the available formats. Please try using Chrome or Firefox.',
          variant: 'destructive',
        });
      }
    } catch (err) {
      console.error('Error starting recording:', err);
      toast({
        title: 'Error',
        description:
          'Failed to start recording. Please check your browser permissions and try again.',
        variant: 'destructive',
      });
    }
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

      // Clear any auto-stop timeout
      if (autoStopTimeoutRef.current) {
        clearTimeout(autoStopTimeoutRef.current);
        autoStopTimeoutRef.current = null;
      }
    }
  };

  const downloadVideo = () => {
    if (!recordedVideoBlob) return;

    const url = URL.createObjectURL(recordedVideoBlob);
    const a = document.createElement('a');
    a.href = url;
    const extension = recordedVideoBlob.type.includes('mp4') ? 'mp4' : 'webm';
    a.download = `golf-swing-${new Date().toISOString()}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
  };

  // Simplified version without impact time handling
  const prepareVideoForPlayback = (blob: Blob) => {
    if (!blob) {
      console.error('No video blob provided for playback');
      return;
    }

    console.log(
      `Preparing video for playback, blob size: ${blob.size} bytes, type: ${blob.type}`
    );

    if (!previewVideoRef.current) {
      console.log(
        'No direct preview video ref available, relying on VideoPlayer component'
      );
      return;
    }

    const videoElement = previewVideoRef.current;

    // Clean up any existing blob URLs
    if (videoElement.src && videoElement.src.startsWith('blob:')) {
      URL.revokeObjectURL(videoElement.src);
    }

    // Create a new blob URL
    const url = URL.createObjectURL(blob);
    console.log('Created new blob URL for playback:', url);

    // Set the video source
    videoElement.src = url;

    // Set up event handlers
    videoElement.onloadedmetadata = () => {
      console.log(`Video metadata loaded. Duration: ${videoElement.duration}s`);
      // Reset the playback position to the start
      videoElement.currentTime = 0;
    };

    videoElement.oncanplay = () => {
      console.log('Video can play, starting playback');
      videoElement
        .play()
        .then(() => console.log('Playback started successfully'))
        .catch((err) => console.error('Error starting playback:', err));
    };

    videoElement.onerror = (event) => {
      console.error('Error loading video:', event);
    };

    // Force a reload to apply the new source
    videoElement.load();
  };

  return (
    <div className="h-[calc(100vh-4rem)] max-w-screen flex flex-col bg-black text-white">
      <div className="relative flex-grow">
        {!recordedVideoBlob && (
          <Image
            src={golfSwingImage}
            alt="Golf Swing"
            layout="fill"
            objectFit="cover"
            style={{ opacity: 0.2 }}
          />
        )}

        {error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
            <div className="text-center p-4">
              <AlertCircle className="mx-auto h-12 w-12 text-red-500 mb-4" />
              <p className="text-lg font-semibold mb-2">Camera Error</p>
              <p>{error}</p>
            </div>
          </div>
        ) : isProcessing ? (
          // Show processing indicator
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="text-center w-screen">
              <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <h2 className="text-xl font-semibold mb-2">Processing Video</h2>
              <p className="text-gray-400">Optimizing video...</p>
            </div>
          </div>
        ) : recordedVideoBlob ? (
          <div className="relative h-full w-full overscroll-none">
            <VideoPlayer
              videoBlob={recordedVideoBlob}
              impactTimeLabel={null}
              endTime={
                videoDuration ? formatDuration(videoDuration) : undefined
              }
            />
          </div>
        ) : (
          // Show camera feed
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
          <div className="absolute top-4 right-4 flex flex-col gap-2 items-end">
            <div className="bg-red-500 px-3 py-1 rounded-full flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <span>{formatDuration(recordingDuration)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="relative p-4 mb-16 flex justify-center items-center gap-4">
        {!isProcessing && (
          <>
            {!recordedVideoBlob ? (
              <Button
                className="rounded-full p-3 bg-transparent border-2 border-white hover:bg-white/20 transition-colors"
                onClick={toggleCamera}
                disabled={
                  isRecording || countdownTime !== null || !!recordedVideoBlob
                }
                title="Switch Camera"
              >
                <CameraIcon className="h-6 w-6" />
              </Button>
            ) : null}

            {countdownTime === null && !isRecording ? (
              recordedVideoBlob ? (
                // If we have a recorded video, show controls for it
                <>
                  <EnhancedVideoUploadButton
                    videoBlob={recordedVideoBlob}
                    cameraFacing={cameraFacing}
                    onProcessingComplete={handleProcessingComplete}
                    uploadOptions={{
                      destinationPath: 'unprocessed_video/user',
                      quality: 'high',
                    }}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md"
                  />
                  <Button
                    className="px-4 py-2 bg-blue-500 text-white rounded-md disabled:opacity-50 gap-1 text-md"
                    onClick={startCountdown}
                    title="Record New Video"
                  >
                    Retake
                    <CameraIcon className="h-6 w-6" />
                  </Button>
                </>
              ) : (
                // Start recording button
                <Button
                  className="rounded-full p-4 bg-white hover:bg-gray-200 transition-colors"
                  onClick={startCountdown}
                  disabled={!!error}
                  title="Start Countdown"
                >
                  <div className="h-8 w-8 bg-red-500 rounded-full" />
                </Button>
              )
            ) : isRecording ? (
              // Stop recording button
              <Button
                className="rounded-full p-4 bg-red-500 hover:bg-red-600 transition-colors"
                onClick={stopRecording}
                title="Stop Recording"
              >
                <div className="h-6 w-6 bg-white rounded-sm" />
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
