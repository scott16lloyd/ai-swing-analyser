'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  AlertCircle,
  CameraIcon,
  Download,
  Upload,
  Scissors,
  Check,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { VideoUploadButton } from '@/components/ui/upload-button';
import Image from 'next/image';
import golfSwingImage from '../public/face-on-golf-swing-soloute.png';

// TypeScript type definitions
type CameraFacing = 'user' | 'environment';

export default function VideoCapturePage() {
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>('environment');
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null);
  const [trimmedVideoBlob, setTrimmedVideoBlob] = useState<Blob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [countdownTime, setCountdownTime] = useState<number | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isTrimming, setIsTrimming] = useState(false);
  const [trimRange, setTrimRange] = useState<[number, number]>([0, 100]);
  const [videoDuration, setVideoDuration] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const trimPreviewRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | undefined>();
  const countdownTimerRef = useRef<NodeJS.Timeout | undefined>();
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

  // Load video duration when a new video is recorded
  useEffect(() => {
    if (recordedVideoBlob && trimPreviewRef.current) {
      try {
        // Create and store the object URL
        const videoUrl = URL.createObjectURL(recordedVideoBlob);
        console.log('Created preview URL:', videoUrl);

        // Clean up previous URL if it exists
        if (
          trimPreviewRef.current.src &&
          trimPreviewRef.current.src.startsWith('blob:')
        ) {
          URL.revokeObjectURL(trimPreviewRef.current.src);
        }

        // Set the source and attempt to load the video
        trimPreviewRef.current.src = videoUrl;
        trimPreviewRef.current.load();

        trimPreviewRef.current.onloadedmetadata = () => {
          if (trimPreviewRef.current) {
            console.log(
              'Video metadata loaded, duration:',
              trimPreviewRef.current.duration
            );
            setVideoDuration(trimPreviewRef.current.duration);
            setTrimRange([0, 100]); // Reset trim range
          }
        };

        trimPreviewRef.current.onerror = (e) => {
          console.error('Error loading video in trim preview:', e);
        };
      } catch (err) {
        console.error('Error setting up trim preview:', err);
      }
    }

    // Clean up URL objects when component unmounts or video changes
    return () => {
      if (
        trimPreviewRef.current &&
        trimPreviewRef.current.src &&
        trimPreviewRef.current.src.startsWith('blob:')
      ) {
        URL.revokeObjectURL(trimPreviewRef.current.src);
      }
    };
  }, [recordedVideoBlob, isTrimming]);

  const startCamera = async () => {
    try {
      // Stop any existing stream first
      stopCamera();

      // More balanced constraints for better performance
      const constraints = {
        video: {
          facingMode: cameraFacing,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
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
    const blobToUpload = trimmedVideoBlob || recordedVideoBlob;
    if (!blobToUpload) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('video', blobToUpload, 'captured-video.mp4');

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
    setIsTrimming(false);
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
          if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current);
          }
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
      const options = {
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

        // Create stable URL for the recorded video that won't be immediately revoked
        const recordedVideoUrl = URL.createObjectURL(blob);
        console.log('Created video URL:', recordedVideoUrl);

        // Immediately go to trimming mode after recording stops
        setIsTrimming(true);
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
  const getSupportedMimeType = () => {
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

      // Ensure we properly cleanup any existing object URLs when recording stops
      if (videoRef.current && videoRef.current.src) {
        URL.revokeObjectURL(videoRef.current.src);
      }

      // No need for delayed transition since it's handled in the mediaRecorder.onstop handler
    }
  };

  // Remove the cancel trimming function as it's no longer needed
  // Users must trim video before they can proceed
  const startTrimming = () => {
    setIsTrimming(true);
  };

  const handleTrimRangeChange = (newValues: [number, number]) => {
    setTrimRange(newValues);

    // Update video preview to show the start of the trim range
    if (trimPreviewRef.current) {
      const startTimeInSeconds = (newValues[0] / 100) * videoDuration;
      trimPreviewRef.current.currentTime = startTimeInSeconds;
    }
  };

  const trimVideo = async () => {
    if (!recordedVideoBlob || !trimPreviewRef.current) return;

    try {
      // Show loading state
      toast({
        title: 'Processing',
        description: 'Trimming video...',
        variant: 'default',
      });

      // Calculate trim start and end times in seconds
      const startTime = (trimRange[0] / 100) * videoDuration;
      const endTime = (trimRange[1] / 100) * videoDuration;

      // Create a new MediaSource
      const mediaSource = new MediaSource();
      const videoUrl = URL.createObjectURL(mediaSource);

      mediaSource.addEventListener('sourceopen', async () => {
        // Convert recorded blob to ArrayBuffer
        const arrayBuffer = await recordedVideoBlob.arrayBuffer();

        // Create a SourceBuffer with the same MIME type
        const mimeType = recordedVideoBlob.type;
        const sourceBuffer = mediaSource.addSourceBuffer(mimeType);

        // Set up the trimming logic using Web Video Editor API
        // Note: This is a simplified approach - a more robust solution might require
        // a library like FFmpeg.js for more complex trimming operations

        // For this example, we'll use a simpler approach that works for basic trimming
        // by creating a new blob from the trimmed portion

        // First, append the entire video to the SourceBuffer
        sourceBuffer.addEventListener('updateend', () => {
          // Create a new video element to extract the frames
          const tempVideo = document.createElement('video');
          tempVideo.src = videoUrl;

          tempVideo.addEventListener('loadeddata', async () => {
            // Create a canvas to draw video frames
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            if (!ctx) {
              throw new Error('Could not get canvas context');
            }

            // Set canvas dimensions
            canvas.width = tempVideo.videoWidth;
            canvas.height = tempVideo.videoHeight;

            // Create a MediaRecorder to capture the canvas output
            const stream = canvas.captureStream(30); // 30fps
            const trimmedRecorder = new MediaRecorder(stream, {
              mimeType: getSupportedMimeType(),
              videoBitsPerSecond: 5000000,
            });

            const trimmedChunks: Blob[] = [];

            trimmedRecorder.ondataavailable = (e) => {
              if (e.data.size > 0) {
                trimmedChunks.push(e.data);
              }
            };

            trimmedRecorder.onstop = () => {
              const trimmedBlob = new Blob(trimmedChunks, { type: mimeType });
              setTrimmedVideoBlob(trimmedBlob);

              // Clean up
              URL.revokeObjectURL(videoUrl);

              toast({
                title: 'Success',
                description: 'Video trimmed successfully!',
                variant: 'default',
              });

              setIsTrimming(false);
            };

            // Start recording the canvas
            trimmedRecorder.start();

            // Set video to start time
            tempVideo.currentTime = startTime;

            const drawFrame = () => {
              // Draw the current frame to canvas
              ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);

              // If we've reached the end time, stop recording
              if (tempVideo.currentTime >= endTime) {
                trimmedRecorder.stop();
                return;
              }

              // Move to next frame (1/30 second later)
              tempVideo.currentTime += 1 / 30;

              // Continue drawing frames
              tempVideo.addEventListener('seeked', drawFrame, { once: true });
            };

            // Start drawing frames
            tempVideo.addEventListener('seeked', drawFrame, { once: true });
          });

          tempVideo.load();
        });

        sourceBuffer.appendBuffer(arrayBuffer);
      });
    } catch (err) {
      console.error('Error trimming video:', err);
      toast({
        title: 'Error',
        description: 'Failed to trim video. Please try again.',
        variant: 'destructive',
      });
      setIsTrimming(false);
    }
  };

  const downloadVideo = () => {
    const blobToDownload = trimmedVideoBlob || recordedVideoBlob;
    if (!blobToDownload) return;

    const url = URL.createObjectURL(blobToDownload);
    const a = document.createElement('a');
    a.href = url;
    const extension = blobToDownload.type.includes('mp4') ? 'mp4' : 'webm';
    a.download = `captured-video-${new Date().toISOString()}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Convert seconds to a readable time format (MM:SS)
  const formatTime = (timeInSeconds: number): string => {
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-[calc(100vh-4rem)] w-full flex flex-col bg-black text-white">
      <div className="relative flex-grow">
        {isTrimming ? (
          // Video trimming interface
          <div className="h-full flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-3xl">
              <h2 className="text-xl font-semibold mb-4">Trim Video</h2>

              <div className="aspect-video bg-gray-800 rounded-lg mb-4 overflow-hidden">
                <video
                  ref={trimPreviewRef}
                  className="w-full h-full object-contain"
                  controls
                />
              </div>

              <div className="mb-6">
                <div className="flex justify-between mb-2">
                  <span>
                    {formatTime((trimRange[0] / 100) * videoDuration)}
                  </span>
                  <span>
                    {formatTime((trimRange[1] / 100) * videoDuration)}
                  </span>
                </div>

                <Slider
                  value={trimRange}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={handleTrimRangeChange}
                  className="my-4"
                />

                <div className="flex justify-between text-sm text-gray-400">
                  <span>
                    Start: {formatTime((trimRange[0] / 100) * videoDuration)}
                  </span>
                  <span>
                    End: {formatTime((trimRange[1] / 100) * videoDuration)}
                  </span>
                </div>

                <div className="text-sm text-gray-400 mt-1">
                  Duration:{' '}
                  {formatTime(
                    ((trimRange[1] - trimRange[0]) / 100) * videoDuration
                  )}
                </div>
              </div>

              <div className="flex gap-4 justify-center">
                <Button
                  onClick={trimVideo}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Check className="mr-2 h-4 w-4" />
                  Apply Trim
                </Button>
              </div>
            </div>
          </div>
        ) : (
          // Camera view
          <>
            {error ? (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                <div className="text-center p-4">
                  <AlertCircle className="mx-auto h-12 w-12 text-red-500 mb-4" />
                  <p className="text-lg font-semibold mb-2">Camera Error</p>
                  <p>{error}</p>
                </div>
              </div>
            ) : (
              <>
                {!recordedVideoBlob && (
                  <Image
                    src={golfSwingImage}
                    alt="Golf Swing"
                    layout="fill"
                    objectFit="cover"
                    style={{ opacity: 0.2 }}
                  />
                )}
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover rounded-xl aspect-w-16 aspect-h-9"
                  style={{
                    transform: cameraFacing === 'user' ? 'scaleX(-1)' : 'none',
                    display: recordedVideoBlob ? 'none' : 'block',
                  }}
                />
                {recordedVideoBlob && (
                  <video
                    key={`preview-${recordedVideoBlob.size}`}
                    src={URL.createObjectURL(recordedVideoBlob)}
                    className="h-full w-full object-cover rounded-xl aspect-w-16 aspect-h-9"
                    controls
                    playsInline
                    loop={false}
                    preload="auto"
                    controlsList="nodownload"
                  />
                )}
              </>
            )}

            {/* Countdown Timer Display */}
            {countdownTime !== null && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-8xl font-bold text-white bg-black/50 rounded-full h-40 w-40 flex items-center justify-center">
                    {countdownTime}
                  </div>
                  <Button
                    onClick={startCountdown}
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
          </>
        )}
      </div>

      <div className="relative p-4 mb-16 flex justify-center items-center gap-4">
        {isTrimming ? null : (
          <>
            {recordedVideoBlob ? (
              // Controls after recording
              <>
                <Button
                  className="rounded-full p-3 bg-transparent border-2 border-white hover:bg-white/20 transition-colors"
                  onClick={startTrimming}
                  title="Trim Video"
                >
                  <Scissors className="h-6 w-6" />
                </Button>

                <Button
                  className="rounded-full p-3 bg-transparent border-2 border-white hover:bg-white/20 transition-colors"
                  onClick={downloadVideo}
                  disabled={countdownTime !== null}
                  title="Download Video"
                >
                  <Download className="h-6 w-6" />
                </Button>

                <VideoUploadButton
                  videoBlob={trimmedVideoBlob || recordedVideoBlob}
                  cameraFacing={cameraFacing}
                />

                <Button
                  className="rounded-full p-3 bg-blue-600 hover:bg-blue-700 transition-colors"
                  onClick={startCountdown}
                  title="Record New Video"
                >
                  <CameraIcon className="h-6 w-6" />
                </Button>
              </>
            ) : (
              // Controls before/during recording
              <>
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
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
