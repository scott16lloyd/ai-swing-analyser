'use client';

import { useState, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';

interface ProcessVideoOptions {
  cameraFacing?: 'user' | 'environment' | string;
  quality?: 'high' | 'medium' | 'low';
  bucketName?: string;
  destinationPath?: string;
  onProgress?: (progress: number) => void;
}

export interface ProcessVideoResponse {
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
 * Simplified function to upload video directly to storage
 */
export async function uploadVideoDirectly(
  videoBlob: Blob,
  options: ProcessVideoOptions = {}
): Promise<ProcessVideoResponse> {
  const {
    cameraFacing = 'unknown',
    quality = 'high',
    bucketName = process.env.STORAGE_BUCKET_NAME || '',
    destinationPath = 'unprocessed_video/user',
    onProgress = () => {},
  } = options;

  if (!videoBlob) {
    throw new Error('No video blob provided');
  }

  // Skip compression for testing
  onProgress(20);

  // Create a unique filename
  const extension = videoBlob.type.includes('mp4') ? 'mp4' : 'webm';
  const timestamp = Date.now();
  const filename = `test-upload-${timestamp}.${extension}`;
  const fullPath = `${destinationPath}/${filename}`;

  try {
    // Import the server action
    const storageModule = await import('@/app/actions/storage');
    const generateSignedUrl = storageModule.generateSignedUrl;

    // Get a simple signed URL
    const { url, publicUrl } = await generateSignedUrl({
      filename: fullPath,
      contentType: videoBlob.type,
      // No metadata for simplicity
    });

    onProgress(40);
    console.log('Uploading to signed URL:', url);

    // Upload with minimal options
    const uploadResponse = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': videoBlob.type,
      },
      body: videoBlob,
      mode: 'cors',
      credentials: 'omit',
    });

    // Detailed error logging
    if (!uploadResponse.ok) {
      console.error('Upload failed with status:', uploadResponse.status);
      try {
        const responseText = await uploadResponse.text();
        console.error('Response:', responseText);
      } catch (e) {
        console.error('Could not read response body');
      }
      throw new Error(
        `Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`
      );
    }

    onProgress(100);
    console.log('Upload successful!');

    // Return a success response
    return {
      success: true,
      bucketName: bucketName,
      fileName: fullPath,
      publicUrl,
      metadata: {
        originalName: filename,
        quality,
        processingMethod: 'direct_upload',
        uploadTime: new Date().toISOString(),
      },
    };
  } catch (error) {
    console.error('Upload error:', error);
    throw error;
  }
}

interface VideoUploadButtonProps {
  videoBlob: Blob | null;
  cameraFacing: 'user' | 'environment';
  onProcessingComplete?: (result: ProcessVideoResponse) => void;
  onProcessingError?: (error: Error) => void;
  className?: string;
  disabled?: boolean;
  useDirectUpload?: boolean;
  uploadOptions?: Partial<ProcessVideoOptions>;
}

// Simplified component for testing
export function VideoUploadButton({
  videoBlob,
  cameraFacing,
  onProcessingComplete,
  onProcessingError,
  className = '',
  disabled = false,
  useDirectUpload = true,
  uploadOptions = {},
}: VideoUploadButtonProps) {
  const [uploading, setUploading] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const { toast } = useToast();

  const updateProgress = (value: number) => {
    setProgress(value);
  };

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
    setProgress(0);

    try {
      toast({
        title: 'Uploading',
        description: 'Preparing video for upload...',
      });

      const result = await uploadVideoDirectly(videoBlob, {
        cameraFacing,
        quality: 'high',
        onProgress: updateProgress,
        ...uploadOptions,
      });

      toast({
        title: 'Success',
        description: 'Video uploaded successfully!',
        variant: 'default',
      });

      if (onProcessingComplete) {
        onProcessingComplete(result);
      }
    } catch (error) {
      console.error('Upload failed:', error);

      toast({
        title: 'Upload Failed',
        description:
          error instanceof Error ? error.message : 'Unknown error occurred',
        variant: 'destructive',
      });

      if (onProcessingError && error instanceof Error) {
        onProcessingError(error);
      }
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  return (
    <div className="relative">
      <button
        className={`px-4 py-2 bg-blue-500 text-white rounded-md disabled:opacity-50 ${className}`}
        onClick={handleProcessVideo}
        disabled={uploading || !videoBlob || disabled}
      >
        {uploading
          ? `Uploading ${progress ? `${progress}%` : '...'}`
          : 'Upload Video'}
      </button>

      {uploading && progress > 0 && (
        <div className="w-full h-1 bg-gray-200 rounded-full mt-2 overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-300 ease-in-out"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
      )}
    </div>
  );
}
