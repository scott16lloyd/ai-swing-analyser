'use client';

import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';

interface ProcessVideoOptions {
  cameraFacing?: 'user' | 'environment' | string;
  quality?: 'high' | 'medium' | 'low';
  bucketName?: string;
  destinationPath?: string;
  onProgress?: (progress: number) => void;
}

interface ProcessVideoResponse {
  success: boolean;
  bucketName: string;
  fileName: string;
  publicUrl?: string;
  metadata: {
    originalName: string;
    quality: string;
    processingMethod: string;
    [key: string]: any;
  };
}

/**
 * Send a video to the Cloud Run processing service
 */
export async function processVideoWithCloudRun(
  videoBlob: Blob,
  options: ProcessVideoOptions = {}
): Promise<ProcessVideoResponse> {
  const {
    cameraFacing = 'unknown',
    quality = 'high',
    bucketName = process.env.NEXT_PUBLIC_POSE_ESTIMATION_ANALYSIS_BUCKET,
    destinationPath = 'unprocessed_videos/test',
    onProgress = () => {},
  } = options;

  if (!videoBlob) {
    throw new Error('No video blob provided');
  }

  if (!bucketName) {
    console.log('bucketName:', bucketName);
    throw new Error('Storage bucket name is required');
  }

  // Create form data
  const formData = new FormData();

  // Add the video file
  const extension = videoBlob.type.includes('mp4') ? 'mp4' : 'webm';
  const filename = `golf-swing-${Date.now()}.${extension}`;
  formData.append('video', videoBlob, filename);

  // Add processing parameters
  formData.append('quality', quality);
  formData.append('bucketName', bucketName);
  formData.append('destinationPath', destinationPath);

  // Add metadata as JSON
  const metadata = {
    cameraFacing,
    deviceInfo: navigator.userAgent,
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0',
    timestamp: new Date().toISOString(),
  };
  formData.append('metadata', JSON.stringify(metadata));

  // Get the Cloud Run URL from environment
  const cloudRunUrl = process.env.NEXT_PUBLIC_VIDEO_PROCESSOR_URL;
  if (!cloudRunUrl) {
    throw new Error('Video processor URL not configured');
  }

  // Send the request
  const response = await fetch(`${cloudRunUrl}/process-upload-video`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    // Try to parse error response
    let errorMessage: string;
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || `Server error: ${response.status}`;
    } catch (e) {
      errorMessage = `Failed to process video: ${response.status} ${response.statusText}`;
    }
    throw new Error(errorMessage);
  }

  // Return the processed video information
  return (await response.json()) as ProcessVideoResponse;
}

interface VideoUploadButtonProps {
  videoBlob: Blob | null;
  cameraFacing: 'user' | 'environment';
  onProcessingComplete?: (result: ProcessVideoResponse) => void;
  onProcessingError?: (error: Error) => void;
  className?: string;
  disabled?: boolean;
}

// Component example
export function VideoUploadButton({
  videoBlob,
  cameraFacing,
  onProcessingComplete,
  onProcessingError,
  className = '',
  disabled = false,
}: VideoUploadButtonProps) {
  const [uploading, setUploading] = useState<boolean>(false);
  const { toast } = useToast();

  const handleProcessVideo = async () => {
    if (!videoBlob) {
      toast({
        title: 'Error',
        description: 'No video to process',
        variant: 'destructive',
      });
      return;
    }

    setUploading(true);

    try {
      toast({
        title: 'Processing',
        description: 'Sending video for processing...',
      });

      const result = await processVideoWithCloudRun(videoBlob, {
        cameraFacing,
        quality: 'high',
      });

      toast({
        title: 'Success',
        description: 'Video processed and uploaded successfully!',
        variant: 'default',
      });

      if (onProcessingComplete) {
        onProcessingComplete(result);
      }
    } catch (error) {
      console.error('Processing failed:', error);

      toast({
        title: 'Processing Failed',
        description:
          error instanceof Error ? error.message : 'Unknown error occurred',
        variant: 'destructive',
      });

      if (onProcessingError && error instanceof Error) {
        onProcessingError(error);
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <button
      className={`px-4 py-2 bg-blue-500 text-white rounded-md disabled:opacity-50 ${className}`}
      onClick={handleProcessVideo}
      disabled={uploading || !videoBlob || disabled}
    >
      {uploading ? 'Processing...' : 'Process Video'}
    </button>
  );
}
