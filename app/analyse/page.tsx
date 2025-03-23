'use client';
import VideoPlayer from '@/components/ui/videoPlayer';
import {
  trimVideoByTimeRange,
  getSupportedMimeType,
  formatDuration,
  getVideoDuration,
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
import {
  VideoUploadButton,
  ProcessVideoResponse,
} from '@/components/ui/upload-button';
import Image from 'next/image';
import golfSwingImage from '../public/face-on-golf-swing-soloute.png';
import { useRouter } from 'next/navigation';

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

      // This should replace the code in your mediaRecorder.onstop handler
      // inside the startRecording function

      // In the VideoCapturePage.tsx file, update the mediaRecorder.onstop handler
      // This section is where the error is occurring

      // Replace your mediaRecorder.onstop handler with this version
      // This approach gets the actual duration from the video file itself

      // This is the updated mediaRecorder.onstop handler from the VideoCapturePage.tsx file

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
        console.log(
          `Recording stopped. Full video size: ${fullVideoBlob.size} bytes`
        );

        try {
          // Get the actual video duration by loading it into a video element
          const actualDuration = await getVideoDuration(fullVideoBlob);
          console.log(`Actual video duration from file: ${actualDuration}s`);
          console.log(
            `Tracked duration: ref=${currentDurationRef.current}s, state=${recordingDuration}s`
          );

          // Use the maximum of tracked duration or actual duration to ensure we have something valid
          const finalDuration = Math.max(
            currentDurationRef.current,
            actualDuration
          );
          console.log(`Using final duration: ${finalDuration}s`);

          // Get the impact time from state or window global
          const storedImpactTime =
            impactTimeLabel ||
            window.lastImpactTime ||
            lastImpactTimeRef.current;
          console.log(
            `Checking for impact time: Global=${globalImpactTime}, State=${impactTimeLabel}, Ref=${lastImpactTimeRef.current}`
          );

          // If we have an impact time, trim the video around that time
          if (storedImpactTime) {
            console.log(`Using impact time: ${storedImpactTime}`);
            // Convert impact time label back to seconds
            const impactTimeParts = storedImpactTime.split(':');
            const minutes = parseInt(impactTimeParts[0]);
            const seconds = parseFloat(impactTimeParts[1]);
            const impactTimeInSeconds = minutes * 60 + seconds;

            console.log(
              `Impact time in seconds: ${impactTimeInSeconds}, Total recording duration: ${finalDuration}s`
            );

            // If video is very short or impact time is invalid, just show the full video
            if (finalDuration < 1 || impactTimeInSeconds < 0) {
              console.log(
                'Video too short or invalid impact time, using full video'
              );
              setRecordedVideoBlob(fullVideoBlob);
              setTrimmedVideoBlob(null);
              setIsProcessing(false);
              prepareVideoForPlayback(fullVideoBlob);

              toast({
                title: 'Video Processing',
                description:
                  'Video is too short to trim, showing full recording',
                variant: 'default',
              });
              return;
            }

            // If impact time is greater than duration, cap it
            let effectiveImpactTime = impactTimeInSeconds;
            if (impactTimeInSeconds > finalDuration) {
              console.warn(
                `Impact time ${impactTimeInSeconds}s exceeds video duration ${finalDuration}s`
              );
              // Place impact at 75% of the video
              effectiveImpactTime = finalDuration * 0.75;
              console.log(`Adjusted impact time to ${effectiveImpactTime}s`);
            }

            // Calculate trim range with guardrails
            // UPDATED: Adjusted timing to ensure we capture more before and after impact
            let startTime = Math.max(0, effectiveImpactTime - 4); // Changed from 5 to 4 seconds before impact
            let endTime = Math.min(effectiveImpactTime + 2, finalDuration); // Changed from 1.5 to 2 seconds after impact

            // Ensure we have a valid range (at least 0.5 seconds)
            if (startTime >= endTime || endTime - startTime < 0.5) {
              if (finalDuration < 0.5) {
                // Video too short, use full video
                console.log(
                  'Video too short for meaningful trim, using full video'
                );
                setRecordedVideoBlob(fullVideoBlob);
                setTrimmedVideoBlob(null);
                setIsProcessing(false);
                prepareVideoForPlayback(fullVideoBlob);
                return;
              }

              // Adjust for a valid range
              console.log('Adjusting for valid trim range');
              startTime = 0;
              endTime = Math.min(finalDuration, 2); // Changed from 1.5 to 2 seconds
            }

            console.log(
              `Trimming video from ${startTime}s to ${endTime}s (impact at ${effectiveImpactTime}s)`
            );

            try {
              // Store full video first
              setRecordedVideoBlob(fullVideoBlob);

              // Attempt trimming
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

              // Set trimmed blob and update UI
              setTrimmedVideoBlob(trimmedBlob);
              setIsProcessing(false);
              prepareVideoForPlayback(trimmedBlob);

              toast({
                title: 'Video Processed',
                description: `Auto-trimmed around ${storedImpactTime === impactTimeLabel ? 'detected impact' : 'approximate impact point'}`,
                variant: 'default',
              });
            } catch (error) {
              console.error('Error trimming video:', error);
              // Fallback to full video
              setRecordedVideoBlob(fullVideoBlob);
              setTrimmedVideoBlob(null);
              setIsProcessing(false);
              prepareVideoForPlayback(fullVideoBlob);

              toast({
                title: 'Trimming Failed',
                description: 'Using the full video instead',
                variant: 'destructive',
              });
            }
          } else {
            // No impact detected, use full video
            console.log('No impact detected, using full video');
            setRecordedVideoBlob(fullVideoBlob);
            setTrimmedVideoBlob(null);
            setIsProcessing(false);
            prepareVideoForPlayback(fullVideoBlob);
          }
        } catch (error) {
          console.error('Error processing video:', error);
          // Fallback to full video
          setRecordedVideoBlob(fullVideoBlob);
          setTrimmedVideoBlob(null);
          setIsProcessing(false);
          prepareVideoForPlayback(fullVideoBlob);

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
      const debugDiv: HTMLDivElement = document.createElement('div');
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
      const meterDiv: HTMLDivElement = document.createElement('div');
      meterDiv.style.position = 'absolute';
      meterDiv.style.top = '110px';
      meterDiv.style.left = '10px';
      meterDiv.style.right = '10px';
      meterDiv.style.height = '20px';
      meterDiv.style.backgroundColor = '#333';
      meterDiv.style.zIndex = '1000';

      const levelIndicator: HTMLDivElement = document.createElement('div');
      levelIndicator.style.height = '100%';
      levelIndicator.style.width = '0%';
      levelIndicator.style.backgroundColor = 'green';
      meterDiv.appendChild(levelIndicator);
      document.body.appendChild(meterDiv);

      // Create a simple audio context
      const AudioContextClass: typeof AudioContext =
        window.AudioContext ||
        ((window as any).webkitAudioContext as typeof AudioContext);

      if (!AudioContextClass) {
        console.error('AudioContext not supported');
        debugDiv.innerText = 'Error: AudioContext not supported';
        return;
      }

      const audioContext: AudioContext = new AudioContextClass();
      audioContextRef.current = audioContext;

      // Get audio tracks from stream
      const audioTracks: MediaStreamTrack[] =
        streamRef.current.getAudioTracks();

      if (audioTracks.length === 0) {
        console.error('No audio tracks in stream');
        debugDiv.innerText = 'Error: No audio tracks found';
        return;
      }

      console.log(`Using audio track: ${audioTracks[0].label}`);
      debugDiv.innerText = `Found audio: ${audioTracks[0].label}`;

      // Create audio source
      const source: MediaStreamAudioSourceNode =
        audioContext.createMediaStreamSource(streamRef.current);

      // Create analyzer node for frequency analysis - still useful but less strict
      const analyzer: AnalyserNode = audioContext.createAnalyser();
      analyzer.fftSize = 2048;
      source.connect(analyzer);

      // Create a script processor for direct access to audio data
      const processor: ScriptProcessorNode = audioContext.createScriptProcessor(
        2048,
        1,
        1
      );
      source.connect(processor);
      processor.connect(audioContext.destination);

      // BALANCED PARAMETERS WITH SLIGHTLY REDUCED SENSITIVITY
      const CALIBRATION_FRAMES: number = 45; // Medium-length calibration (45 frames)
      const VOLUME_HISTORY_SIZE: number = 15; // Medium history size
      const IMMEDIATE_HISTORY_SIZE: number = 5;

      // Frequency analysis for golf driver impact (slightly narrower range)
      const LOW_FREQ: number = 1900; // Adjusted from 1800 Hz
      const HIGH_FREQ: number = 5200; // Adjusted from 5500 Hz

      // These values will be adjusted during calibration
      let baselineVolume: number = 0;
      let baselineFrequencyProfile: number[] = new Array(
        analyzer.frequencyBinCount
      ).fill(0);
      let calibrationFrames: number = 0;
      let threshold: number = 0.05; // Starting threshold
      let maxVolume: number = 0;
      let isPeaking: boolean = false;
      let peakTime: number = 0;
      let consecutiveFramesAboveThreshold: number = 0;
      const REQUIRED_CONSECUTIVE_FRAMES: number = 1; // More sensitive - only require 1 frame

      // Track volume over time for better detection
      const volumeHistory: number[] = new Array(VOLUME_HISTORY_SIZE).fill(0);
      const immediateHistory: number[] = new Array(IMMEDIATE_HISTORY_SIZE).fill(
        0
      );

      // Frequency data arrays
      const frequencyData: Uint8Array = new Uint8Array(
        analyzer.frequencyBinCount
      );

      // Function to calculate volume (RMS) from audio data
      const calculateVolume = (input: Float32Array): number => {
        let sum: number = 0;
        for (let i: number = 0; i < input.length; i++) {
          sum += input[i] * input[i];
        }
        return Math.sqrt(sum / input.length);
      };

      // Function to check if a sound matches driver impact frequency profile
      // More lenient frequency profile matching
      const matchesDriverProfile = (): boolean => {
        analyzer.getByteFrequencyData(frequencyData);

        // Calculate frequency indices for our target range
        const lowIndex: number = Math.floor(
          (LOW_FREQ * analyzer.frequencyBinCount) / audioContext.sampleRate
        );
        const highIndex: number = Math.ceil(
          (HIGH_FREQ * analyzer.frequencyBinCount) / audioContext.sampleRate
        );

        // Calculate energy in our target frequency range vs overall energy
        let targetEnergy: number = 0;
        let totalEnergy: number = 0;

        for (let i: number = 0; i < frequencyData.length; i++) {
          const value: number = frequencyData[i] / 255; // Normalize to 0-1
          totalEnergy += value * value;

          if (i >= lowIndex && i <= highIndex) {
            targetEnergy += value * value;
          }
        }

        // Driver impacts should have significant energy in our target range
        // Lower ratio requirement from 0.4 to 0.3 (30% instead of 40%)
        const ratio: number = totalEnergy > 0 ? targetEnergy / totalEnergy : 0;

        // Debug frequency every 10 frames for performance
        if (calibrationFrames % 10 === 0) {
          console.log(`Frequency match ratio: ${(ratio * 100).toFixed(1)}%`);
        }

        return ratio > 0.33; // Adjusted from 0.3 to 0.33 - requiring a stronger frequency match
      };

      // Function to update history arrays
      const updateHistories = (volumeLevel: number): void => {
        // Update overall history
        volumeHistory.push(volumeLevel);
        if (volumeHistory.length > VOLUME_HISTORY_SIZE) {
          volumeHistory.shift(); // Remove oldest value
        }

        // Update immediate history for spike detection
        immediateHistory.push(volumeLevel);
        if (immediateHistory.length > IMMEDIATE_HISTORY_SIZE) {
          immediateHistory.shift();
        }
      };

      // Function to check for significant spike relative to recent average
      // More sensitive spike detection
      const isSignificantSpike = (volumeLevel: number): boolean => {
        const recentAvg: number =
          immediateHistory.reduce((a, b) => a + b, 0) / immediateHistory.length;

        // Adjusted spike ratio to 3.0x (slightly less sensitive than 2.8x)
        return volumeLevel > recentAvg * 3.0;
      };

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
            analyzer.disconnect();
            source.disconnect();
            document.body.removeChild(debugDiv);
            document.body.removeChild(meterDiv);
          } catch (err) {
            // Ignore cleanup errors
          }
          return;
        }

        // Get audio data
        const input: Float32Array = e.inputBuffer.getChannelData(0);
        const volumeLevel: number = calculateVolume(input);

        // Update histories with current volume
        updateHistories(volumeLevel);

        // CALIBRATION PHASE
        if (calibrationFrames < CALIBRATION_FRAMES) {
          // Update baseline volume
          baselineVolume =
            (baselineVolume * calibrationFrames + volumeLevel) /
            (calibrationFrames + 1);

          // Also capture frequency profile during calibration
          if (calibrationFrames % 5 === 0) {
            analyzer.getByteFrequencyData(frequencyData);
            for (let i: number = 0; i < frequencyData.length; i++) {
              baselineFrequencyProfile[i] =
                (baselineFrequencyProfile[i] * (calibrationFrames / 5) +
                  frequencyData[i]) /
                (calibrationFrames / 5 + 1);
            }
          }

          calibrationFrames++;

          // After calibration, set threshold higher than baseline
          if (calibrationFrames === CALIBRATION_FRAMES) {
            // Slightly higher threshold for less sensitivity
            threshold = Math.max(0.06, baselineVolume * 8.5);

            console.log(
              `Calibration complete - Baseline: ${baselineVolume.toFixed(4)}, Threshold: ${threshold.toFixed(4)}`
            );
            debugDiv.innerText = `Ready! Baseline: ${baselineVolume.toFixed(4)}, Threshold: ${threshold.toFixed(4)}`;

            // Show a toast notification so the user knows calibration is done
            toast({
              title: 'Sound Detection Ready',
              description: 'Golf impact sound detection is active',
              variant: 'default',
            });
          }
        }
        // DETECTION PHASE
        else {
          // Update debug display
          const percent: number = Math.min(100, Math.floor(volumeLevel * 1000));
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

          // Check if volume exceeds threshold
          if (volumeLevel > threshold) {
            consecutiveFramesAboveThreshold++;
          } else {
            consecutiveFramesAboveThreshold = 0;
          }

          // Multi-factor detection - more balanced approach:
          // Volume must be above threshold (always required)
          // Plus at least one of the following additional conditions:
          // 1. Must be a significant spike compared to recent history
          // 2. Should match frequency profile of a driver impact
          const meetsVolumeRequirement: boolean =
            consecutiveFramesAboveThreshold >= REQUIRED_CONSECUTIVE_FRAMES;
          const meetsSpikeCriteria: boolean = isSignificantSpike(volumeLevel);
          const meetsFrequencyCriteria: boolean = matchesDriverProfile();

          // Detect impact when volume requirement is met plus at least one other criterion
          // This means we need volume + (frequency OR spike), not all three like before
          if (
            meetsVolumeRequirement &&
            (meetsSpikeCriteria || meetsFrequencyCriteria) &&
            !isPeaking
          ) {
            console.log(
              `🔊 IMPACT SOUND DETECTED! Level: ${volumeLevel.toFixed(4)}, Spike: ${meetsSpikeCriteria ? 'YES' : 'NO'}, Frequency: ${meetsFrequencyCriteria ? 'YES' : 'NO'}`
            );
            isPeaking = true;
            peakTime = Date.now();

            // Record the time of impact
            const impactTime: number =
              (Date.now() - startTimeRef.current) / 1000;
            const formattedTime: string = formatDuration(impactTime);
            console.log(
              `Setting impact time to ${impactTime}s (formatted: ${formattedTime})`
            );
            console.log(
              `Current recording duration: ${currentDurationRef.current}s (state: ${recordingDuration}s)`
            );

            // Store impact time in multiple places for redundancy
            setImpactTimeLabel(formattedTime);
            globalImpactTime = formattedTime;
            window.lastImpactTime = formattedTime;
            lastImpactTimeRef.current = formattedTime;

            // Update current duration reference to ensure we have accurate timing
            currentDurationRef.current = impactTime;

            console.log(
              `*** IMPACT DETECTED *** Time: ${formattedTime}, storing globally`
            );

            // Visual feedback
            levelIndicator.style.backgroundColor = 'red';
            levelIndicator.style.width = '100%';
            debugDiv.innerText = `🎯 IMPACT DETECTED! Level: ${volumeLevel.toFixed(4)} at ${formattedTime}`;
            debugDiv.style.backgroundColor = 'rgba(255,0,0,0.7)';

            // Show toast notification
            toast({
              title: 'Impact Detected!',
              description: `Sound detected at ${formattedTime}. Recording will continue for a moment...`,
              variant: 'default',
            });

            // Schedule auto-stop after a delay to ensure we capture the full swing follow-through
            if (autoStopTimeoutRef.current) {
              clearTimeout(autoStopTimeoutRef.current);
            }

            // Stop recording 2.5 seconds after impact to capture follow-through
            autoStopTimeoutRef.current = setTimeout(() => {
              console.log(
                `Auto-stop triggered. Impact time was: ${globalImpactTime}`
              );
              if (
                mediaRecorderRef.current &&
                mediaRecorderRef.current.state !== 'inactive'
              ) {
                stopRecording();
              }
              // Clean up
              try {
                processor.disconnect();
                analyzer.disconnect();
                source.disconnect();
                document.body.removeChild(debugDiv);
                document.body.removeChild(meterDiv);
              } catch (err) {
                // Ignore cleanup errors
              }
            }, 2500);

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
                  <VideoUploadButton
                    videoBlob={trimmedVideoBlob || recordedVideoBlob}
                    cameraFacing={cameraFacing}
                    onProcessingComplete={handleProcessingComplete}
                    useDirectUpload={true}
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
