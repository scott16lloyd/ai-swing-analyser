'use client';

import { getVideoDuration } from '@/lib/videoUtils';
import getBlobDuration from 'get-blob-duration';
import React, { useEffect, useState, useRef, useCallback } from 'react';

function EditPage() {
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const isDraggingLeftRef = useRef(false);
  const isDraggingRightRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Get video blob URL from sessionStorage
    const recordedVideo = sessionStorage.getItem('recordedVideo');
    if (recordedVideo) {
      setVideoSrc(recordedVideo);
      // Get the duration of the video
      getBlobDuration(recordedVideo)
        .then((duration) => {
          console.log('Video duration: ' + videoDuration);
          setVideoDuration(duration);
          setEndTime(duration);
          setIsLoading(false);
        })
        .catch((error) => {
          console.error('Failed to get video duration:', error);
          // Fallback to traditional method if getBlobDuration fails
          if (videoRef.current && videoRef.current.duration) {
            setVideoDuration(videoRef.current.duration);
            setEndTime(videoRef.current.duration);
          }
          setIsLoading(false);
        });
    }
  }, []); // Run once on mount

  // Check for video loading
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || !videoSrc) return;
  }, [videoSrc, videoRef]);

  const formatTime = (time: number) => {
    if (!isFinite(time) || isNaN(time)) {
      return '0:00';
    }
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

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

  // Handle dragging and releasing
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
      } else if (isDraggingRightRef.current) {
        const newEndTime = Math.max(timePosition, startTime + 0.5);
        setEndTime(Math.min(videoDuration, newEndTime));
        videoElement.currentTime = newEndTime;
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
  }, [startTime, endTime, getVideoDuration]);

  const handleTrim = useCallback(() => {
    if (!videoSrc) return;

    const trimmedInfo = {
      videoUrl: videoSrc,
      startTime,
      endTime,
      duration: endTime - startTime,
    };

    // Store trimming info
    sessionStorage.setItem('trimmedInfo', JSON.stringify(trimmedInfo));
    alert(
      `Video trimmed from ${formatTime(startTime)} to ${formatTime(endTime)}`
    );
  }, [videoSrc, startTime, endTime]);

  return (
    <div>
      {videoSrc ? (
        <>
          <div className="w-full mb-6">
            <video
              ref={videoRef}
              src={videoSrc}
              controls
              className="w-full rounded-lg"
              preload="metadata"
              playsInline
            ></video>
            {isLoading && (
              <div className="text-center mt-2">Loading video...</div>
            )}
          </div>
          {/* Show triming UI when video is loaded */}
          {!isLoading && (
            <div className="w-full mb-4">
              <div className="flex justify-between text-sm mb-1">
                <span>{formatTime(startTime)}</span>
                <span>
                  {videoDuration > 0 ? formatTime(endTime) : 'Loading...'}
                </span>
              </div>

              {/* Timeline with trimming handles */}
              <div
                ref={containerRef}
                className="relative h-16 bg-gray-200 rounded-md mb-2 overflow-hidden"
              >
                {/* Video thumbnail strip (simulated) */}
                <div className="absolute inset-0 bg-gradient-to-r from-blue-400 to-purple-500 opacity-50"></div>
                {/* Selected area */}
                <div
                  className="absolute h-full border-2 border-yellow-400"
                  style={{
                    left: `${(startTime / videoDuration) * 100}%`,
                    right: `${100 - (endTime / videoDuration) * 100}%`,
                  }}
                ></div>
                {/* Left handle */}
                <div
                  className="absolute w-4 h-full bg-yellow-400 cursor-ew-resize flex items-center justify-center left-0"
                  style={{ left: `${(startTime / videoDuration) * 100}%` }}
                  onMouseDown={handleLeftHandleDown}
                  onTouchStart={handleLeftHandleDown}
                >
                  <div className="w-0.5 h-6 bg-white"></div>
                </div>
                {/* Right handle */}
                <div
                  className="absolute w-4 h-full bg-yellow-400 cursor-ew-resize flex items-center justify-center right-0"
                  style={{ right: `${100 - (endTime / videoDuration) * 100}%` }}
                  onMouseDown={handleRightHandleDown}
                  onTouchStart={handleRightHandleDown}
                >
                  <div className="w-0.5 h-6 bg-white"></div>
                </div>
              </div>
            </div>
          )}

          <div className="flex space-x-4 w-full justify-center">
            <button className="px-5 py-2 bg-gray-200 rounded-full text-gray-800">
              Cancel
            </button>
            <button
              className="px-5 py-2 bg-blue-500 text-white rounded-full"
              onClick={handleTrim}
            >
              Trim
            </button>
          </div>
        </>
      ) : (
        <p>No video available</p>
      )}
    </div>
  );
}

export default EditPage;
