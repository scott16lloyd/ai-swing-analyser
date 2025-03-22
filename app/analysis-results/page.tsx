'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import VideoPlayer from '@/components/ui/videoPlayer';
import Image from 'next/image';
import golfSwingImage from '../public/face-on-golf-swing-soloute.png';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { checkProcessedVideoStatus } from '@/app/actions/storage';

function SwingAnalysisContent() {
  const searchParams = useSearchParams();
  const fileName = searchParams.get('fileName');
  const bucketName = searchParams.get('bucketName');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [pollingAttempt, setPollingAttempt] = useState(0);
  const router = useRouter();
  const { toast } = useToast();
  const lastPollTime = useRef<number>(Date.now());
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Maximum polling attempts (2 minutes ÷ 5 seconds = 24 attempts)
  const MAX_POLLING_ATTEMPTS = 24;

  // Polling interval in milliseconds (5 seconds)
  const POLLING_INTERVAL = 5000;

  // Reset everything when the component unmounts
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  // Reset when filename changes
  useEffect(() => {
    setPollingAttempt(0);
    setIsLoading(true);
    setError(null);
    setVideoBlob(null);
    lastPollTime.current = Date.now();

    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, [fileName, bucketName]);

  useEffect(() => {
    if (!fileName || !isLoading) {
      // Clear any existing interval if we're not loading
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }

    // Define the polling function
    const checkForProcessedVideo = async () => {
      // Make sure we're not polling too quickly
      const now = Date.now();
      const timeSinceLastPoll = now - lastPollTime.current;

      // Only poll if enough time has passed (at least 90% of the interval)
      if (timeSinceLastPoll < POLLING_INTERVAL * 0.9) {
        console.log(
          `Skipping poll - only ${timeSinceLastPoll}ms since last poll`
        );
        return;
      }

      console.log(
        `Polling attempt ${pollingAttempt + 1}/${MAX_POLLING_ATTEMPTS} for ${fileName}`
      );
      lastPollTime.current = now;

      try {
        if (fileName) {
          // Make sure we're just using the filename without path consistently
          const fileNameOnly = fileName.includes('/')
            ? fileName.split('/').pop()
            : fileName;

          if (!fileNameOnly) {
            setError('Invalid filename');
            setIsLoading(false);
            return;
          }

          const result = await checkProcessedVideoStatus({
            bucketName: bucketName || undefined,
            fileName: fileNameOnly, // IMPORTANT: Use fileNameOnly consistently
            processedFolder: 'processed_video/user',
          });

          console.log('Check result:', result);

          if (result.exists && result.publicUrl) {
            try {
              const response = await fetch(result.publicUrl);
              if (response.ok) {
                const blob = await response.blob();
                setVideoBlob(blob);
                setIsLoading(false);

                toast({
                  title: 'Analysis Complete',
                  description: 'Your swing has been analyzed successfully!',
                  variant: 'default',
                });

                // Clear the interval since we're done
                if (pollingIntervalRef.current) {
                  clearInterval(pollingIntervalRef.current);
                  pollingIntervalRef.current = null;
                }

                return; // Exit polling if successful
              } else {
                console.error('Error fetching video. Status:', response.status);
              }
            } catch (fetchError) {
              console.error('Error fetching video:', fetchError);
            }
          }
        }

        // If we reached maximum attempts, show error
        if (pollingAttempt >= MAX_POLLING_ATTEMPTS - 1) {
          setError('Video processing took too long. Please try again later.');
          setIsLoading(false);

          // Clear the interval since we're done
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }

          return;
        }

        // Increment polling attempts and continue polling
        setPollingAttempt((prev) => prev + 1);
      } catch (err) {
        console.error('Error checking processed video:', err);
        setError(
          err instanceof Error ? err.message : 'Failed to load processed video'
        );
        setIsLoading(false);

        // Clear the interval since we encountered an error
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      }
    };

    // Only set up the interval if it doesn't already exist
    if (!pollingIntervalRef.current) {
      // Call once immediately for the first check
      checkForProcessedVideo();

      // Set up interval for subsequent checks
      pollingIntervalRef.current = setInterval(
        checkForProcessedVideo,
        POLLING_INTERVAL
      );
    }
  }, [
    fileName,
    bucketName,
    pollingAttempt,
    isLoading,
    toast,
    MAX_POLLING_ATTEMPTS,
    POLLING_INTERVAL,
  ]);

  const handleBackClick = () => {
    router.push('/');
  };

  const handleRetryClick = () => {
    setIsLoading(true);
    setError(null);
    setPollingAttempt(0);
    setVideoBlob(null);
    lastPollTime.current = Date.now();

    // Clear the existing interval if any
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  };

  // Fetch video with content type handling but keep it minimal
  const fetchVideoWithContentType = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch video: ${response.status}`);
    }

    const blob = await response.blob();

    // If the content type is missing or not a video, create a new blob with correct type
    if (!blob.type || !blob.type.includes('video/')) {
      const fileExt = url.split('.').pop()?.toLowerCase();
      const mimeType =
        fileExt === 'mp4'
          ? 'video/mp4'
          : fileExt === 'webm'
            ? 'video/webm'
            : 'video/mp4'; // default to mp4

      return new Blob([await blob.arrayBuffer()], { type: mimeType });
    }

    return blob;
  };

  return (
    <div className="h-[calc(100vh-4rem)] max-w-screen flex flex-col bg-black text-white">
      <div className="relative flex-grow">
        {/* Background image when no video */}
        {!videoBlob && (
          <Image
            src={golfSwingImage}
            alt="Golf Swing"
            layout="fill"
            objectFit="cover"
            style={{ opacity: 0.2 }}
          />
        )}

        {isLoading ? (
          // Loading state
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="text-center">
              <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <h2 className="text-xl font-semibold mb-2">
                Analyzing Your Swing
              </h2>
              <p className="text-gray-400">
                Our AI is processing your golf swing...
              </p>
              <p className="text-gray-500 mt-4 max-w-md mx-auto text-sm">
                Time elapsed:{' '}
                {Math.round((pollingAttempt * POLLING_INTERVAL) / 1000)} seconds
              </p>
              <p className="text-gray-500 mt-2 max-w-md mx-auto text-sm">
                Polling attempt: {pollingAttempt + 1} of {MAX_POLLING_ATTEMPTS}
              </p>
              {pollingAttempt > 3 && (
                <p className="text-gray-500 mt-2 max-w-md mx-auto text-sm">
                  This usually takes 30-60 seconds. We'll notify you as soon as
                  it's ready!
                </p>
              )}
            </div>
          </div>
        ) : error ? (
          // Error state
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="text-center p-6 max-w-md">
              <div className="text-red-500 text-5xl mb-4">😕</div>
              <h2 className="text-xl font-semibold mb-2">Processing Error</h2>
              <p className="text-gray-400 mb-6">{error}</p>
              <div className="flex flex-col space-y-3 sm:flex-row sm:space-y-0 sm:space-x-3 justify-center">
                <Button
                  onClick={handleRetryClick}
                  className="flex items-center"
                >
                  <RotateCcw className="mr-2 h-4 w-4" /> Try Again
                </Button>
                <Button
                  onClick={handleBackClick}
                  variant="outline"
                  className="flex items-center"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back to Camera
                </Button>
              </div>
            </div>
          </div>
        ) : videoBlob ? (
          // Video player
          <div className="relative h-full max-w-screen">
            <VideoPlayer videoBlob={videoBlob} />
            <div className="absolute top-4 left-4 bg-blue-600 text-white px-3 py-1 rounded-full text-sm">
              AI Analysis Complete
            </div>
          </div>
        ) : null}
      </div>

      {/* Bottom controls */}
      {!isLoading && !error && videoBlob && (
        <div className="p-4 mb-16 flex justify-center items-center gap-4">
          <Button
            onClick={handleBackClick}
            className="px-4 py-2 bg-blue-500 text-white rounded-md flex items-center gap-2"
          >
            <ArrowLeft className="h-5 w-5" />
            Back to Camera
          </Button>
        </div>
      )}
    </div>
  );
}

export default function SwingAnalysisPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SwingAnalysisContent />
    </Suspense>
  );
}
