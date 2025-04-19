'use client';

import { getUserVideos } from '@/app/actions/storage';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// Define types for video data
interface VideoFile {
  fileName: string;
  publicUrl: string;
  timestamp?: number;
  metadata?: Record<string, any>;
}

interface VideoResults {
  success: boolean;
  files: VideoFile[];
  error?: string;
}

export default function HistoryPage() {
  // State to store video data
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const router = useRouter();

  // Sample user ID - in production you would get this from authentication
  const userId = '146f59fa-c2e9-4321-ae86-cea2a0750db0';

  useEffect(() => {
    const fetchVideos = async () => {
      try {
        setIsLoading(true);

        // Call your function to get user videos
        const results = await getUserVideos(userId);

        if (results.success) {
          setVideos(results.files);
          console.log(`Found ${results.files.length} videos for this user`);

          if (results.files.length > 0) {
            console.log(`Latest video: ${results.files[0].fileName}`);
          }
        } else {
          setError(results.error || 'Unknown error occurred');
          console.error(`Error: ${results.error}`);
        }
      } catch (err) {
        setError((err as Error).message);
        console.error('Failed to fetch videos:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchVideos();
  }, [userId]);

  // Function to handle video click
  const handleVideoClick = (video: VideoFile) => {
    try {
      // Extract duration from metadata if available
      const duration = video.metadata?.duration
        ? parseFloat(video.metadata.duration)
        : 0;

      // Make sure we have the correct file name without duplicate "_processed" suffixes
      let fileName = video.fileName;
      // If the fileName already ends with "_processed.mp4", ensure we don't add another one
      if (fileName.includes('_processed_processed.mp4')) {
        fileName = fileName.replace(
          '_processed_processed.mp4',
          '_processed.mp4'
        );
      }
      // Create trim info object similar to what's created in EditPage
      const trimInfo = {
        videoUrl: video.publicUrl,
        fileName: video.fileName,
        startTime: 0, // Since this is a processed video, start from beginning
        endTime: duration || 0,
        duration: duration || 0,
      };

      // Store in session storage for the results page to use
      sessionStorage.setItem('trimInfo', JSON.stringify(trimInfo));

      // Also indicate that we're coming from history, not from a fresh recording
      sessionStorage.setItem('fromHistory', 'true');

      // Navigate to the results page
      router.push('/analyse/results');
    } catch (error) {
      console.error('Error preparing video for analysis:', error);
      setError('Failed to prepare video for viewing');
    }
  };

  // Format date from timestamp
  const formatDate = (timestamp?: number) => {
    if (!timestamp) return 'Unknown date';
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Function to extract a thumbnail from a video
  const extractThumbnail = (video: HTMLVideoElement, url: string) => {
    return new Promise<void>((resolve) => {
      // Set up event handlers before setting the src
      video.onloadedmetadata = () => {
        // Seek to the middle of the video
        video.currentTime = video.duration / 2;
      };

      video.onseeked = () => {
        // Create a canvas to draw the video frame
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // Draw the current frame to the canvas
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          // Convert canvas to data URL and store in state
          const thumbnailUrl = canvas.toDataURL('image/jpeg');
          setThumbnails((prev) => ({
            ...prev,
            [url]: thumbnailUrl,
          }));
        }

        // Clean up
        video.onloadedmetadata = null;
        video.onseeked = null;
        resolve();
      };

      // Handle any errors
      video.onerror = () => {
        console.error(`Error loading video: ${url}`);
        resolve();
      };

      // Set the source to trigger loading
      video.src = url;
      video.load();
    });
  };

  // Generate thumbnails when videos are loaded
  useEffect(() => {
    if (videos.length > 0) {
      const generateThumbnails = async () => {
        for (const video of videos) {
          // Skip if we already have a thumbnail
          if (thumbnails[video.publicUrl]) continue;

          const videoElement = document.createElement('video');
          videoElement.crossOrigin = 'anonymous'; // For CORS if needed
          await extractThumbnail(videoElement, video.publicUrl);
        }
      };

      generateThumbnails();
    }
  }, [videos]);

  // Render the component with proper loading states and error handling
  return (
    <div className="h-full flex flex-col overflow-y-auto pb-16 no-scrollbar">
      <div className="min-w-full px-4 py-6 flex-1">
        <h1 className="text-2xl font-bold mb-6 text-center">
          Your Swing History
        </h1>

        {isLoading && (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
          </div>
        )}

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            <p>Error loading videos: {error}</p>
          </div>
        )}

        {!isLoading && !error && videos.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">No video history found.</p>
          </div>
        )}

        {!isLoading && videos.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {videos.map((video, index) => (
              <div
                key={index}
                className="border rounded-lg overflow-hidden shadow-md cursor-pointer w-full"
                onClick={() => handleVideoClick(video)}
              >
                <div className="relative pt-[56.25%]">
                  {thumbnails[video.publicUrl] ? (
                    <img
                      src={thumbnails[video.publicUrl]}
                      alt={`Frame from ${video.fileName}`}
                      className="absolute top-0 left-0 w-full h-full object-cover"
                    />
                  ) : (
                    <div className="absolute top-0 left-0 w-full h-full bg-gray-200 flex items-center justify-center">
                      <div className="animate-pulse text-gray-400">
                        Loading frame...
                      </div>
                    </div>
                  )}
                  <div className="absolute bottom-2 right-2 bg-black bg-opacity-50 rounded-full p-1">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5 text-white"
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
                <div className="p-3 w-screen">
                  <p className="text-sm text-gray-500">Swing analysis</p>
                  <p className="mt-1 truncate text-sm" title={video.fileName}>
                    {formatDate(video.timestamp)}
                  </p>
                  {video.metadata && (
                    <p className="text-xs text-gray-500 mt-1">
                      {video.metadata.contentType} ·{' '}
                      {Math.round(
                        (Number(video.metadata.size) / 1024 / 1024) * 100
                      ) / 100}{' '}
                      MB
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
