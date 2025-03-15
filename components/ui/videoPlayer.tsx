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
  const [videoOrientation, setVideoOrientation] = useState<
    'portrait' | 'landscape'
  >('landscape');
  const videoRef = useRef<HTMLVideoElement>(null);

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

      // Use a timeout to ensure dimensions are available
      setTimeout(() => {
        if (video.videoHeight > video.videoWidth) {
          setVideoOrientation('portrait');
          console.log('Detected portrait video orientation');
        } else {
          setVideoOrientation('landscape');
          console.log('Detected landscape video orientation');
        }
      }, 100);
    }
  };

  if (!blobUrl) {
    return (
      <div className="flex items-center justify-center h-full">
        No video available
      </div>
    );
  }

  return (
    <div className="relative h-full w-full flex items-center justify-center bg-black">
      {/* Super simple video element with minimal props */}
      <video
        ref={videoRef}
        src={blobUrl}
        className={`h-full w-full object-contain ${videoOrientation === 'portrait' ? 'portait-video' : 'w-full'}`}
        style={{
          // For portrait videos, set a max-width to prevent stretching
          ...(videoOrientation === 'portrait' && {
            maxWidth: '75vh', // Limit width for portrait videos
          }),
        }}
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

      <style jsx>{`
        .portrait-video {
          max-height: 100%;
          width: auto;
        }
      `}</style>
    </div>
  );
}
