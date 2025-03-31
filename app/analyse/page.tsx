'use client';
import React, { useRef, useState, useCallback, useEffect } from 'react';
import Webcam from 'react-webcam';
import { getSupportedMimeType } from '@/lib/videoUtils';

type Mode = 'record' | 'preview';

function UnifiedVideoPage() {
  // Mode state
  const [mode, setMode] = useState<Mode>('record');

  // Recording states
  const webcamRef = useRef<Webcam | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Video preview states
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Trimming states
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Debugging
  const [mobileDebugLogs, setMobileDebugLogs] = useState<string[]>([]);
  const [showDebugger, setShowDebugger] = useState(false);

  // Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingLeftRef = useRef(false);
  const isDraggingRightRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debug logging
  const mobileLog = useCallback((message: string) => {
    console.log(message);
    setMobileDebugLogs((prev) => [message, ...prev].slice(0, 20));
  }, []);

  // Recording functions
  const handleStartCaptureClick = useCallback(() => {
    setCapturing(true);
    if (webcamRef.current && webcamRef.current.stream) {
      const mimeType = getSupportedMimeType();
      mobileLog(`Using MIME type: ${mimeType}`);

      mediaRecorderRef.current = new MediaRecorder(webcamRef.current.stream, {
        mimeType: mimeType,
      });

      mediaRecorderRef.current?.addEventListener(
        'dataavailable',
        handleDataAvailable
      );
      mediaRecorderRef.current.start();
    }
  }, [mobileLog]);

  const handleDataAvailable = useCallback(
    ({ data }: { data: Blob }) => {
      mobileLog(`Data available, size: ${data.size} bytes`);
      if (data.size > 0) {
        setRecordedChunks((prev) => prev.concat(data));

        // Check if capturing is stopped
        if (!capturing) {
          mobileLog('Creating blob for preview');

          // Cleanup any previous video
          if (videoSrc) {
            URL.revokeObjectURL(videoSrc);
          }

          // Create blob with the correct MIME type
          const blob = new Blob([data], { type: data.type });
          const url = URL.createObjectURL(blob);
          mobileLog(`Created blob URL: ${url}`);

          // Switch to preview mode
          setVideoSrc(url);
          setMode('preview');

          // Reset trim values
          setStartTime(0);
          setEndTime(0);
          setThumbnails([]);
          setIsLoading(true);
        }
      }
    },
    [capturing, videoSrc, mobileLog]
  );

  const handleStopCaptureClick = useCallback(() => {
    mobileLog('Stop button clicked');
    if (mediaRecorderRef.current) {
      try {
        // First update UI state
        setCapturing(false);

        // Then stop the recorder
        mediaRecorderRef.current.stop();
        mobileLog('MediaRecorder stopped');
      } catch (err) {
        console.error('Error stopping recording:', err);
      }
    }
  }, [mobileLog]);

  // Timer for recording
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (capturing) {
      interval = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);
    } else {
      setElapsedTime(0);
    }

    return () => clearInterval(interval);
  }, [capturing]);

  // Format time display
  const formatTime = (seconds: number) => {
    if (!isFinite(seconds) || isNaN(seconds)) {
      return '0:00';
    }
    const mins = Math.floor(seconds / 60)
      .toString()
      .padStart(2, '0');
    const secs = Math.floor(seconds % 60)
      .toString()
      .padStart(2, '0');
    return `${mins}:${secs}`;
  };

  // Video preview & playback functions
  const handlePlayPause = useCallback(() => {
    if (!videoRef.current) return;

    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      // If outside trim range, reset to start
      if (
        videoRef.current.currentTime < startTime ||
        videoRef.current.currentTime >= endTime
      ) {
        videoRef.current.currentTime = startTime;
      }

      videoRef.current.play().catch((err) => {
        mobileLog(`Error playing video: ${err.message}`);
        setIsPlaying(false);
      });
      setIsPlaying(true);
    }
  }, [isPlaying, startTime, endTime, mobileLog]);

  // Handle video time updates
  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);

      // If current time is past end time, reset to start time
      if (videoRef.current.currentTime >= endTime && isPlaying) {
        videoRef.current.currentTime = startTime;
      }
    }
  }, [startTime, endTime, isPlaying]);

  // Handle video ended
  const handleVideoEnded = useCallback(() => {
    mobileLog('Video playback ended');
    setIsPlaying(false);

    // Reset to start of trim
    if (videoRef.current) {
      videoRef.current.currentTime = startTime;
      setCurrentTime(startTime);
    }
  }, [startTime, mobileLog]);

  // Video metadata loading
  useEffect(() => {
    // Only run this effect if we have a video source
    if (!videoSrc || mode !== 'preview') return;

    const handleMetadataLoaded = () => {
      if (videoRef.current && videoRef.current.duration) {
        const duration = videoRef.current.duration;
        if (isFinite(duration) && duration > 0) {
          mobileLog(`Video duration detected: ${duration}s`);
          setVideoDuration(duration);
          setEndTime(duration);

          // Now that we have duration, generate thumbnails
          setTimeout(() => generateThumbnails(), 500);
        }
      }
    };

    if (videoRef.current) {
      videoRef.current.addEventListener('loadedmetadata', handleMetadataLoaded);

      return () => {
        if (videoRef.current) {
          videoRef.current.removeEventListener(
            'loadedmetadata',
            handleMetadataLoaded
          );
        }
      };
    }
  }, [videoSrc, mode, mobileLog]);

  // Generate thumbnails for trim interface
  const generateThumbnails = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || videoDuration <= 0) {
      mobileLog('Cannot generate thumbnails - missing refs or duration');
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    mobileLog('Generating thumbnails...');
    setIsLoading(true);

    canvas.width = 120;
    canvas.height = 90;

    // Fewer thumbnails on iOS for better performance
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const numThumbnails = isIOS ? 5 : 10;
    const newThumbnails: string[] = [];

    // Store original time to restore later
    const originalTime = video.currentTime;

    for (let i = 0; i < numThumbnails; i++) {
      const time = (videoDuration / numThumbnails) * i;
      mobileLog(`Generating thumbnail at ${time}s`);

      try {
        // Set video to specific time
        video.currentTime = time;

        // Wait for the video to seek to that time
        await new Promise<void>((resolve) => {
          const seekHandler = () => {
            video.removeEventListener('seeked', seekHandler);
            resolve();
          };

          // Set up event listener
          video.addEventListener('seeked', seekHandler);

          // Fallback timeout (longer for iOS)
          setTimeout(
            () => {
              video.removeEventListener('seeked', seekHandler);
              resolve();
            },
            isIOS ? 2000 : 1000
          );
        });

        // Draw the current frame
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        // Lower quality on iOS for better performance
        const dataURL = canvas.toDataURL('image/jpeg', isIOS ? 0.5 : 0.7);
        newThumbnails.push(dataURL);
      } catch (err) {
        console.error('Error generating thumbnail:', err);
      }
    }

    // Reset video position
    try {
      video.currentTime = originalTime;
    } catch (e) {
      console.error('Error resetting video time:', e);
    }

    mobileLog(`Generated ${newThumbnails.length} thumbnails`);
    setThumbnails(newThumbnails);
    setIsLoading(false);
  }, [videoDuration, mobileLog]);

  // Trim functionality - handle dragging
  useEffect(() => {
    if (
      !containerRef.current ||
      !videoRef.current ||
      videoDuration <= 0 ||
      mode !== 'preview'
    )
      return;

    const container = containerRef.current;
    const videoElement = videoRef.current;

    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      const containerRect = container.getBoundingClientRect();

      // Get x position relative to container
      let clientX: number;
      if ('touches' in e && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
      } else if ('clientX' in e) {
        clientX = e.clientX;
      } else {
        return; // Exit if position cant be found
      }

      const relativeX = clientX - containerRect.left;
      const percentage = Math.max(
        0,
        Math.min(1, relativeX / containerRect.width)
      );
      const timePosition = percentage * videoDuration;

      // Update state based on which handle is being dragged
      if (isDraggingLeftRef.current) {
        const newStartTime = Math.min(timePosition, endTime - 0.5);
        setStartTime(Math.max(0, newStartTime));
        videoElement.currentTime = newStartTime;
        setCurrentTime(newStartTime);
      } else if (isDraggingRightRef.current) {
        const newEndTime = Math.max(timePosition, startTime + 0.5);
        setEndTime(Math.min(videoDuration, newEndTime));
        videoElement.currentTime = newEndTime;
        setCurrentTime(newEndTime);
      }
    };

    const handleMouseUp = () => {
      isDraggingLeftRef.current = false;
      isDraggingRightRef.current = false;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('touchmove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchend', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('touchmove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchend', handleMouseUp);
    };
  }, [startTime, endTime, videoDuration, mode]);

  // Handle mouse/touch down on left handle
  const handleLeftHandleDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isDraggingLeftRef.current = true;
    },
    []
  );

  // Handle mouse/touch down on right handle
  const handleRightHandleDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isDraggingRightRef.current = true;
    },
    []
  );

  // Handle timeline click
  const handleTimelineClick = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current || !videoRef.current || videoDuration <= 0)
        return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const relativeX = e.clientX - containerRect.left;
      const percentage = Math.max(
        0,
        Math.min(1, relativeX / containerRect.width)
      );
      const newTime = percentage * videoDuration;

      // Only update if within trim range
      if (newTime >= startTime && newTime <= endTime) {
        videoRef.current.currentTime = newTime;
        setCurrentTime(newTime);
      }
    },
    [startTime, endTime, videoDuration]
  );

  // Reset to recording mode
  const handleRetakeVideo = useCallback(() => {
    mobileLog('Resetting to recording mode');

    // Stop playback if playing
    if (isPlaying && videoRef.current) {
      videoRef.current.pause();
    }

    // Clear video data
    if (videoSrc) {
      URL.revokeObjectURL(videoSrc);
    }

    // Reset all states
    setVideoSrc(null);
    setVideoDuration(0);
    setCurrentTime(0);
    setStartTime(0);
    setEndTime(0);
    setIsPlaying(false);
    setThumbnails([]);
    setRecordedChunks([]);

    // Back to record mode
    setMode('record');
  }, [videoSrc, isPlaying, mobileLog]);

  // Process the trimmed video
  const handleSaveTrim = useCallback(() => {
    if (!videoSrc || startTime >= endTime) {
      mobileLog('Invalid trim parameters');
      return;
    }

    mobileLog(`Saving trim from ${startTime}s to ${endTime}s`);

    // For demonstration, we'll just alert the trim parameters
    // In a real app, you would use the Web Video Editing API or a server-side solution
    alert(
      `Video trimmed from ${formatTime(startTime)} to ${formatTime(endTime)}`
    );
  }, [videoSrc, startTime, endTime, mobileLog, formatTime]);

  return (
    <div className="fixed inset-0 flex flex-col bg-black">
      {/* Recording Mode */}
      {mode === 'record' && (
        <>
          {/* Webcam component */}
          <Webcam
            audio={false}
            ref={webcamRef}
            className="h-full w-auto object-cover"
            mirrored={true}
          />

          {/* Timer component */}
          {capturing && (
            <div className="absolute top-4 right-4 bg-red-500 bg-opacity-90 text-white px-3 py-1 rounded-full text-md m-2">
              {formatTime(elapsedTime)}
            </div>
          )}

          {/* Record button components */}
          <div className="absolute bottom-24 left-0 right-0 flex justify-center pointer-events-auto">
            {capturing ? (
              <button
                onClick={handleStopCaptureClick}
                className="relative flex items-center justify-center w-24 h-16 rounded-full transition-colors duration-300 border-2 bg-red-500 border-red-600"
                aria-label="Stop recording"
                style={{ touchAction: 'manipulation' }}
                type="button"
              >
                <div className="w-8 h-8 rounded-sm bg-white animate-pulse"></div>
              </button>
            ) : (
              <button
                onClick={handleStartCaptureClick}
                className="relative flex items-center justify-center w-24 h-16 rounded-full transition-colors duration-300 border-2 bg-white border-gray-300"
                aria-label="Start recording"
              >
                <div className="w-12 h-12 rounded-full bg-red-500"></div>
              </button>
            )}
          </div>
        </>
      )}

      {/* Preview Mode with Integrated Trimming */}
      {mode === 'preview' && videoSrc && (
        <div className="flex flex-col p-4">
          {/* Video preview */}
          <div className="mb-4 rounded-lg overflow-hidden">
            <video
              ref={videoRef}
              src={videoSrc}
              className="w-full h-auto max-h-[50vh] object-contain rounded-lg"
              onTimeUpdate={handleTimeUpdate}
              onEnded={handleVideoEnded}
              onClick={handlePlayPause}
              preload="metadata"
              playsInline
              webkit-playsinline="true"
              disablePictureInPicture
              controlsList="noplaybackrate nofullscreen"
            />
          </div>

          {/* Play/Pause button */}
          <div className="flex justify-center mt-4 mb-4 relative z-10">
            <button
              onClick={handlePlayPause}
              className="w-10 h-10 bg-white/80 rounded-full flex items-center justify-center shadow-lg"
            >
              {isPlaying ? (
                /* Pause icon */
                <div className="flex space-x-1">
                  <div className="w-1 h-4 bg-black rounded-sm"></div>
                  <div className="w-1 h-4 bg-black rounded-sm"></div>
                </div>
              ) : (
                /* Play icon */
                <div className="w-8 h-8 flex justify-center items-center">
                  <div
                    className="w-0 h-0 ml-1"
                    style={{
                      borderTop: '8px solid transparent',
                      borderBottom: '8px solid transparent',
                      borderLeft: '14px solid black',
                    }}
                  ></div>
                </div>
              )}
            </button>
          </div>

          {/* Hidden canvas for thumbnails */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Timeline with trim handles */}
          <div className="mb-20 rounded-xl bg-gray-700/80 p-2">
            {/* Time displays */}
            <div className="flex justify-between text-white text-xs mb-1 px-4">
              <span>{formatTime(startTime)}</span>
              <span>{formatTime(endTime)}</span>
            </div>

            {/* Thumbnails timeline */}
            <div
              ref={containerRef}
              className="relative h-16 mx-8 rounded-lg overflow-hidden"
              onClick={handleTimelineClick}
            >
              {/* Thumbnails */}
              <div className="flex h-full w-full bg-gray-900 rounded-lg">
                {thumbnails.length > 0 ? (
                  thumbnails.map((thumbnail, index) => (
                    <div
                      key={index}
                      className="h-full"
                      style={{ width: `${100 / thumbnails.length}%` }}
                    >
                      <img
                        src={thumbnail}
                        alt={`Thumbnail ${index}`}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ))
                ) : (
                  // Fallback gradient if no thumbnails
                  <div className="h-full w-full bg-gradient-to-r from-blue-400 to-purple-500 flex items-center justify-center rounded-lg">
                    <div className="text-white text-sm">
                      {isLoading
                        ? 'Generating previews...'
                        : 'No previews available'}
                    </div>
                  </div>
                )}
              </div>

              {/* Selected trim area */}
              <div
                className="absolute top-0 left-0 right-0 bottom-0 border-2 border-yellow-400 bg-yellow-400/20"
                style={{
                  left: `${(startTime / videoDuration) * 100}%`,
                  right: `${100 - (endTime / videoDuration) * 100}%`,
                }}
              ></div>

              {/* Left trim handle */}
              <div
                className="absolute top-0 bottom-0 w-6 bg-yellow-400 cursor-col-resize flex flex-col justify-between items-center py-1 touch-manipulation z-10"
                style={{
                  left: `calc(${(startTime / videoDuration) * 100}% - 8px)`,
                }}
                onMouseDown={handleLeftHandleDown}
                onTouchStart={handleLeftHandleDown}
              >
                <div className="w-0.5 h-2 bg-black rounded-full"></div>
                <div className="w-0.5 h-2 bg-black rounded-full"></div>
              </div>

              {/* Right trim handle */}
              <div
                className="absolute top-0 bottom-0 w-6 bg-yellow-400 cursor-col-resize flex flex-col justify-between items-center py-1 touch-manipulation z-10"
                style={{
                  right: `calc(${100 - (endTime / videoDuration) * 100}% - 8px)`,
                }}
                onMouseDown={handleRightHandleDown}
                onTouchStart={handleRightHandleDown}
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

          {/* Action buttons */}
          <div className="fixed bottom-4 left-0 right-0 flex justify-center space-x-6 px-4">
            <button
              onClick={handleRetakeVideo}
              className="px-6 py-2 bg-gray-200/90 rounded-full text-gray-800 font-medium"
            >
              Retake
            </button>
            <button
              onClick={handleSaveTrim}
              className="px-6 py-2 bg-blue-500 text-white rounded-full font-medium"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* Debug overlay */}
      {showDebugger && (
        <div className="fixed bottom-20 left-0 right-0 max-h-48 overflow-y-auto bg-black/80 text-white text-xs p-2 z-50">
          <div className="mb-2 flex justify-between">
            <div>Debug Console</div>
            <button onClick={() => setShowDebugger(false)}>Close</button>
          </div>
          {mobileDebugLogs.map((log, i) => (
            <div key={i} className="border-b border-gray-700 py-1">
              {log}
            </div>
          ))}
        </div>
      )}

      {/* Debug button */}
      <button
        onClick={() => setShowDebugger((prev) => !prev)}
        className="fixed top-2 right-2 bg-black/50 text-white text-xs p-1 rounded z-50"
      >
        Debug
      </button>
    </div>
  );
}

export default UnifiedVideoPage;
