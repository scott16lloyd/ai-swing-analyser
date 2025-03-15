'use client';

import { useState, useEffect } from 'react';

interface VideoPlayerProps {
  videoBlob: Blob | null;
  impactTimeLabel: string | null;
}

const VideoPlayer = ({ videoBlob, impactTimeLabel }: VideoPlayerProps) => {
  const [videoURL, setVideoURL] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Create and manage the video URL
  useEffect(() => {
    // Clean up previous URL if it exists
    if (videoURL) {
      URL.revokeObjectURL(videoURL);
    }

    // If we have a new video blob, create a URL for it
    if (videoBlob) {
      const newURL = URL.createObjectURL(videoBlob);
      console.log(
        `Created new URL for video: ${newURL}, size: ${videoBlob.size} bytes`
      );
      setVideoURL(newURL);
      setIsLoading(true);
    } else {
      setVideoURL(null);
    }

    // Clean up when component unmounts or videoBlob changes
    return () => {
      if (videoURL) {
        console.log(`Revoking URL: ${videoURL}`);
        URL.revokeObjectURL(videoURL);
      }
    };
  }, [videoBlob]); // Only re-run when videoBlob changes

  const handleVideoLoaded = () => {
    console.log('Video loaded and ready to play');
    setIsLoading(false);
  };

  return (
    <div className="relative h-full w-full">
      {/* Loading indicator */}
      {isLoading && videoURL && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <span className="ml-3 text-white">Loading video...</span>
        </div>
      )}

      {/* Display the video with URL */}
      {videoURL ? (
        <video
          src={videoURL}
          className="h-full w-full object-contain"
          controls
          playsInline
          onLoadedData={handleVideoLoaded}
          onError={(e) => console.error('Video error:', e)}
        />
      ) : (
        <div className="flex items-center justify-center h-full w-full bg-gray-900">
          <p className="text-white">No video available</p>
        </div>
      )}

      {/* Impact time indicator */}
      {impactTimeLabel && (
        <div className="absolute top-4 left-4 bg-blue-600 text-white px-3 py-1 rounded-full text-sm">
          Impact at {impactTimeLabel}
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;
