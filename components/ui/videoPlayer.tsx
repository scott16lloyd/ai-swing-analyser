'use client';

import { useState, useRef, useEffect } from 'react';

interface VideoPlayerProps {
  videoBlob: Blob | null;
  impactTimeLabel: string | null;
}

const VideoPlayer = ({ videoBlob, impactTimeLabel }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  // Create the video URL when the blob changes
  useEffect(() => {
    if (!videoBlob) return;

    console.log(
      `Creating new URL for video blob: ${videoBlob.size} bytes, type: ${videoBlob.type}`
    );
    const url = URL.createObjectURL(videoBlob);
    setVideoUrl(url);

    // Clean up function to revoke URL when component unmounts or blob changes
    return () => {
      if (url) {
        console.log('Revoking previous URL:', url);
        URL.revokeObjectURL(url);
      }
    };
  }, [videoBlob]);

  // Set up video playback when the URL changes
  useEffect(() => {
    if (!videoUrl || !videoRef.current) return;

    const video = videoRef.current;

    // Set up new event handlers - need to clean up old ones first
    video.onloadedmetadata = null;
    video.oncanplay = null;
    video.onerror = null;
    video.onended = null;

    // Set up event handlers on the existing video element
    const handleCanPlay = () => {
      console.log('Video can play now, duration:', video.duration);
      setIsLoaded(true);

      // Start playback
      video
        .play()
        .then(() => console.log('Playback started successfully'))
        .catch((err) => {
          console.error('Failed to autoplay:', err);
          setError('Tap to play video');
        });
    };

    const handleLoadedMetadata = () => {
      console.log('Video metadata loaded:', {
        duration: video.duration,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      });

      // Reset to beginning to ensure playback from start
      video.currentTime = 0;
    };

    const handleError = (e: Event) => {
      console.error('Video error:', e);
      setError('Error loading video');
    };

    const handleEnded = () => {
      console.log('Video playback ended');
      // Optional: Add any behavior you want when the video ends
    };

    // Add event listeners to the existing video element
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('error', handleError);
    video.addEventListener('ended', handleEnded);

    // Pause any current playback
    video.pause();

    // Set video source and load
    console.log('Setting video source to:', videoUrl);
    video.src = videoUrl;
    video.load();

    // Clean up function
    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('error', handleError);
      video.removeEventListener('ended', handleEnded);
      video.pause();
    };
  }, [videoUrl]);

  const handleTap = () => {
    if (!videoRef.current) return;

    if (videoRef.current.paused) {
      videoRef.current
        .play()
        .then(() => setError(null))
        .catch((err) => {
          console.error('Failed to play on tap:', err);
          setError('Playback error. Try again.');
        });
    } else {
      videoRef.current.pause();
    }
  };

  return (
    <div className="relative h-full w-full" onClick={handleTap}>
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}

      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        controls
        playsInline
        key={videoUrl || 'no-video'} // Add a key to force re-render when URL changes
      />

      {impactTimeLabel && (
        <div className="absolute top-4 left-4 bg-blue-600 text-white px-3 py-1 rounded-full text-sm">
          Impact at {impactTimeLabel}
        </div>
      )}

      {error && (
        <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded-full text-sm">
          {error}
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;
