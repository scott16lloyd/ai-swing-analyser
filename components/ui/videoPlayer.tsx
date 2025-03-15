'use client';

import { useEffect, useState } from 'react';

type VideoPlayerProps = {
  videoBlob: Blob | null;
  impactTimeLabel?: string | null;
};

export default function VideoPlayer({
  videoBlob,
  impactTimeLabel,
}: VideoPlayerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

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
      {/* Here's the key trick: transform-box creates boundaries for transform-origin */}
      <div className="transform-box-wrapper">
        {/* Video with controls */}
        <video src={blobUrl} controls playsInline className="video-element" />
      </div>

      {/* Impact time label */}
      {impactTimeLabel && (
        <div className="absolute top-4 left-4 bg-blue-600 text-white px-3 py-1 rounded-full text-sm z-10">
          Impact at {impactTimeLabel}
        </div>
      )}

      {/* Styling for rotation - the key here is the global CSS approach */}
      <style jsx global>{`
        /* Wrapper for transform context */
        .transform-box-wrapper {
          position: relative;
          height: 100%;
          width: 80%;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        /* Video element with rotation */
        .video-element {
          transform: rotate(90deg);
          width: 100vh; /* Use viewport height */
          height: auto;
          max-width: none !important;
          object-fit: contain;
          background: black;
        }

        /* The critical part: Keep controls unrotated */
        video::-webkit-media-controls-enclosure {
          transform: rotate(-90deg);
          transform-origin: center center;
        }

        /* For Firefox */
        @supports (-moz-appearance: none) {
          .video-element {
            transform-origin: center;
          }
        }
      `}</style>
    </div>
  );
}
