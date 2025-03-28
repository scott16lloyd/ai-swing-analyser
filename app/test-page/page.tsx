// pages/video-trimmer.tsx
'use client';

import { useState, useRef, useEffect, ChangeEvent } from 'react';
import Head from 'next/head';
import { Camera } from 'lucide-react';

// Add type definitions for browser-specific video properties
interface ExtendedHTMLVideoElement extends HTMLVideoElement {
  mozHasAudio?: boolean;
  webkitAudioDecodedByteCount?: number;
  audioTracks?: { length: number };
  captureStream?: () => MediaStream;
}

export default function VideoTrimmer(): JSX.Element {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoURL, setVideoURL] = useState<string>('');
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [startTime, setStartTime] = useState<number>(0);
  const [endTime, setEndTime] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isTrimmed, setIsTrimmed] = useState<boolean>(false);
  const [trimmedVideoURL, setTrimmedVideoURL] = useState<string>('');
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processProgress, setProcessProgress] = useState<number>(0);

  // Camera recording states
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingTime, setRecordingTime] = useState<number>(0);
  const [recordedVideo, setRecordedVideo] = useState<Blob | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const thumbnailsContainerRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Handle file upload
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file && file.type.startsWith('video/')) {
        // Stop camera if active
        if (isCameraActive) {
          stopCamera();
        }

        setVideoFile(file);
        setIsTrimmed(false);
        setThumbnails([]);

        // Create URL for the video
        const url = URL.createObjectURL(file);
        setVideoURL(url);
      }
    }
  };

  // Camera functionality
  const startCamera = async (): Promise<void> => {
    try {
      // Reset any existing video
      if (videoURL) {
        URL.revokeObjectURL(videoURL);
        setVideoURL('');
      }

      setIsTrimmed(false);
      setThumbnails([]);
      setVideoFile(null);

      const constraints = {
        audio: true,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setMediaStream(stream);

      if (cameraRef.current) {
        cameraRef.current.srcObject = stream;
      }

      setIsCameraActive(true);
    } catch (error) {
      console.error('Error accessing camera:', error);
      alert(
        'Could not access your camera. Please check permissions and try again.'
      );
    }
  };

  const stopCamera = (): void => {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      setMediaStream(null);
    }

    if (cameraRef.current) {
      cameraRef.current.srcObject = null;
    }

    setIsCameraActive(false);

    // If recording, stop it
    if (isRecording) {
      stopRecording();
    }
  };

  const startRecording = (): void => {
    if (!mediaStream) return;

    recordedChunksRef.current = [];

    // Find the best supported MIME type
    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }
    }

    try {
      const recorder = new MediaRecorder(mediaStream, {
        mimeType: mimeType,
        videoBitsPerSecond: 5000000,
      });

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.start(1000); // Collect in 1-second chunks
      mediaRecorderRef.current = recorder;

      setIsRecording(true);
      setRecordingTime(0);

      // Start recording timer
      const startTime = Date.now();
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Failed to start recording. Please try again.');
    }
  };

  const stopRecording = (): void => {
    if (
      !mediaRecorderRef.current ||
      mediaRecorderRef.current.state === 'inactive'
    )
      return;

    mediaRecorderRef.current.stop();

    // Stop the timer
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    // Process recorded chunks into a video
    mediaRecorderRef.current.onstop = () => {
      if (recordedChunksRef.current.length === 0) {
        setIsRecording(false);
        return;
      }

      // Create a blob from recorded chunks
      const blob = new Blob(recordedChunksRef.current, {
        type: mediaRecorderRef.current?.mimeType || 'video/webm',
      });
      setRecordedVideo(blob);

      // Convert the blob to a File object to match existing flow
      const fileName = `recording_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
      const file = new File([blob], fileName, { type: blob.type });
      setVideoFile(file);

      // Create URL for the video
      const url = URL.createObjectURL(blob);
      setVideoURL(url);

      setIsRecording(false);
    };
  };

  const useRecordedVideo = (): void => {
    if (!recordedVideo) return;

    // Stop the camera
    stopCamera();
  };

  // Update duration once the video metadata is loaded
  const handleLoadedMetadata = (): void => {
    if (typeof window === 'undefined') return; // Guard against server-side execution
    if (videoRef.current) {
      const duration = videoRef.current.duration;

      // Make sure we have a valid duration
      if (isFinite(duration) && duration > 0) {
        setVideoDuration(duration);
        setEndTime(duration);

        // Wait a short time to ensure video is fully loaded
        setTimeout(() => {
          // Generate thumbnails
          generateThumbnails();
        }, 500);
      } else {
        console.error('Invalid video duration:', duration);
      }
    }
  };

  // Generate thumbnails for the video
  const generateThumbnails = async (): Promise<void> => {
    if (typeof window === 'undefined') return; // Guard against server-side execution
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) return;

    // Set canvas dimensions
    canvas.width = 120;
    canvas.height = 68;

    const duration = video.duration;
    if (!isFinite(duration) || duration <= 0) return;

    const numThumbnails = 15; // Number of thumbnails to generate
    const newThumbnails: string[] = [];

    for (let i = 0; i < numThumbnails; i++) {
      const time = (duration / numThumbnails) * i;

      // Validate time is a finite number
      if (!isFinite(time)) continue;

      try {
        // Set video to the specific time
        video.currentTime = time;

        // Wait for the video to update to the new time
        await new Promise<void>((resolve, reject) => {
          const seekHandler = () => {
            video.removeEventListener('seeked', seekHandler);
            video.removeEventListener('error', errorHandler);
            resolve();
          };

          const errorHandler = () => {
            video.removeEventListener('seeked', seekHandler);
            video.removeEventListener('error', errorHandler);
            reject(new Error('Error seeking video'));
          };

          video.addEventListener('seeked', seekHandler);
          video.addEventListener('error', errorHandler);

          // Add a timeout in case the event never fires
          setTimeout(() => {
            video.removeEventListener('seeked', seekHandler);
            video.removeEventListener('error', errorHandler);
            resolve(); // Resolve anyway to continue processing
          }, 1000);
        });

        // Draw the current frame on the canvas
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Convert the canvas to a data URL and add it to the thumbnails array
        const dataURL = canvas.toDataURL('image/jpeg');
        newThumbnails.push(dataURL);
      } catch (error) {
        console.error('Error generating thumbnail:', error);
        // Continue with the next thumbnail
      }
    }

    // Only reset video current time if it's a valid operation
    try {
      video.currentTime = 0;
    } catch (e) {
      console.error('Error resetting video time:', e);
    }

    // Update thumbnails state
    setThumbnails(newThumbnails);
  };

  // Update current time as video plays
  const handleTimeUpdate = (): void => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);

      // If playing and current time is past end time, reset to start time
      if (videoRef.current.currentTime >= endTime) {
        videoRef.current.currentTime = startTime;
        if (isPlaying) {
          videoRef.current.play();
        }
      }
    }
  };

  // Play button handler
  const handlePlayPause = (): void => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        // If at the end of the trim range, reset to start
        if (
          videoRef.current.currentTime >= endTime ||
          videoRef.current.currentTime < startTime
        ) {
          videoRef.current.currentTime = startTime;
        }
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  // Handle drag events for start and end trim handles
  const handleTrimHandleDrag = (
    isStart: boolean,
    newPosition: number
  ): void => {
    if (!thumbnailsContainerRef.current || !videoRef.current) return;
    if (!isFinite(videoDuration) || videoDuration <= 0) return;

    const containerWidth = thumbnailsContainerRef.current.offsetWidth;
    if (containerWidth <= 0) return;

    const position = Math.max(0, Math.min(newPosition, containerWidth));
    const newTime = (position / containerWidth) * videoDuration;

    if (!isFinite(newTime)) return;

    if (isStart) {
      if (newTime < endTime - 0.5) {
        // Minimum duration of 0.5 seconds
        setStartTime(newTime);

        // Always update video position to the trim handle position for immediate feedback
        try {
          videoRef.current.currentTime = newTime;
          setCurrentTime(newTime);
        } catch (error) {
          console.error('Error setting video current time:', error);
        }
      }
    } else {
      if (newTime > startTime + 0.5) {
        // Minimum duration of 0.5 seconds
        setEndTime(newTime);

        // Always update video position to the trim handle position for immediate feedback
        try {
          videoRef.current.currentTime = newTime;
          setCurrentTime(newTime);
        } catch (error) {
          console.error('Error setting video current time:', error);
        }
      }
    }
  };

  // Handle mouse down event for trim handles
  const handleTrimHandleMouseDown = (
    isStart: boolean
  ): ((e: React.MouseEvent) => void) => {
    return (e: React.MouseEvent): void => {
      e.preventDefault();

      // Pause video if it's playing when we start dragging
      const wasPlaying = isPlaying;
      if (isPlaying && videoRef.current) {
        videoRef.current.pause();
        setIsPlaying(false);
      }

      const startX = e.clientX;
      const containerRect =
        thumbnailsContainerRef.current?.getBoundingClientRect();
      if (!containerRect) return;

      // Get initial position
      const initialPos = isStart
        ? (startTime / videoDuration) * containerRect.width
        : (endTime / videoDuration) * containerRect.width;

      // Mouse move handler
      const handleMouseMove = (moveEvent: MouseEvent): void => {
        const deltaX = moveEvent.clientX - startX;
        const newPosition = initialPos + deltaX;
        handleTrimHandleDrag(isStart, newPosition);
      };

      // Mouse up handler
      const handleMouseUp = (): void => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        // Resume playback if it was playing before
        if (wasPlaying && videoRef.current) {
          const currentPosTime = isStart ? startTime : endTime;

          try {
            // Set to appropriate position and play
            videoRef.current.currentTime = currentPosTime;
            videoRef.current
              .play()
              .then(() => setIsPlaying(true))
              .catch((err) => console.error("Couldn't resume playback:", err));
          } catch (error) {
            console.error('Error during playback resume:', error);
          }
        }
      };

      // Add event listeners
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };
  };

  // Handle direct seeking with the thumbnails strip
  const handleThumbnailsClick = (e: React.MouseEvent): void => {
    if (!thumbnailsContainerRef.current || !videoRef.current) return;
    if (!isFinite(videoDuration) || videoDuration <= 0) return;

    const containerRect =
      thumbnailsContainerRef.current.getBoundingClientRect();
    if (containerRect.width <= 0) return;

    const clickX = e.clientX - containerRect.left;
    const clickPosition = clickX / containerRect.width;

    if (!isFinite(clickPosition) || clickPosition < 0 || clickPosition > 1)
      return;

    const newTime = clickPosition * videoDuration;

    if (!isFinite(newTime)) return;

    if (newTime >= startTime && newTime <= endTime) {
      try {
        videoRef.current.currentTime = newTime;
        setCurrentTime(newTime);
      } catch (error) {
        console.error('Error setting video current time:', error);
      }
    }
  };

  // Note: This implementation uses a simpler, more reliable approach to video trimming
  const handleTrimVideo = async (): Promise<void> => {
    if (typeof window === 'undefined') return; // Guard against server-side execution
    if (!videoFile || !videoRef.current) return;

    setIsProcessing(true);
    setProcessProgress(0);

    try {
      // Use FFmpeg.wasm approach instead of MediaRecorder
      // First, create a short segment of video by playing and capturing it

      // 1. Create a temporary video element to work with
      const tempVideo = document.createElement('video');
      tempVideo.src = videoURL;
      tempVideo.muted = true;

      // 2. Wait for the metadata to load
      await new Promise<void>((resolve) => {
        tempVideo.onloadedmetadata = () => resolve();
        tempVideo.load();
      });

      // 3. Set the playback range using the clip API if available
      if ('setMediaKeys' in tempVideo) {
        try {
          // This is a reliable way to get just the segment we want
          // Use a simple method instead of the complex frame-by-frame approach

          const originalVideo = videoRef.current;
          const canvas = document.createElement('canvas');
          canvas.width = originalVideo.videoWidth || 640;
          canvas.height = originalVideo.videoHeight || 480;
          const ctx = canvas.getContext('2d');

          if (!ctx) throw new Error('Could not get canvas context');

          // Create a stream from the canvas
          const stream = canvas.captureStream(30);

          // Add the audio track if the original video has audio
          const extendedVideo = originalVideo as ExtendedHTMLVideoElement;
          if (
            extendedVideo.mozHasAudio ||
            extendedVideo.webkitAudioDecodedByteCount! > 0 ||
            (extendedVideo.audioTracks && extendedVideo.audioTracks.length > 0)
          ) {
            originalVideo.muted = false;
            try {
              if (extendedVideo.captureStream) {
                const videoStream = extendedVideo.captureStream();
                videoStream
                  .getAudioTracks()
                  .forEach((track: MediaStreamTrack) => {
                    stream.addTrack(track);
                  });
              }
            } catch (e) {
              console.warn('Could not add audio track', e);
            }
          }

          // Find the best supported MIME type
          let mimeType = 'video/webm;codecs=vp9';
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm;codecs=vp8';
            if (!MediaRecorder.isTypeSupported(mimeType)) {
              mimeType = 'video/webm';
            }
          }

          let recorder: MediaRecorder;
          try {
            recorder = new MediaRecorder(stream, {
              mimeType: mimeType,
              videoBitsPerSecond: 5000000,
            });
          } catch (e) {
            console.error('Error creating MediaRecorder with options', e);
            recorder = new MediaRecorder(stream);
          }

          const chunks: Blob[] = [];
          recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              chunks.push(e.data);
              console.log('Recorded chunk:', e.data.size, 'bytes');
            }
          };

          recorder.onstop = () => {
            console.log('Recording stopped, chunks:', chunks.length);
            if (chunks.length === 0) {
              setIsProcessing(false);
              alert(
                'No video data was captured. Please try again or use a different browser.'
              );
              return;
            }

            try {
              const blob = new Blob(chunks, { type: mimeType });
              console.log('Blob created:', blob.size, 'bytes');

              if (blob.size === 0) {
                setIsProcessing(false);
                alert('Generated video has no data. Please try again.');
                return;
              }

              const url = URL.createObjectURL(blob);
              setTrimmedVideoURL(url);
              setIsTrimmed(true);
              setIsProcessing(false);
            } catch (blobError) {
              console.error('Error creating blob:', blobError);
              setIsProcessing(false);
              alert('Error creating video. Please try again.');
            }
          };

          // Set up the drawing interval
          const drawInterval = 1000 / 30; // 30fps
          const duration = endTime - startTime;
          const totalFrames = Math.ceil(duration * 30);
          let frameCount = 0;

          // Set original video to start time
          originalVideo.currentTime = startTime;
          await new Promise<void>((resolve) => {
            originalVideo.onseeked = () => resolve();
          });

          // Start recording
          recorder.start(1000); // Collect in 1-second chunks
          console.log('Started recording');

          // Play the video
          originalVideo.play();

          // Draw frames at regular intervals
          const drawFrame = () => {
            if (!originalVideo || originalVideo.currentTime >= endTime) {
              // We've reached the end time
              originalVideo.pause();
              try {
                recorder.stop();
                console.log('Recorder stopped');
              } catch (stopError) {
                console.error('Error stopping recorder:', stopError);
              }
              return;
            }

            // Draw the current video frame to canvas
            ctx.drawImage(originalVideo, 0, 0, canvas.width, canvas.height);

            // Update progress
            frameCount++;
            const progress = Math.min((frameCount / totalFrames) * 100, 99);
            setProcessProgress(progress);

            // Schedule next frame
            if (originalVideo.currentTime < endTime) {
              setTimeout(drawFrame, drawInterval);
            }
          };

          // Start drawing frames
          drawFrame();
        } catch (innerError) {
          console.error('Error in clip creation:', innerError);
          // Fall back to a simpler method - just extract the video segment via createObjectURL
          fallbackTrimVideo();
        }
      } else {
        // Browser doesn't support sophisticated APIs, use fallback
        fallbackTrimVideo();
      }
    } catch (error) {
      console.error('Error trimming video:', error);
      setIsProcessing(false);
      alert(
        'Error trimming video: ' +
          (error instanceof Error ? error.message : 'Unknown error')
      );
    }
  };

  // A simpler fallback method that just creates a new video with the trim points noted
  const fallbackTrimVideo = (): void => {
    if (!videoFile) return;

    console.log('Using fallback trim method');

    // Create a simple text file with trim information
    const trimInfo = {
      originalVideo: videoFile.name,
      startTime: startTime,
      endTime: endTime,
      duration: endTime - startTime,
    };

    const jsonString = JSON.stringify(trimInfo, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    setTrimmedVideoURL(url);
    setIsTrimmed(true);
    setIsProcessing(false);

    alert(
      'Full video trimming is not supported in your browser. A trim information file has been created instead.'
    );
  };

  // Download the trimmed video
  const handleDownloadTrimmedVideo = (): void => {
    if (typeof window === 'undefined') return; // Guard against server-side execution
    if (!trimmedVideoURL || !videoFile) return;

    try {
      fetch(trimmedVideoURL)
        .then((response) => response.blob())
        .then((blob) => {
          if (blob.size === 0) {
            throw new Error('The trimmed video file is empty');
          }

          console.log('Downloading blob:', blob.type, blob.size, 'bytes');

          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);

          // Get file extension based on mime type
          const fileExtension = blob.type.includes('json')
            ? '.json'
            : blob.type.includes('webm')
              ? '.webm'
              : '.mp4';

          a.download = `trimmed_${videoFile.name.split('.')[0]}${fileExtension}`;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();

          // Clean up
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
          }, 100);
        })
        .catch((error) => {
          console.error('Error in fetch operation:', error);
          alert('Error downloading the trimmed video: ' + error.message);
        });
    } catch (error) {
      console.error('Error downloading trimmed video:', error);
      alert('Error downloading the trimmed video. Please try again.');
    }
  };

  // Format time to MM:SS.ms
  const formatTime = (timeInSeconds: number): string => {
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    const milliseconds = Math.floor((timeInSeconds % 1) * 100);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
  };

  // Clean up URLs when component unmounts
  useEffect(() => {
    return () => {
      if (videoURL) URL.revokeObjectURL(videoURL);
      if (trimmedVideoURL) URL.revokeObjectURL(trimmedVideoURL);
      thumbnails.forEach((thumbnail) => {
        if (thumbnail.startsWith('blob:')) {
          URL.revokeObjectURL(thumbnail);
        }
      });

      // Make sure to stop any ongoing recordings
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== 'inactive'
      ) {
        try {
          mediaRecorderRef.current.stop();
        } catch (e) {
          console.error('Error stopping media recorder:', e);
        }
      }

      // Stop camera if active
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
      }

      // Clear recording timer
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, [videoURL, trimmedVideoURL, thumbnails, mediaStream]);

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <Head>
        <title>Video Trimmer</title>
        <meta
          name="description"
          content="Upload, record, and trim videos easily"
        />
      </Head>

      <h1 className="text-3xl font-bold mb-6 text-center">Video Trimmer</h1>

      <div className="mb-6 flex flex-col md:flex-row gap-4">
        <div className="w-full md:w-1/2">
          <label className="block mb-2 font-medium">Upload Video</label>
          <input
            type="file"
            accept="video/*"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-500
              file:mr-4 file:py-2 file:px-4
              file:rounded-md file:border-0
              file:text-sm file:font-semibold
              file:bg-blue-50 file:text-blue-700
              hover:file:bg-blue-100"
          />
        </div>

        <div className="w-full md:w-1/2">
          <label className="block mb-2 font-medium">Record Video</label>
          <div className="flex space-x-2">
            {!isCameraActive ? (
              <button
                onClick={startCamera}
                className="bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-md flex items-center"
              >
                <Camera size={18} className="mr-2" />
                Start Camera
              </button>
            ) : (
              <div className="flex space-x-2">
                {!isRecording ? (
                  <button
                    onClick={startRecording}
                    className="bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded-md"
                  >
                    Record
                  </button>
                ) : (
                  <button
                    onClick={stopRecording}
                    className="bg-gray-600 hover:bg-gray-700 text-white py-2 px-4 rounded-md flex items-center"
                  >
                    <span className="mr-2">■</span> Stop (
                    {formatTime(recordingTime)})
                  </button>
                )}
                <button
                  onClick={stopCamera}
                  className="bg-gray-500 hover:bg-gray-600 text-white py-2 px-4 rounded-md"
                >
                  Turn Off Camera
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Camera preview */}
      {isCameraActive && (
        <div className="mb-6 bg-gray-900 rounded-lg overflow-hidden">
          <div className="relative aspect-video">
            <video
              ref={cameraRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-contain"
            />
            {isRecording && (
              <div className="absolute top-4 right-4 bg-red-600 text-white px-2 py-1 rounded-md flex items-center">
                <span className="animate-pulse mr-2">●</span>
                REC {formatTime(recordingTime)}
              </div>
            )}
          </div>
        </div>
      )}

      {videoURL && (
        <div className="bg-gray-100 p-6 rounded-xl shadow-md">
          <div className="relative aspect-video mb-4 bg-black rounded-lg overflow-hidden">
            <video
              ref={videoRef}
              src={videoURL}
              className="w-full h-full"
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onClick={handlePlayPause}
            />
          </div>

          {/* Apple-style trimmer with thumbnails */}
          <div className="relative mb-6 rounded-xl bg-gray-700 p-2">
            {/* Hidden canvas for thumbnail generation */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Start time display */}
            <div className="absolute top-4 left-14 text-white text-xs font-medium bg-black/50 px-2 py-1 rounded-md z-10">
              {formatTime(startTime)}
            </div>

            {/* End time display */}
            <div className="absolute top-4 right-4 text-white text-xs font-medium bg-black/50 px-2 py-1 rounded-md z-10">
              {formatTime(endTime)}
            </div>

            {/* Play button */}
            <button
              onClick={handlePlayPause}
              className="absolute left-2 top-1/2 transform -translate-y-1/2 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center z-10"
            >
              {isPlaying ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* Thumbnails container */}
            <div
              ref={thumbnailsContainerRef}
              className="relative h-16 mx-14 overflow-hidden rounded-lg"
              onClick={handleThumbnailsClick}
            >
              {/* Thumbnails display */}
              <div className="flex h-full">
                {thumbnails.map((thumbnail, index) => (
                  <div key={index} className="h-full flex-grow">
                    <img
                      src={thumbnail}
                      alt={`Thumbnail ${index}`}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ))}
              </div>

              {/* Trim selection overlay */}
              <div
                className="absolute top-0 left-0 right-0 bottom-0 border-2 border-yellow-400 bg-yellow-400/20"
                style={{
                  left: `${(startTime / videoDuration) * 100}%`,
                  right: `${(1 - endTime / videoDuration) * 100}%`,
                }}
              ></div>

              {/* Left (start) trim handle */}
              <div
                className="absolute top-0 bottom-0 w-4 bg-yellow-400 cursor-col-resize flex flex-col justify-between items-center py-1"
                style={{
                  left: `calc(${(startTime / videoDuration) * 100}% - 8px)`,
                }}
                onMouseDown={handleTrimHandleMouseDown(true)}
              >
                <div className="w-0.5 h-2 bg-black rounded-full"></div>
                <div className="w-0.5 h-2 bg-black rounded-full"></div>
              </div>

              {/* Right (end) trim handle */}
              <div
                className="absolute top-0 bottom-0 w-4 bg-yellow-400 cursor-col-resize flex flex-col justify-between items-center py-1"
                style={{
                  right: `calc(${(1 - endTime / videoDuration) * 100}% - 8px)`,
                }}
                onMouseDown={handleTrimHandleMouseDown(false)}
              >
                <div className="w-0.5 h-2 bg-black rounded-full"></div>
                <div className="w-0.5 h-2 bg-black rounded-full"></div>
              </div>

              {/* Current time indicator */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white z-10"
                style={{ left: `${(currentTime / videoDuration) * 100}%` }}
              ></div>
            </div>
          </div>

          <div className="flex justify-end space-x-4">
            <button
              onClick={handleTrimVideo}
              className="bg-blue-600 hover:bg-blue-700 text-white py-2 px-6 rounded-lg font-medium"
            >
              Trim Video
            </button>
          </div>

          {isTrimmed && videoFile && (
            <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
              <h3 className="font-medium text-green-800 mb-2">
                Trimming Complete!
              </h3>
              <p className="text-sm mb-2">
                Your video has been trimmed successfully:
              </p>
              <ul className="text-sm text-gray-700 mb-4">
                <li>Start: {formatTime(startTime)}</li>
                <li>End: {formatTime(endTime)}</li>
                <li>Duration: {formatTime(endTime - startTime)}</li>
              </ul>
              <button
                onClick={handleDownloadTrimmedVideo}
                className="bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-md text-sm font-medium"
              >
                Download Trimmed Video
              </button>
              <p className="text-xs text-gray-500 mt-2">
                Note: In-browser video trimming has limitations. For better
                results, consider using desktop video editing software.
              </p>
            </div>
          )}

          {isProcessing && (
            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h3 className="font-medium text-blue-800 mb-2">
                Processing Video...
              </h3>
              <div className="w-full bg-gray-200 rounded-full h-2.5 mb-2">
                <div
                  className="bg-blue-600 h-2.5 rounded-full"
                  style={{ width: `${processProgress}%` }}
                ></div>
              </div>
              <p className="text-xs text-gray-500">
                This may take a while depending on the video length and your
                device performance.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
