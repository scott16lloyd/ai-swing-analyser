'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import getBlobDuration from 'get-blob-duration';
import { useRouter } from 'next/navigation';

function EditPage() {
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingLeftRef = useRef(false);
  const isDraggingRightRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Get video source from sessionStorage
  useEffect(() => {
    const recordedVideo = sessionStorage.getItem('recordedVideo');
    if (recordedVideo) {
      setVideoSrc(recordedVideo);

      getBlobDuration(recordedVideo)
        .then((duration) => {
          console.log('Video duration:', duration);
          setVideoDuration(duration);
          setEndTime(duration);
          setIsLoading(false);

          // Generate thumbnails after duration is set
          setTimeout(() => {
            generateThumbnails();
          }, 500);
        })
        .catch((error) => {
          console.error('Failed to get video duration:', error);
          if (videoRef.current && videoRef.current.duration) {
            setVideoDuration(videoRef.current.duration);
            setEndTime(videoRef.current.duration);
          }
          setIsLoading(false);
        });
    }
  }, []);

  const handleVideoEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

  // Update current time as video plays
  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);

      // If playing and current time is past end time, reset to start time
      if (videoRef.current.currentTime >= endTime) {
        videoRef.current.currentTime = startTime;

        if (isPlaying) {
          videoRef.current.play().catch((err) => {
            console.error('Error restarting playback:', err);
            setIsPlaying(false);
          });
        }
      }
    }
  }, [startTime, endTime, isPlaying]);

  // Ensure generateThumbnauls is called at the right time
  useEffect(() => {
    if (
      videoSrc &&
      videoDuration > 0 &&
      !isLoading &&
      thumbnails.length === 0
    ) {
      console.log('Attempting to generate thumbnails...');
      generateThumbnails();
    }
  }, [videoSrc, videoDuration, isLoading, thumbnails.length]);

  // Generate thumbnails for the timeline
  const generateThumbnails = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || videoDuration <= 0) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 120;
    canvas.height = 90;

    const numThumbnails = 10;
    const newThumbnails: string[] = [];

    // Store original time to restore later
    const originalTime = video.currentTime;

    for (let i = 0; i < numThumbnails; i++) {
      const time = (videoDuration / numThumbnails) * i;
      console.log(`Generating thumbnail at ${time}s`);

      try {
        // Set video to specific time
        video.currentTime = time;

        // Wait for the video to seek to that time
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

          // Add timeout in case event never fires
          setTimeout(() => {
            video.removeEventListener('seeked', seekHandler);
            video.removeEventListener('error', errorHandler);
            resolve(); // Resolve anyway to continue
          }, 1000);
        });

        // Draw the current frame
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataURL = canvas.toDataURL('image/jpeg', 0.7);
        newThumbnails.push(dataURL);
        console.log(`Generated thumbnail ${i + 1}/${numThumbnails}`);
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

    console.log(`Generated ${newThumbnails.length} thumbnails`);
    setThumbnails(newThumbnails);
  }, [videoDuration]);

  // Handle play/pause
  const handlePlayPause = useCallback(() => {
    if (!videoRef.current) return;

    if (isPlaying) {
      videoRef.current.pause();
    } else {
      // If outside trim range, reset to start
      if (
        videoRef.current.currentTime < startTime ||
        videoRef.current.currentTime >= endTime
      ) {
        videoRef.current.currentTime = startTime;
      }
      videoRef.current.play();
    }

    setIsPlaying(!isPlaying);
  }, [isPlaying, startTime, endTime]);

  // Format time display
  const formatTime = (time: number) => {
    if (!isFinite(time) || isNaN(time)) {
      return '0:00';
    }
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Handle drag events for trim handles
  useEffect(() => {
    if (!containerRef.current || !videoRef.current || videoDuration <= 0)
      return;

    const container = containerRef.current;
    const videoElement = videoRef.current;
    const containerWidth = container.offsetWidth;

    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      const containerRect = container.getBoundingClientRect();

      // Get x position relative to container
      let clientX: number;
      if ('touches' in e) {
        clientX = e.touches[0].clientX;
      } else {
        clientX = e.clientX;
      }

      const relativeX = clientX - containerRect.left;
      const percentage = Math.max(0, Math.min(1, relativeX / containerWidth));
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
  }, [startTime, endTime, videoDuration]);

  // Handle mouse/touch down on left handle
  const handleLeftHandleDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      isDraggingLeftRef.current = true;
    },
    []
  );

  // Handle mouse/touch down on right handle
  const handleRightHandleDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      isDraggingRightRef.current = true;
    },
    []
  );

  // Handle direct clicks on timeline
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

  const handleTrim = useCallback(() => {
    if (!videoSrc) return;

    const trimInfo = {
      videoUrl: videoSrc,
      startTime,
      endTime,
      duration: endTime - startTime,
    };

    sessionStorage.setItem('trimInfo', JSON.stringify(trimInfo));
    router.push('/analyse/result');
  }, [videoSrc, startTime, endTime, router]);

  return (
    <div className="fixed inset-0 flex flex-col p-4 bg-black bg-opacity-90">
      {videoSrc ? (
        <>
          {/* Video preview */}
          <div className="flex-1 relative mb-4 rounded-lg overflow-hidden">
            <video
              ref={videoRef}
              src={videoSrc}
              className="w-full h-full object-contain rounded-lg"
              onTimeUpdate={handleTimeUpdate}
              onClick={handlePlayPause}
              preload="metadata"
            />
          </div>
          {/* Play/Pause button */}
          <div className="flex justify-center mt-8 mb-4 relative z-10">
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

          {/* Timeline with iOS-style trim handles */}
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
                      Generating previews...
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
              onClick={() => router.back()}
              className="px-6 py-2 bg-gray-200/90 rounded-full text-gray-800 font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleTrim}
              className="px-6 py-2 bg-blue-500 text-white rounded-full font-medium"
            >
              Trim
            </button>
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-white">Loading video...</div>
        </div>
      )}
    </div>
  );
}

export default EditPage;
