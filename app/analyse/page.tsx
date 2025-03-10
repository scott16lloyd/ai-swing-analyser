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
    // Only in development mode
    if (process.env.NODE_ENV === 'development') {
      const cleanup = addTestButtons();
      return cleanup;
    }
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

  const requestAudioPermission = async () => {
    try {
      // Explicitly request audio permission separately
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      // Stop the stream immediately, we just needed the permission
      audioStream.getTracks().forEach((track) => track.stop());

      toast({
        title: 'Microphone Access',
        description: 'Microphone permission granted for clap detection',
        variant: 'default',
      });

      return true;
    } catch (error) {
      console.error('Failed to get audio permission:', error);
      toast({
        title: 'Warning',
        description: 'Microphone access denied. Clap detection will not work.',
        variant: 'destructive',
      });
      return false;
    }
  };

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

  const addTestButtons = () => {
    // Add a test div with controls
    const testDiv = document.createElement('div');
    testDiv.style.position = 'absolute';
    testDiv.style.bottom = '200px';
    testDiv.style.left = '10px';
    testDiv.style.padding = '10px';
    testDiv.style.backgroundColor = 'rgba(0,0,0,0.7)';
    testDiv.style.color = 'white';
    testDiv.style.zIndex = '1000';
    testDiv.style.borderRadius = '5px';

    // Add a test button to manually trigger recording stop
    const stopButton = document.createElement('button');
    stopButton.innerText = 'Test Stop Recording';
    stopButton.style.backgroundColor = 'red';
    stopButton.style.color = 'white';
    stopButton.style.padding = '8px';
    stopButton.style.border = 'none';
    stopButton.style.borderRadius = '4px';
    stopButton.style.marginRight = '10px';
    stopButton.onclick = () => {
      console.log('Manual stop button clicked');
      if (isRecording && mediaRecorderRef.current) {
        stopRecording();
      } else {
        console.log('Not recording - nothing to stop');
      }
    };

    // Add a test button to manually simulate impact
    const impactButton = document.createElement('button');
    impactButton.innerText = 'Simulate Impact';
    impactButton.style.backgroundColor = 'blue';
    impactButton.style.color = 'white';
    impactButton.style.padding = '8px';
    impactButton.style.border = 'none';
    impactButton.style.borderRadius = '4px';
    impactButton.onclick = () => {
      console.log('Simulating impact');
      if (isRecording) {
        const impactTime = (Date.now() - startTimeRef.current) / 1000;
        setImpactTimeLabel(formatDuration(impactTime));

        toast({
          title: 'Impact Simulated!',
          description: 'Recording will stop in 1.5 seconds',
          variant: 'default',
        });

        if (autoStopTimeoutRef.current) {
          clearTimeout(autoStopTimeoutRef.current);
        }

        autoStopTimeoutRef.current = setTimeout(() => {
          if (isRecording && mediaRecorderRef.current) {
            stopRecording();
          }
        }, 1500);
      } else {
        console.log('Not recording - cannot simulate impact');
      }
    };

    testDiv.appendChild(stopButton);
    testDiv.appendChild(impactButton);
    document.body.appendChild(testDiv);

    console.log('Test buttons added');

    // Return cleanup function
    return () => {
      try {
        document.body.removeChild(testDiv);
      } catch (err) {
        // Ignore cleanup errors
      }
    };
  };

  const testStopRecording = (): void => {
    if (isRecording && mediaRecorderRef.current) {
      console.log('Manually stopping recording (test function)');
      stopRecording();
    } else {
      console.log('Not recording - nothing to stop');
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

    if (!streamRef.current) {
      console.error('No stream available for recording');
      return;
    }

    try {
      // Try to use better codec options when available
      const mimeType = getSupportedMimeType();
      console.log('Starting recording with MIME type:', mimeType);

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
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
        }

        // Clean up audio analysis
        stopImpactDetection();

        // Set isProcessing to true first, before any video processing
        setIsProcessing(true);

        // Create a new blob with the correct MIME type
        const fullVideoBlob = new Blob(chunksRef.current, { type: mimeType });

        try {
          // If we have an impact time, trim the video around that time
          if (impactTimeLabel) {
            // Convert impact time label back to seconds
            const impactTimeParts = impactTimeLabel.split(':');
            const minutes = parseInt(impactTimeParts[0]);
            const seconds = parseFloat(impactTimeParts[1]);
            const impactTimeInSeconds = minutes * 60 + seconds;

            // Calculate trim points: keep up to 4 seconds before and 1.5 seconds after impact
            const startTime = Math.max(0, impactTimeInSeconds - 4);
            const endTime = impactTimeInSeconds + 1.5;

            console.log(`Trimming video from ${startTime}s to ${endTime}s`);

            try {
              // Trim the video
              const trimmedBlob = await trimVideoByTimeRange(
                fullVideoBlob,
                startTime,
                endTime
              );

              console.log(
                'Trimmed video created successfully:',
                trimmedBlob.size,
                'bytes'
              );

              setRecordedVideoBlob(fullVideoBlob);

              // Use a small timeout to ensure state updates separately
              setTimeout(() => {
                setTrimmedVideoBlob(trimmedBlob);
                setIsProcessing(false);

                toast({
                  title: 'Video Processed',
                  description: `Auto-trimmed around impact at ${impactTimeLabel}`,
                  variant: 'default',
                });
              }, 100);
            } catch (error) {
              console.error('Error trimming video:', error);
              // If trimming fails, just use the full video
              setRecordedVideoBlob(fullVideoBlob);
              setIsProcessing(false);

              toast({
                title: 'Trimming Failed',
                description: 'Using the full video instead',
                variant: 'destructive',
              });
            }
          } else {
            // No impact detected, just use the full video
            console.log('No impact detected, using full video');
            setRecordedVideoBlob(fullVideoBlob);
            setIsProcessing(false);
          }
        } catch (error) {
          console.error('Error trimming video:', error);

          // Fallback to showing the full video
          setRecordedVideoBlob(fullVideoBlob);
          setIsProcessing(false);

          toast({
            title: 'Processing Error',
            description: 'There was an error processing the video',
            variant: 'destructive',
          });
        }
      };

      // Request data more frequently for smoother recording
      mediaRecorder.start(500);
      const isRecordingRef = { current: true };
      setIsRecording(true);

      // Update the timer based on elapsed time since recording started
      recordingTimerRef.current = setInterval(() => {
        const elapsedSeconds = Math.floor(
          (Date.now() - startTimeRef.current) / 1000
        );
        setRecordingDuration(elapsedSeconds);
      }, 500);

      // Then start impact detection immediately using the ref's value
      const startDetection = () => {
        console.log('Starting impact detection, isRecording is true');
        startImpactDetectionDirect();
      };

      // Finally update the state, which happens asynchronously
      setIsRecording(true);
      // Give a short delay to ensure all is initialized
      setTimeout(startDetection, 100);
    } catch (err) {
      console.error('Error starting recording:', err);
      toast({
        title: 'Error',
        description: 'Failed to start recording. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const startImpactDetectionDirect = (): void => {
    console.log('Starting direct impact detection');

    if (!streamRef.current) {
      console.error('No stream available for impact detection');
      return;
    }

    try {
      console.log('🎤 Starting sound detection...');

      // Add a visible debug div
      const debugDiv = document.createElement('div');
      debugDiv.style.position = 'absolute';
      debugDiv.style.top = '70px';
      debugDiv.style.left = '10px';
      debugDiv.style.backgroundColor = 'rgba(0,0,0,0.7)';
      debugDiv.style.color = 'white';
      debugDiv.style.padding = '10px';
      debugDiv.style.zIndex = '1000';
      debugDiv.innerText = 'Starting sound detection...';
      document.body.appendChild(debugDiv);

      // Create a level meter
      const meterDiv = document.createElement('div');
      meterDiv.style.position = 'absolute';
      meterDiv.style.top = '110px';
      meterDiv.style.left = '10px';
      meterDiv.style.right = '10px';
      meterDiv.style.height = '20px';
      meterDiv.style.backgroundColor = '#333';
      meterDiv.style.zIndex = '1000';

      const levelIndicator = document.createElement('div');
      levelIndicator.style.height = '100%';
      levelIndicator.style.width = '0%';
      levelIndicator.style.backgroundColor = 'green';
      meterDiv.appendChild(levelIndicator);
      document.body.appendChild(meterDiv);

      // Create a simple audio context
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;

      if (!AudioContextClass) {
        console.error('AudioContext not supported');
        debugDiv.innerText = 'Error: AudioContext not supported';
        return;
      }

      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;

      // Get audio tracks from stream
      const audioTracks = streamRef.current.getAudioTracks();

      if (audioTracks.length === 0) {
        console.error('No audio tracks in stream');
        debugDiv.innerText = 'Error: No audio tracks found';
        return;
      }

      console.log(`Using audio track: ${audioTracks[0].label}`);
      debugDiv.innerText = `Found audio: ${audioTracks[0].label}`;

      // Create audio source
      const source = audioContext.createMediaStreamSource(streamRef.current);

      // Create a script processor for direct access to audio data
      const processor = audioContext.createScriptProcessor(2048, 1, 1);
      source.connect(processor);
      processor.connect(audioContext.destination);

      // These values will be adjusted during calibration
      let baselineVolume = 0;
      let calibrationFrames = 0;
      let threshold = 0.05; // Starting threshold, will be adjusted
      let maxVolume = 0;
      let isPeaking = false;
      let peakTime = 0;

      // Use console for debugging
      console.log('🎤 Sound detection started - watch for console logs');

      // This is the function that processes audio
      processor.onaudioprocess = (e: AudioProcessingEvent): void => {
        if (
          !mediaRecorderRef.current ||
          mediaRecorderRef.current.state === 'inactive'
        ) {
          // Clean up when not recording
          try {
            processor.disconnect();
            source.disconnect();
            document.body.removeChild(debugDiv);
            document.body.removeChild(meterDiv);
          } catch (err) {
            // Ignore cleanup errors
          }
          return;
        }

        // Get audio data
        const input = e.inputBuffer.getChannelData(0);

        // Calculate volume (RMS)
        let sum = 0;
        for (let i = 0; i < input.length; i++) {
          sum += input[i] * input[i];
        }
        const volumeLevel = Math.sqrt(sum / input.length);

        // First 30 frames are for calibration
        if (calibrationFrames < 30) {
          baselineVolume =
            (baselineVolume * calibrationFrames + volumeLevel) /
            (calibrationFrames + 1);
          calibrationFrames++;

          // After calibration, set threshold higher than baseline
          if (calibrationFrames === 30) {
            // Set threshold based on baseline volume
            threshold = Math.max(0.05, baselineVolume * 8); // Higher multiplier for better detection
            console.log(
              `Calibration complete - Baseline: ${baselineVolume.toFixed(4)}, Threshold: ${threshold.toFixed(4)}`
            );
            debugDiv.innerText = `Ready! Baseline: ${baselineVolume.toFixed(4)}, Threshold: ${threshold.toFixed(4)}`;

            // Also show a toast notification so the user knows calibration is done
            toast({
              title: 'Clap Detection Ready',
              description: 'You can now clap to stop recording',
              variant: 'default',
            });
          }
        } else {
          // Update debug display
          const percent = Math.min(100, Math.floor(volumeLevel * 1000));
          levelIndicator.style.width = `${percent}%`;
          levelIndicator.style.backgroundColor =
            volumeLevel > threshold ? 'red' : 'green';

          // Update every 5 frames for better performance
          if (calibrationFrames % 5 === 0) {
            debugDiv.innerText = `Vol: ${volumeLevel.toFixed(4)}, Threshold: ${threshold.toFixed(4)}, Max: ${maxVolume.toFixed(4)}`;
          }
          calibrationFrames++;

          // Track maximum volume
          if (volumeLevel > maxVolume) {
            maxVolume = volumeLevel;
          }

          // Detect impact - if volume exceeds threshold
          if (volumeLevel > threshold && !isPeaking) {
            console.log(
              `🔊 LOUD SOUND DETECTED! Level: ${volumeLevel.toFixed(4)}`
            );
            isPeaking = true;
            peakTime = Date.now();

            // Record the time of impact
            const impactTime = (Date.now() - startTimeRef.current) / 1000;
            setImpactTimeLabel(formatDuration(impactTime));

            // Visual feedback
            levelIndicator.style.backgroundColor = 'red';
            levelIndicator.style.width = '100%';
            debugDiv.innerText = `🎯 IMPACT DETECTED! Level: ${volumeLevel.toFixed(4)}`;
            debugDiv.style.backgroundColor = 'rgba(255,0,0,0.7)';

            // Show toast notification
            toast({
              title: 'Sound Detected!',
              description: 'Recording will stop in 1.5 seconds',
              variant: 'default',
            });

            // Schedule auto-stop after 1.5 seconds
            if (autoStopTimeoutRef.current) {
              clearTimeout(autoStopTimeoutRef.current);
            }

            autoStopTimeoutRef.current = setTimeout(() => {
              if (
                mediaRecorderRef.current &&
                mediaRecorderRef.current.state !== 'inactive'
              ) {
                stopRecording();
              }
              // Clean up
              try {
                processor.disconnect();
                source.disconnect();
                document.body.removeChild(debugDiv);
                document.body.removeChild(meterDiv);
              } catch (err) {
                // Ignore cleanup errors
              }
            }, 1500);

            return;
          }

          // Reset peak status after 500ms to allow for new peaks
          if (isPeaking && Date.now() - peakTime > 500) {
            isPeaking = false;
          }
        }
      };

      setIsListeningForImpact(true);
    } catch (error: unknown) {
      console.error('Failed to initialize sound detection:', error);
      toast({
        title: 'Error',
        description: 'Could not initialize audio detection',
        variant: 'destructive',
      });
    }
  };

  const getVideoUrl = () => {
    // If we have a trimmed video, use that
    if (trimmedVideoBlob) {
      console.log('Using trimmed video for playback');
      return URL.createObjectURL(trimmedVideoBlob);
    }

    // Otherwise use the full video
    if (recordedVideoBlob) {
      console.log('Using full video for playback');
      return URL.createObjectURL(recordedVideoBlob);
    }

    return '';
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
              key={`video-${trimmedVideoBlob ? 'trimmed' : 'full'}-${Date.now()}`}
              src={getVideoUrl()}
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
