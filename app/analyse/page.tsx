'use client';

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
import { VideoUploadButton } from '@/components/ui/upload-button';
import Image from 'next/image';
import golfSwingImage from '../public/face-on-golf-swing-soloute.png';

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

  const { toast } = useToast();

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
          echoCancellation: false, // Disable echo cancellation for clearer transients
          noiseSuppression: false, // Disable noise suppression to catch sharp sounds
          autoGainControl: false, // Disable auto gain to preserve volume spikes
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

  const trimVideoByTimeRange = async (
    videoBlob: Blob,
    startTime: number,
    endTime: number
  ): Promise<Blob> => {
    // Create a video element for the source
    const sourceVideo = document.createElement('video');
    sourceVideo.src = URL.createObjectURL(videoBlob);

    // Wait for metadata to load
    await new Promise<void>((resolve) => {
      sourceVideo.onloadedmetadata = () => resolve();
      sourceVideo.load();
    });

    // Set up canvas for frame extraction
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Could not get canvas context');
    }

    // Set canvas dimensions based on the source video
    canvas.width = sourceVideo.videoWidth;
    canvas.height = sourceVideo.videoHeight;

    // Create a stream from the canvas
    // @ts-ignore - TypeScript doesn't recognize captureStream but it exists in modern browsers
    const canvasStream = canvas.captureStream(30); // 30 FPS

    // Try to get audio from the original video
    let audioTrack: MediaStreamTrack | undefined;
    try {
      const tempVideo = document.createElement('video');
      tempVideo.src = URL.createObjectURL(videoBlob);

      await new Promise<void>((resolve) => {
        tempVideo.oncanplay = () => resolve();
        tempVideo.load();
      });

      // Play and pause to initialize streams
      await tempVideo.play();
      tempVideo.pause();

      // @ts-ignore - captureStream exists in modern browsers
      const tempStream = tempVideo.captureStream();
      const audioTracks = tempStream.getAudioTracks();

      if (audioTracks.length > 0) {
        audioTrack = audioTracks[0];
        if (audioTrack) {
          canvasStream.addTrack(audioTrack);
        }
      }
    } catch (err) {
      console.warn('Could not extract audio track:', err);
    }

    // Set up MediaRecorder for the trimmed video
    const mimeType = getSupportedMimeType();
    const mediaRecorder = new MediaRecorder(canvasStream, {
      mimeType: mimeType,
      videoBitsPerSecond: 5000000, // 5Mbps for high quality
    });

    const trimmedChunks: Blob[] = [];

    // Return a promise that resolves with the trimmed blob
    return new Promise((resolve, reject) => {
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          trimmedChunks.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        // Create final blob from recorded chunks
        const trimmedBlob = new Blob(trimmedChunks, { type: mimeType });

        // Clean up
        URL.revokeObjectURL(sourceVideo.src);

        if (audioTrack) {
          audioTrack.stop();
        }

        resolve(trimmedBlob);
      };

      // Start recording
      mediaRecorder.start(100);

      // Start processing from the start time
      sourceVideo.currentTime = startTime;

      // Function to process each frame
      const processFrame = () => {
        if (sourceVideo.currentTime <= endTime) {
          // Draw current frame to canvas
          ctx.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);

          // Move to next frame (approximately 1/30th of a second)
          const nextFrameTime = sourceVideo.currentTime + 1 / 30;

          // If next frame would exceed end time, stop recording
          if (nextFrameTime > endTime) {
            setTimeout(() => {
              mediaRecorder.stop();
            }, 100);
            return;
          }

          // Otherwise, seek to next frame
          sourceVideo.currentTime = nextFrameTime;
        } else {
          // We've reached the end time
          mediaRecorder.stop();
        }
      };

      // Start processing frames when seeking is complete
      sourceVideo.onseeked = processFrame;

      // Handle errors
      sourceVideo.onerror = (err) => {
        console.error('Error during video trimming:', err);
        mediaRecorder.stop();
        reject(new Error('Video processing error'));
      };
    });
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
        videoBitsPerSecond: 5000000,
        audioBitsPerSecond: 128000,
      };

      const mediaRecorder = new MediaRecorder(streamRef.current, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Create a new blob with the correct MIME type
        const blob = new Blob(chunksRef.current, { type: mimeType });

        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
        }

        // Clean up audio analysis
        stopImpactDetection();

        // If we have an impact time, trim the video around that time
        if (impactTimeLabel) {
          setIsProcessing(true);

          try {
            // Convert impact time label back to seconds
            const impactTimeParts = impactTimeLabel.split(':');
            const minutes = parseInt(impactTimeParts[0]);
            const seconds = parseFloat(impactTimeParts[1]);
            const impactTimeInSeconds = minutes * 60 + seconds;

            // Calculate trim points: keep up to 4 seconds before and 1.5 seconds after impact
            const startTime = Math.max(0, impactTimeInSeconds - 4);
            const endTime = impactTimeInSeconds + 1.5;

            console.log(`Trimming video from ${startTime}s to ${endTime}s`);

            // Trim the video
            const trimmedBlob = await trimVideoByTimeRange(
              blob,
              startTime,
              endTime
            );
            setTrimmedVideoBlob(trimmedBlob);

            toast({
              title: 'Video Processed',
              description: `Auto-trimmed around impact at ${impactTimeLabel}`,
              variant: 'default',
            });
          } catch (error) {
            console.error('Error trimming video:', error);
            toast({
              title: 'Trimming Failed',
              description: 'Using the full video instead',
              variant: 'default',
            });
          } finally {
            setIsProcessing(false);
          }
        }

        // Set the recorded video blob regardless of trimming success
        setRecordedVideoBlob(blob);
        setIsProcessing(false);
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

      // Start listening for impact
      startImpactDetection();
    } catch (err) {
      console.error('Error starting recording:', err);
      toast({
        title: 'Error',
        description: 'Failed to start recording. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const startImpactDetection = () => {
    if (!streamRef.current || !isRecording) return;

    try {
      // Check if audio analysis is supported
      if (
        typeof AudioContext === 'undefined' &&
        typeof (window as any).webkitAudioContext === 'undefined'
      ) {
        console.warn('Web Audio API not supported, cannot detect impact');
        return;
      }

      // Create audio context
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;

      // Get the audio track from the stream
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (!audioTrack) {
        console.warn('No audio track found in stream');
        toast({
          title: 'Warning',
          description: 'No microphone detected. Impact detection disabled.',
          variant: 'destructive',
        });
        return;
      }

      console.log(
        'Impact detection started with audio track:',
        audioTrack.label
      );

      // Create media stream source
      const microphone = audioContext.createMediaStreamSource(
        streamRef.current
      );

      // Create analyzer with more detail (larger FFT size)
      const analyser = audioContext.createAnalyser();
      analyserRef.current = analyser;
      analyser.fftSize = 1024; // Larger FFT size for more detail
      analyser.smoothingTimeConstant = 0.2; // Less smoothing to catch transients

      // Connect the microphone to the analyzer
      microphone.connect(analyser);

      // Define variables for impact detection
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      let maxVolume = 0;
      let baselineVolume = 0;
      let calibrationFrames = 0;
      const calibrationDuration = 30; // Number of frames to establish baseline

      // Adaptive threshold approach
      let threshold = 120; // Start with a lower initial threshold

      // History array to detect sudden changes
      const volumeHistory = new Array(5).fill(0);

      // Start listening for impact
      setIsListeningForImpact(true);

      // Debug visualization if needed (remove in production)
      let debugCounter = 0;

      // Function to analyze audio in real-time
      const analyzeAudio = () => {
        if (!isListeningForImpact || !isRecording) return;

        // Get current audio data
        analyser.getByteFrequencyData(dataArray);

        // Calculate weighted average focusing on mid-high frequencies (golf impact range)
        // Golf ball impact generally creates frequencies in the 2-10kHz range
        // We'll give more weight to those frequencies
        let totalWeight = 0;
        let weightedSum = 0;

        // Calculate focus on mid to high frequencies (golf impact has distinctive signature)
        for (let i = 0; i < bufferLength; i++) {
          // Calculate frequency this bin represents
          const frequency =
            (i * audioContext.sampleRate) / (analyser.fftSize * 2);

          // Weight calculator - emphasize 2kHz to 10kHz range
          let weight = 1;
          if (frequency > 2000 && frequency < 10000) {
            weight = 3; // Emphasize the golf impact frequency range
          }

          weightedSum += dataArray[i] * weight;
          totalWeight += weight;
        }

        const average = weightedSum / totalWeight;

        // Update volume history
        volumeHistory.shift();
        volumeHistory.push(average);

        // During initial calibration, establish baseline volume
        if (calibrationFrames < calibrationDuration) {
          baselineVolume =
            (baselineVolume * calibrationFrames + average) /
            (calibrationFrames + 1);
          calibrationFrames++;

          // Once calibration is done, set the threshold higher than the baseline
          if (calibrationFrames === calibrationDuration) {
            // Set threshold above baseline noise but not too high
            threshold = baselineVolume + 70;
            console.log(
              `Calibrated: Baseline ${baselineVolume.toFixed(2)}, Threshold set to ${threshold.toFixed(2)}`
            );

            // Notify user
            toast({
              title: 'Ready',
              description: 'Impact detection calibrated and active',
              variant: 'default',
            });
          }
        }

        // Occasionally log audio levels for debugging (every 30 frames)
        debugCounter++;
        if (debugCounter % 30 === 0) {
          console.log(
            `Current audio level: ${average.toFixed(2)}, Threshold: ${threshold.toFixed(2)}`
          );
        }

        // Check for sharp rise in audio level (characteristic of impact)
        const volumeChange = average - volumeHistory[0];
        const isSharpRise = volumeChange > 40; // Detect sudden increases

        // Check if this is a peak (likely the ball impact)
        // We look for BOTH high absolute value AND a sharp rise
        if (
          (average > threshold || (average > threshold * 0.7 && isSharpRise)) &&
          average > maxVolume
        ) {
          maxVolume = average;

          // Log all potential impact candidates
          console.log(
            `Potential impact detected: ${average.toFixed(2)} (${volumeChange > 0 ? '+' : ''}${volumeChange.toFixed(2)})`
          );

          // If we've found a strong peak (ball strike)
          if (
            average > threshold + 20 ||
            (average > threshold && isSharpRise)
          ) {
            // Mark impact detected
            const impactTime = (Date.now() - startTimeRef.current) / 1000;
            setImpactTimeLabel(formatDuration(impactTime));

            console.log(
              `IMPACT DETECTED at ${formatDuration(impactTime)}, level: ${average.toFixed(2)}`
            );

            // Show impact detected notification
            toast({
              title: 'Impact Detected!',
              description: 'Recording will stop automatically in 1.5 seconds',
              variant: 'default',
            });

            // Schedule auto-stop after 1.5 seconds
            if (autoStopTimeoutRef.current) {
              clearTimeout(autoStopTimeoutRef.current);
            }

            autoStopTimeoutRef.current = setTimeout(() => {
              if (isRecording && mediaRecorderRef.current) {
                stopRecording();
              }
            }, 1500); // 1.5 seconds after impact

            // Stop listening for further impacts
            stopImpactDetection();
            return;
          }
        }

        // Continue analyzing if no impact detected yet
        requestAnimationFrame(analyzeAudio);
      };

      // Start the analysis
      analyzeAudio();
    } catch (error) {
      console.error('Error starting impact detection:', error);
      setIsListeningForImpact(false);

      toast({
        title: 'Error',
        description: 'Failed to initialize audio analysis',
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
        // Disconnect analyzer if it exists
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

  return (
    <div className="h-[calc(100vh-4rem)] w-full flex flex-col bg-black text-white">
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
            <div className="text-center">
              <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <h2 className="text-xl font-semibold mb-2">Analyzing Swing</h2>
              <p className="text-gray-400">
                Detecting ball impact and optimizing video...
              </p>
            </div>
          </div>
        ) : recordedVideoBlob ? (
          // Show recorded video playback
          <div className="relative h-full w-full">
            <video
              key={trimmedVideoBlob ? 'trimmed' : 'recorded'}
              src={URL.createObjectURL(trimmedVideoBlob || recordedVideoBlob)}
              className="h-full w-full object-contain"
              controls
              autoPlay
              ref={previewVideoRef}
            />
            {impactTimeLabel && (
              <div className="absolute top-4 left-4 bg-blue-600 text-white px-3 py-1 rounded-full text-sm">
                Impact at {impactTimeLabel}
              </div>
            )}
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

            {countdownTime === null && !isRecording ? (
              recordedVideoBlob ? (
                // If we have a recorded video, show controls for it
                <>
                  <VideoUploadButton
                    videoBlob={trimmedVideoBlob || recordedVideoBlob}
                    cameraFacing={cameraFacing}
                  />

                  <Button
                    className="rounded-full p-3 bg-transparent border-2 border-white hover:bg-white/20 transition-colors"
                    onClick={downloadVideo}
                    title="Download Video"
                  >
                    <Download className="h-6 w-6" />
                  </Button>

                  <Button
                    className="rounded-full p-3 bg-blue-600 hover:bg-blue-700 transition-colors"
                    onClick={startCountdown}
                    title="Record New Video"
                  >
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
