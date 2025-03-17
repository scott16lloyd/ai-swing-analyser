'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import VideoPlayer from '@/components/ui/videoPlayer';
import Image from 'next/image';
import golfSwingImage from '../public/face-on-golf-swing-soloute.png';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { checkProcessedVideoStatus } from '@/app/actions/storage';

export default function SwingAnalysisPage() {
  const searchParams = useSearchParams();
  const fileName = searchParams.get('fileName');
  const bucketName = searchParams.get('bucketName');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [pollingCount, setPollingCount] = useState(0);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    if (!fileName) {
      setError('No file name provided');
      setIsLoading(false);
      return;
    }

    const checkVideoStatus = async () => {
      try {
        // Call the server action to check if the video is processed
        const result = await checkProcessedVideoStatus({
          bucketName: bucketName || undefined,
          fileName,
          processedFolder: 'processed_video/user', // Update this to match your cloud function's output folder
        });

        if (!result.exists) {
          // If there's an error from the server
          if (result.error) {
            throw new Error(result.error);
          }

          // If we've been polling for more than 30 seconds (10 attempts * 3 seconds),
          // give the user an update but keep trying
          if (pollingCount === 10) {
            toast({
              title: 'Still Processing',
              description:
                'Your swing is taking a bit longer to analyze than usual. Hang tight!',
              variant: 'default',
            });
          }

          // If we've been polling for more than 2 minutes (40 attempts * 3 seconds),
          // stop and show an error
          if (pollingCount > 40) {
            throw new Error(
              'Video processing took too long. Please try again later.'
            );
          }

          // Continue polling after 3 seconds
          setPollingCount((prev) => prev + 1);
          setTimeout(checkVideoStatus, 3000);
          return;
        }

        // Video is ready, fetch it using the signed URL
        try {
          if (!result.publicUrl) {
            throw new Error('No URL provided for the processed video');
          }

          const response = await fetch(result.publicUrl);
          if (!response.ok) {
            throw new Error(`Failed to fetch video: ${response.status}`);
          }

          const videoBlob = await response.blob();
          setVideoBlob(videoBlob);
          setIsLoading(false);

          // Notify user
          toast({
            title: 'Analysis Complete',
            description: 'Your swing has been analyzed successfully!',
            variant: 'default',
          });
        } catch (fetchError) {
          console.error('Error fetching video:', fetchError);
          throw new Error('Could not download the processed video');
        }
      } catch (err) {
        console.error('Error checking processed video:', err);
        setError(
          err instanceof Error ? err.message : 'Failed to load processed video'
        );
        setIsLoading(false);
      }
    };

    // Start polling for the processed video
    checkVideoStatus();

    // Clean up
    return () => {
      // Any cleanup if needed
    };
  }, [fileName, bucketName, pollingCount, toast]);

  const handleBackClick = () => {
    router.push('/');
  };

  const handleRetryClick = () => {
    setIsLoading(true);
    setError(null);
    setPollingCount(0);
    // Start polling again
    router.refresh();
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
              {pollingCount > 5 && (
                <p className="text-gray-500 mt-4 max-w-md mx-auto text-sm">
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
