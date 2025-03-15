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
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPortrait, setIsPortrait] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

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

  // Detect video orientation after metadata is loaded
  const handleVideoLoaded = () => {
    if (videoRef.current) {
      const video = videoRef.current;

      // Get the natural dimensions of the video
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;

      console.log(`Video dimensions: ${videoWidth}x${videoHeight}`);

      // Determine if the video is portrait oriented
      const isVideoPortrait = videoHeight > videoWidth;
      setIsPortrait(isVideoPortrait);

      // Set dimensions for appropriate styling
      setDimensions({
        width: videoWidth,
        height: videoHeight,
      });

      console.log(
        `Video orientation: ${isVideoPortrait ? 'portrait' : 'landscape'}`
      );
    }
  };

  // Apply video styles based on orientation
  const getVideoStyles = () => {
    // Base styles
    const styles: React.CSSProperties = {
      maxHeight: '100%',
      maxWidth: '100%',
      objectFit: 'contain',
    };

    // Add orientation-specific styles
    if (isPortrait) {
      // For portrait videos on mobile (iPhone, etc.)
      return {
        ...styles,
        width: 'auto',
        height: '100%',
        maxWidth: '80%',
      };
    }

    return styles;
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
      className="relative h-full w-full flex items-center justify-center bg-black"
    >
      {/* Super simple video element with minimal props */}
      <video
        ref={videoRef}
        src={blobUrl}
        style={getVideoStyles()}
        controls
        playsInline
        onLoadedMetadata={handleVideoLoaded}
      />

      {/* Optional impact time display */}
      {impactTimeLabel && (
        <div className="absolute top-4 left-4 bg-blue-600 text-white px-3 py-1 rounded-full text-sm">
          Impact at {impactTimeLabel}
        </div>
      )}
    </div>
  );
}
