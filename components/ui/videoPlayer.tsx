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
  const videoContainerRef = useRef<HTMLDivElement>(null);

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
    <div className="relative h-full w-full flex items-center justify-center bg-black">
      {/* Video container with rotation style */}
      <div
        ref={videoContainerRef}
        className="relative max-h-full max-w-full"
        style={{
          width: '80%',
          height: '100%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          overflow: 'hidden',
        }}
      >
        {/* This CSS wrapper handles rotation while keeping controls normal */}
        <div className="video-rotation-wrapper">
          <video src={blobUrl} controls playsInline className="rotated-video" />
        </div>

        {/* Embed the required CSS directly */}
        <style jsx>{`
          .video-rotation-wrapper {
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
            overflow: hidden;
          }

          /* The trick: Apply rotation only to the video content, not to the controls */
          .video-rotation-wrapper video {
            transform: rotate(90deg);
            object-fit: contain;
            max-height: none;
            max-width: none;
            width: 100vh; /* Use viewport height as width */
            height: auto;
            background: black;
          }

          /* Hide native controls and only show when hovering */
          .video-rotation-wrapper video::-webkit-media-controls {
            transform: rotate(0deg); /* Keep controls normal */
            transform-origin: bottom center;
            position: absolute;
            bottom: 0;
            width: 100%;
          }
        `}</style>
      </div>

      {/* Impact time label */}
      {impactTimeLabel && (
        <div className="absolute top-4 left-4 bg-blue-600 text-white px-3 py-1 rounded-full text-sm z-10">
          Impact at {impactTimeLabel}
        </div>
      )}
    </div>
  );
}
