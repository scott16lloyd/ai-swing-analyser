'use client';
import VideoPlayer from '@/components/ui/videoPlayer';
import {
  trimVideoByTimeRange,
  getSupportedMimeType,
  formatDuration,
  getVideoDuration,
  getBestVideoFormat,
} from '@/lib/videoUtils';
import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertCircle,
  CameraIcon,
  Download,
  Upload,
  Scissors,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ProcessVideoResponse } from '@/components/ui/upload-button';
import Image from 'next/image';
import golfSwingImage from '../public/face-on-golf-swing-soloute.png';
import { useRouter } from 'next/navigation';
import { EnhancedVideoUploadButton } from '@/components/ui/enhanced-video-upload-button';

declare global {
  interface Window {
    lastImpactTime?: string;
  }
}

export default function VideoCapturePage() {
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>(
    'environment'
  );
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const [trimmedVideoBlob, setTrimmedVideoBlob] = useState<Blob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [countdownTime, setCountdownTime] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimerRef = useRef<NodeJS.Timeout>();
  const countdownTimerRef = useRef<NodeJS.Timeout>();
  const startTimeRef = useRef<number>(0);
  const [impactTimeLabel, setImpactTimeLabel] = useState<string | null>(null);
  const [isListeningForImpact, setIsListeningForImpact] =
    useState<boolean>(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const autoStopTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastImpactTimeRef = useRef<string | null>(null);
  let globalImpactTime: string | null = null;
  const currentDurationRef = useRef<number>(0);

  const { toast } = useToast();
  const router = useRouter();

  const handleProcessingComplete = (result: ProcessVideoResponse) => {
    if (result.success) {
      // Extract the filename from the full path - adjust this based on your naming convention
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
      stopImpactDetection();
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
    };
  }, [cameraFacing]);

  useEffect(() => {
    globalImpactTime = null;
    return () => {
      globalImpactTime = null;
    };
  }, []);

  const startCamera = async (): Promise<void> => {
    try {
      // Stop any existing stream first
      stopCamera();

      console.log('Starting camera with audio...');

      // More balanced constraints for better performance
      const constraints = {
        video: {
          facingMode: cameraFacing,
          width: { ideal: 1280 }, // Reduced from 1920
          height: { ideal: 720 }, // Reduced from 1080
          frameRate: { ideal: 30 }, // Explicitly set frame rate
        },
        audio: true,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // Check if we actually got audio tracks
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        console.log(`Audio track available: ${audioTracks[0].label}`);
      } else {
        console.warn('No audio track found in stream');
        toast({
          title: 'Warning',
          description: "No microphone detected. Sound detection won't work.",
          variant: 'destructive',
        });
      }

      setError(null);
    } catch (err) {
      console.error('Error accessing camera or microphone:', err);
      setError(
        `Could not access ${cameraFacing === 'user' ? 'front' : 'back'} camera or microphone.`
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
    const videoToUpload = trimmedVideoBlob || recordedVideoBlob;
    if (!videoToUpload) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('video', videoToUpload, 'captured-video.mp4');

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
    setTrimmedVideoBlob(null);
    setImpactTimeLabel(null);
    setCountdownTime(5); // Reduced to 5 for testing

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
    currentDurationRef.current = 0;

    // Clear any existing impact time
    setImpactTimeLabel(null);
    window.lastImpactTime = undefined;
    lastImpactTimeRef.current = null;
    globalImpactTime = null;

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
        const mediaRecorder = new MediaRecorder(streamRef.current, options);
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event: BlobEvent): void => {
          if (event.data.size > 0) {
            chunksRef.current.push(event.data);
          }
        };

        // When recording stops, create the final video blob
        mediaRecorder.onstop = (): void => {
          if (chunksRef.current.length === 0) {
            console.error('No data collected during recording');
            toast({
              title: 'Error',
              description: 'No video data was recorded. Please try again.',
              variant: 'destructive',
            });
            return;
          }

          // Determine the type to use for the blob (use the same format we recorded with)
          const blobType: string = mimeType || 'video/webm';

          try {
            const recordedBlob: Blob = new Blob(chunksRef.current, {
              type: blobType,
            });
            setRecordedVideoBlob(recordedBlob);
            console.log(
              `Recording completed: ${recordedBlob.size} bytes, type: ${blobType}`
            );

            // Use impact time for potential trimming later
            if (lastImpactTimeRef.current) {
              console.log(
                `Recording stopped with impact at ${lastImpactTimeRef.current}`
              );
              // Optionally trigger automatic trimming here
            }
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

        // Update the timer and duration reference based on elapsed time
        recordingTimerRef.current = setInterval(() => {
          const elapsedSeconds: number =
            (Date.now() - startTimeRef.current) / 1000;
          setRecordingDuration(elapsedSeconds);
          currentDurationRef.current = elapsedSeconds;
        }, 200);

        // Start listening for impact
        setTimeout(() => {
          if (isRecording) {
            console.log('Starting impact detection');
            startImpactDetectionSimple(); // Use our simplified version
          }
        }, 100);

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

  /**
   * Helper function to store impact time in multiple places for redundancy
   */
  const storeImpactTime = (impactTimeSeconds: number): void => {
    // Format the impact time
    const formattedTime: string = formatDuration(impactTimeSeconds);

    // Store impact time in multiple places for redundancy
    // 1. React state (might be delayed due to state updates)
    setImpactTimeLabel(formattedTime);

    // 2. Global variable (immediate access)
    globalImpactTime = formattedTime;

    // 3. Window object (accessible across components)
    window.lastImpactTime = formattedTime;

    // 4. Ref (persists between renders)
    lastImpactTimeRef.current = formattedTime;

    // 5. Also update current duration reference
    currentDurationRef.current = impactTimeSeconds;

    console.log(`Impact detected at ${formattedTime} (${impactTimeSeconds}s)`);
  };

  /**
   * A simpler sound detection implementation for golf swing impact
   */
  const startImpactDetectionSimple = (): void => {
    console.log('Starting simplified impact detection');

    if (!streamRef.current) {
      console.error('No stream available for impact detection');
      return;
    }

    try {
      console.log('🎤 Starting sound detection...');

      // Create a simple audio context
      const AudioContextClass: typeof AudioContext =
        window.AudioContext ||
        ((window as any).webkitAudioContext as typeof AudioContext);

      if (!AudioContextClass) {
        console.error('AudioContext not supported');
        return;
      }

      const audioContext: AudioContext = new AudioContextClass();
      audioContextRef.current = audioContext;

      // Get audio tracks from stream
      const audioTracks: MediaStreamTrack[] =
        streamRef.current.getAudioTracks();

      if (audioTracks.length === 0) {
        console.error('No audio tracks in stream');
        toast({
          title: 'Warning',
          description: "No microphone detected. Sound detection won't work.",
          variant: 'destructive',
        });
        return;
      }

      // Create audio source
      const source: MediaStreamAudioSourceNode =
        audioContext.createMediaStreamSource(streamRef.current);

      // Create analyzer node
      const analyzer: AnalyserNode = audioContext.createAnalyser();
      analyzer.fftSize = 2048;
      source.connect(analyzer);

      // Create data array for analysis
      const dataArray: Uint8Array = new Uint8Array(analyzer.frequencyBinCount);

      // Variables for sound detection
      const CALIBRATION_FRAMES: number = 20;
      const BASELINE_FRAMES: number = 20; // Added missing constant
      let baselineVolume: number = 0;
      let calibrationFrames: number = 0;
      let threshold: number = 0.05;
      let isPeaking: boolean = false;
      let peakTime: number = 0;

      // Function to check volume
      const checkVolume = (): void => {
        if (
          !mediaRecorderRef.current ||
          mediaRecorderRef.current.state === 'inactive'
        ) {
          // Clean up when not recording
          try {
            source.disconnect();
            analyzer.disconnect();
            audioContext.close();
          } catch (e) {
            console.error('Error cleaning up audio context:', e);
          }
          return;
        }

        // Get frequency data
        analyzer.getByteFrequencyData(dataArray);

        // Calculate average volume
        let sum: number = 0;
        for (let i: number = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avgVolume: number = sum / dataArray.length / 255; // Normalize to 0-1

        // Calibration phase
        if (calibrationFrames < CALIBRATION_FRAMES) {
          baselineVolume =
            (baselineVolume * calibrationFrames + avgVolume) /
            (calibrationFrames + 1);
          calibrationFrames++;

          if (calibrationFrames === BASELINE_FRAMES) {
            // Set threshold as multiple of baseline
            threshold = Math.max(0.05, baselineVolume * 5);
            console.log(
              `Calibration complete. Baseline: ${baselineVolume.toFixed(4)}, Threshold: ${threshold.toFixed(4)}`
            );

            toast({
              title: 'Sound Detection Ready',
              description: 'Golf impact sound detection is active',
              variant: 'default',
            });
          }
        }
        // Detection phase
        else {
          // Check if volume exceeds threshold and we're not already in a peak
          if (avgVolume > threshold && !isPeaking) {
            isPeaking = true;
            peakTime = Date.now();

            // Record the time of impact
            const impactTime: number =
              (Date.now() - startTimeRef.current) / 1000;
            const formattedTime: string = formatDuration(impactTime);

            // Store impact time
            storeImpactTime(impactTime);

            console.log(
              `*** IMPACT DETECTED *** Time: ${formattedTime}, Volume: ${avgVolume.toFixed(4)}`
            );

            // Show toast notification
            toast({
              title: 'Impact Detected!',
              description: `Sound detected at ${formattedTime}. Recording will continue for a moment...`,
              variant: 'default',
            });

            // Schedule auto-stop after a delay
            if (autoStopTimeoutRef.current) {
              clearTimeout(autoStopTimeoutRef.current);
            }

            // Stop recording 2.5 seconds after impact
            autoStopTimeoutRef.current = setTimeout(() => {
              if (
                mediaRecorderRef.current &&
                mediaRecorderRef.current.state !== 'inactive'
              ) {
                stopRecording();
              }
            }, 2500);
          }

          // Reset peak status after 500ms
          if (isPeaking && Date.now() - peakTime > 500) {
            isPeaking = false;
          }
        }

        // Continue checking
        requestAnimationFrame(checkVolume);
      };

      // Start checking volume
      checkVolume();

      setIsListeningForImpact(true);
    } catch (error) {
      console.error('Failed to initialize sound detection:', error);
      toast({
        title: 'Error',
        description: 'Could not initialize audio detection',
        variant: 'destructive',
      });
    }
  };

  // Add function to stop impact detection
  const stopImpactDetection = () => {
    setIsListeningForImpact(false);

    // Clear any pending auto-stop
    if (autoStopTimeoutRef.current) {
      clearTimeout(autoStopTimeoutRef.current);
      autoStopTimeoutRef.current = null;
    }

    // Close audio context if it exists
    if (audioContextRef.current) {
      try {
        // Disconnect analyser if it exists
        if (analyserRef.current) {
          analyserRef.current.disconnect();
          analyserRef.current = null;
        }

        // Close audio context
        audioContextRef.current.close();
        audioContextRef.current = null;
      } catch (error) {
        console.error('Error closing audio context:', error);
      }
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
      stopImpactDetection();
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const downloadVideo = () => {
    const blobToDownload = trimmedVideoBlob || recordedVideoBlob;
    if (!blobToDownload) return;

    const url = URL.createObjectURL(blobToDownload);
    const a = document.createElement('a');
    a.href = url;
    const extension = blobToDownload.type.includes('mp4') ? 'mp4' : 'webm';
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

  // Updated prepareVideoForPlayback function that handles missing references
  const prepareVideoForPlayback = (blob: Blob) => {
    if (!blob) {
      console.error('No video blob provided for playback');
      return;
    }

    console.log(
      `Preparing video for playback, blob size: ${blob.size} bytes, type: ${blob.type}`
    );

    // Skip direct video element manipulation if we're using the VideoPlayer component
    // The VideoPlayer component will handle the blob directly
    if (!previewVideoRef.current) {
      console.log(
        'No direct preview video ref available, relying on VideoPlayer component'
      );
      return;
    }

    // If previewVideoRef exists, we'll update it directly
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
              <p className="text-gray-400">
                Detecting ball impact and optimsing video...
              </p>
            </div>
          </div>
        ) : recordedVideoBlob ? (
          <div className="relative h-full w-full overscroll-none">
            <VideoPlayer
              videoBlob={trimmedVideoBlob || recordedVideoBlob}
              impactTimeLabel={impactTimeLabel}
            />

            {trimmedVideoBlob && (
              <div className="absolute top-4 right-4 bg-green-600 text-white px-3 py-1 rounded-full text-sm">
                Auto-trimmed
              </div>
            )}
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

            {isListeningForImpact && (
              <div className="bg-blue-500 px-3 py-1 rounded-full flex items-center gap-2 text-sm">
                <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                <span>Listening for impact</span>
              </div>
            )}
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
                    videoBlob={trimmedVideoBlob || recordedVideoBlob}
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
