'use client';

import { useEffect, useState, useRef } from 'react';

type VideoPlayerProps = {
  videoBlob: Blob | null;
  impactTimeLabel?: string | null;
  forcePortrait?: boolean; // Add this prop to force portrait mode
};

export default function VideoPlayer({
  videoBlob,
  impactTimeLabel,
  forcePortrait = true, // Default to forcing portrait for mobile recordings
}: VideoPlayerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
      className="relative h-full w-full flex items-center justify-center bg-black overflow-hidden"
    >
      <div
        className={`video-container ${forcePortrait ? 'force-portrait' : ''}`}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <video
          ref={videoRef}
          src={blobUrl}
          className="video-element"
          style={{
            maxHeight: forcePortrait ? '100%' : '100%',
            maxWidth: forcePortrait ? '80%' : '100%',
            objectFit: 'contain',
            // This transform is the key to forcing portrait orientation
            ...(forcePortrait && {
              transform: 'rotate(90deg)',
              width: '100vh', // Use viewport height for width
              maxWidth: 'unset',
              height: 'auto',
            }),
          }}
          controls
          playsInline
        />
      </div>

      {/* Optional impact time display */}
      {impactTimeLabel && (
        <div className="absolute top-4 left-4 bg-blue-600 text-white px-3 py-1 rounded-full text-sm z-10">
          Impact at {impactTimeLabel}
        </div>
      )}
    </div>
  );
}
