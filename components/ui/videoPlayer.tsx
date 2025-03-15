'use client';

import { useEffect, useState, useRef } from 'react';

type VideoPlayerProps = {
  videoBlob: Blob | null;
  impactTimeLabel?: string | null;
  cameraFacing?: 'user' | 'environment';
};

export default function VideoPlayer({
  videoBlob,
  impactTimeLabel,
  cameraFacing = 'environment', // Default to back camera
}: VideoPlayerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoInfo, setVideoInfo] = useState({
    width: 0,
    height: 0,
    isPortrait: false,
    needsRotation: false,
  });

  // Check if device is iOS (iPhone/iPad)
  const [isIOS] = useState(() => {
    if (typeof window !== 'undefined') {
      return (
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      );
    }
    return false;
  });

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
      console.log('Created blob URL:', url, 'Blob size:', videoBlob.size);
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

  // Handle video metadata loaded event
  const handleMetadataLoaded = () => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;

    console.log(`Video natural dimensions: ${videoWidth}x${videoHeight}`);

    // Determine if the video is portrait oriented
    const isPortraitVideo = videoHeight > videoWidth;

    // On iOS, videos recorded in portrait mode on the back camera
    // often need to be rotated 90 degrees for proper display
    const needsRotation =
      isIOS && isPortraitVideo && cameraFacing === 'environment';

    console.log(
      `Video orientation: ${isPortraitVideo ? 'portrait' : 'landscape'}, Needs rotation: ${needsRotation}`
    );

    setVideoInfo({
      width: videoWidth,
      height: videoHeight,
      isPortrait: isPortraitVideo,
      needsRotation,
    });
  };

  const getVideoStyles = (): React.CSSProperties => {
    const { isPortrait, needsRotation } = videoInfo;

    // Base styles
    const baseStyles: React.CSSProperties = {
      maxHeight: '100%',
      maxWidth: '100%',
      objectFit: 'contain',
    };

    // If detected as portrait and we're on iOS with back camera, apply rotation
    if (needsRotation) {
      return {
        ...baseStyles,
        transform: 'rotate(90deg)',
        maxWidth: 'none',
        width: '100vh', // Use viewport height for width
        height: 'auto',
      };
    }

    // For portrait videos without rotation needed
    if (isPortrait) {
      return {
        ...baseStyles,
        maxHeight: '100%',
        maxWidth: '80%',
        width: 'auto',
      };
    }

    // For landscape videos
    return baseStyles;
  };

  if (!blobUrl) {
    return (
      <div className="flex items-center justify-center h-full">
        No video available
      </div>
    );
  }

  return (
    <div className="relative h-full w-full flex items-center justify-center bg-black overflow-hidden">
      <video
        ref={videoRef}
        src={blobUrl}
        style={getVideoStyles()}
        controls
        playsInline
        onLoadedMetadata={handleMetadataLoaded}
      />

      {/* Optional impact time display */}
      {impactTimeLabel && (
        <div className="absolute top-4 left-4 bg-blue-600 text-white px-3 py-1 rounded-full text-sm z-10">
          Impact at {impactTimeLabel}
        </div>
      )}
    </div>
  );
}
