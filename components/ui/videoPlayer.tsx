'use client';

import { useEffect, useState, useRef } from 'react';

type VideoPlayerProps = {
  videoBlob: Blob | null;
  impactTimeLabel?: string | null;
};

export default function VideoPlayer({
  videoBlob,
  impactTimeLabel,
}: VideoPlayerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [videoDimensions, setVideoDimensions] = useState({
    width: 0,
    height: 0,
  });
  const animationRef = useRef<number>();

  // Create the blob URL when the component mounts or when videoBlob changes
  useEffect(() => {
    // Clean up any existing blob URL
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
    }

    // Create a new blob URL if we have a video blob
    if (videoBlob) {
      const url = URL.createObjectURL(videoBlob);
      setBlobUrl(url);
      console.log('Created blob URL:', url);
    } else {
      setBlobUrl(null);
    }

    // Cleanup function to revoke the URL when the component unmounts
    // or when the videoBlob changes
    return () => {
      if (blobUrl) {
        console.log('Revoking blob URL:', blobUrl);
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [videoBlob]);

  // Set up video and canvas when blob URL is available
  useEffect(() => {
    if (
      !blobUrl ||
      !videoRef.current ||
      !canvasRef.current ||
      !containerRef.current ||
      !videoContainerRef.current
    )
      return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const videoContainer = videoContainerRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    const resizeCanvas = () => {
      if (!video.videoWidth || !video.videoHeight) return;

      // Get video container dimensions
      const containerWidth = videoContainer.clientWidth;
      const containerHeight = videoContainer.clientHeight;

      console.log(`Video container size: ${containerWidth}x${containerHeight}`);

      // For a vertically recorded video, we need to swap width and height
      // because we're going to rotate it 90 degrees for display
      const originalWidth = video.videoWidth;
      const originalHeight = video.videoHeight;
      const isPortrait = originalHeight > originalWidth;

      console.log(
        `Original video dimensions: ${originalWidth}x${originalHeight}, isPortrait: ${isPortrait}`
      );

      // After rotation, these will be our effective dimensions
      const effectiveWidth = isPortrait ? originalHeight : originalWidth;
      const effectiveHeight = isPortrait ? originalWidth : originalHeight;

      // Calculate aspect ratio of the video (after rotation)
      const videoAspectRatio = effectiveWidth / effectiveHeight;

      // Calculate aspect ratio of the container
      const containerAspectRatio = containerWidth / containerHeight;

      let canvasWidth, canvasHeight;

      // Fill the container as much as possible while maintaining aspect ratio
      if (videoAspectRatio > containerAspectRatio) {
        // Video is wider than container (relative to height)
        canvasWidth = containerWidth;
        canvasHeight = containerWidth / videoAspectRatio;
      } else {
        // Video is taller than container (relative to width)
        canvasHeight = containerHeight;
        canvasWidth = containerHeight * videoAspectRatio;
      }

      // Set canvas dimensions
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;

      setVideoDimensions({ width: canvasWidth, height: canvasHeight });

      console.log(`Canvas sized to ${canvasWidth}x${canvasHeight}`);
    };

    // Function to draw the rotated video on canvas
    const drawVideo = () => {
      if (video.paused || video.ended) return;

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Save context state
      ctx.save();

      // Translate to center of canvas
      ctx.translate(canvas.width / 2, canvas.height / 2);

      // Rotate 90 degrees
      ctx.rotate(Math.PI / 2);

      // Calculate dimensions to maintain aspect ratio
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;

      // For rotated video, we need to swap canvas dimensions when calculating scale
      const scaleX = canvas.height / videoWidth;
      const scaleY = canvas.width / videoHeight;

      // Use the smaller scale to ensure nothing gets cut off
      const scale = Math.min(scaleX, scaleY);

      const scaledWidth = videoWidth * scale;
      const scaledHeight = videoHeight * scale;

      // Draw video rotated and scaled
      ctx.drawImage(
        video,
        -scaledWidth / 2,
        -scaledHeight / 2,
        scaledWidth,
        scaledHeight
      );

      // Restore context
      ctx.restore();

      // Request next frame
      animationRef.current = requestAnimationFrame(drawVideo);
    };

    // Event handlers for video
    const handleLoadedMetadata = () => {
      setDuration(video.duration);
      console.log(
        `Video loaded. Dimensions: ${video.videoWidth}x${video.videoHeight}, Duration: ${video.duration}s`
      );

      // Wait a bit for layout to stabilize before resizing
      setTimeout(resizeCanvas, 50);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };

    // Add event listeners
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);

    // Handle window resize
    window.addEventListener('resize', resizeCanvas);

    // Start drawing when metadata is loaded and video can play
    video.addEventListener('canplay', () => {
      resizeCanvas();
      if (isPlaying) {
        drawVideo();
      }
    });

    return () => {
      // Remove event listeners
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
      window.removeEventListener('resize', resizeCanvas);

      // Cancel animation frame
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [blobUrl, isPlaying]);

  // Control functions
  const togglePlay = () => {
    if (!videoRef.current) return;

    if (isPlaying) {
      videoRef.current.pause();
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    } else {
      videoRef.current
        .play()
        .then(() => {
          if (canvasRef.current && videoRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
              const drawVideo = () => {
                if (
                  !videoRef.current ||
                  videoRef.current.paused ||
                  videoRef.current.ended
                )
                  return;

                // Clear canvas
                ctx.clearRect(
                  0,
                  0,
                  canvasRef.current!.width,
                  canvasRef.current!.height
                );

                // Save context state
                ctx.save();

                // Translate to center of canvas
                ctx.translate(
                  canvasRef.current!.width / 2,
                  canvasRef.current!.height / 2
                );

                // Rotate 90 degrees
                ctx.rotate(Math.PI / 2);

                // Calculate dimensions to maintain aspect ratio
                const videoWidth = videoRef.current.videoWidth;
                const videoHeight = videoRef.current.videoHeight;

                // For rotated video, we need to swap canvas dimensions when calculating scale
                const scaleX = canvasRef.current!.height / videoWidth;
                const scaleY = canvasRef.current!.width / videoHeight;

                // Use the smaller scale to ensure nothing gets cut off
                const scale = Math.min(scaleX, scaleY);

                const scaledWidth = videoWidth * scale;
                const scaledHeight = videoHeight * scale;

                // Draw video rotated and scaled
                ctx.drawImage(
                  videoRef.current,
                  -scaledWidth / 2,
                  -scaledHeight / 2,
                  scaledWidth,
                  scaledHeight
                );

                // Restore context
                ctx.restore();

                // Request next frame
                animationRef.current = requestAnimationFrame(drawVideo);
              };

              drawVideo();
            }
          }
        })
        .catch((err) => {
          console.error('Error playing video:', err);
        });
    }

    setIsPlaying(!isPlaying);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;

    const newTime = parseFloat(e.target.value);
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;

    const newVolume = parseFloat(e.target.value);
    videoRef.current.volume = newVolume;
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
  };

  const toggleMute = () => {
    if (!videoRef.current) return;

    const newMutedState = !isMuted;
    videoRef.current.muted = newMutedState;
    setIsMuted(newMutedState);
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  if (!blobUrl) {
    return (
      <div className="flex items-center justify-center h-full">
        No video available
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full flex flex-col bg-black overflow-hidden"
    >
      {/* Hidden video element for processing */}
      <video
        ref={videoRef}
        src={blobUrl}
        className="hidden"
        playsInline
        preload="metadata"
      />

      {/* Video container - takes most of the available space */}
      <div
        ref={videoContainerRef}
        className="flex-grow flex items-center justify-center w-full overflow-hidden"
        style={{ height: 'calc(100% - 70px)' }} // Reduced control height
      >
        {/* Canvas to display rotated video */}
        <canvas
          ref={canvasRef}
          className="bg-black cursor-pointer max-w-full max-h-full"
          onClick={togglePlay}
        />

        {/* Play/pause overlay */}
        {!isPlaying && (
          <div
            className="absolute flex items-center justify-center"
            style={{
              width: videoDimensions.width,
              height: videoDimensions.height,
            }}
            onClick={togglePlay}
          >
            <div className="bg-black/30 rounded-full p-3">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-10 w-10 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
          </div>
        )}
      </div>

      {/* Custom controls that remain in normal orientation */}
      <div className="w-full bg-black/90 border-t border-gray-800 px-3 py-2 h-70">
        {/* Progress bar */}
        <div className="flex items-center space-x-2 mb-2">
          <span className="text-white text-xs">{formatTime(currentTime)}</span>
          <input
            type="range"
            min="0"
            max={duration}
            value={currentTime}
            onChange={handleSeek}
            className="flex-grow h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <span className="text-white text-xs">{formatTime(duration)}</span>
        </div>

        {/* Control buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            {/* Play/Pause button */}
            <button
              onClick={togglePlay}
              className="text-white hover:text-blue-400 focus:outline-none"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-7 w-7"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-7 w-7"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              )}
            </button>

            {/* Volume controls */}
            <div className="flex items-center space-x-2">
              <button
                onClick={toggleMute}
                className="text-white hover:text-blue-400 focus:outline-none"
                aria-label={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-6 w-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                      clipRule="evenodd"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
                    />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-6 w-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                    />
                  </svg>
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={handleVolumeChange}
                className="w-20 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                aria-label="Volume"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Impact time label */}
      {impactTimeLabel && (
        <div className="absolute top-2 left-2 bg-blue-600 text-white px-2 py-0.5 rounded-full text-xs z-10">
          Impact at {impactTimeLabel}
        </div>
      )}
    </div>
  );
}
