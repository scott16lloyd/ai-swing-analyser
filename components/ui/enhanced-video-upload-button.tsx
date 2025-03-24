'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { uploadVideoDirectly } from '@/components/ui/upload-button';
import {
  Upload,
  Settings,
  Wifi,
  WifiOff,
  AlertCircle,
  CheckCircle,
  X,
} from 'lucide-react';

// Video compression options interface
interface CompressVideoOptions {
  quality?: string;
  onProgress?: (progress: number) => void;
  maxDuration?: number;
}

interface EnhancedVideoUploadProps {
  videoBlob: Blob | null;
  cameraFacing: 'user' | 'environment';
  onProcessingComplete?: (result: ProcessVideoResponse) => void;
  onProcessingError?: (error: Error) => void;
  className?: string;
  disabled?: boolean;
  useDirectUpload?: boolean;
  uploadOptions?: Partial<ProcessVideoOptions>;
}

// Additional types for video compression
interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  aspectRatio: number;
  size: number;
  type: string;
}

interface NetworkInfoState {
  type: string | null;
  effectiveType: string | null;
  downlink: number | null;
  rtt: number | null;
  qualityRecommendation: string;
  chunkSize: number;
}

interface CompressionStats {
  originalSize: string;
  compressedSize: string;
  reduction: string;
}

interface QualityPreset {
  width: number;
  height: number;
  bitrate: number;
  frameRate: number;
}

interface ProcessVideoOptions {
  cameraFacing?: 'user' | 'environment' | string;
  quality?: 'high' | 'medium' | 'low';
  bucketName?: string;
  destinationPath?: string;
  onProgress?: (progress: number) => void;
}

/**
 * Response from processing video
 */
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

// Quality presets for video compression
const QUALITY_PRESETS: Record<string, QualityPreset | null> = {
  'very-low': {
    width: 480,
    height: 270,
    bitrate: 800000, // 800Kbps
    frameRate: 24,
  },
  low: {
    width: 640,
    height: 360,
    bitrate: 1200000, // 1.2Mbps
    frameRate: 24,
  },
  medium: {
    width: 854,
    height: 480,
    bitrate: 2500000, // 2.5Mbps
    frameRate: 30,
  },
  high: {
    width: 1280,
    height: 720,
    bitrate: 5000000, // 5Mbps
    frameRate: 30,
  },
  original: null, // No compression
};

/**
 * Detects if the current device is a mobile device
 * @returns {boolean} True if the device is mobile
 */
function isMobileDevice(): boolean {
  // Check for mobile or tablet devices
  return (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    ) ||
    (navigator.maxTouchPoints !== undefined && navigator.maxTouchPoints > 2)
  );
}

/**
 * Returns the best supported video format for MediaRecorder
 * @returns {string} The MIME type to use for video recording
 */
function getBestSupportedMimeType(): string {
  const types: string[] = [
    'video/mp4;codecs=h264',
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      console.log(`Using MIME type: ${type}`);
      return type;
    }
  }

  console.warn('No preferred MIME types supported, using default');
  return 'video/webm';
}

/**
 * Detects current network conditions and recommends compression settings
 */
function detectNetworkConditions(): NetworkInfoState {
  // Get network information if available
  const connection =
    navigator.connection ||
    (navigator as any).mozConnection ||
    (navigator as any).webkitConnection ||
    null;

  // Default to medium quality if we can't detect network
  if (!connection) {
    console.log(
      'Network information API not available, assuming medium quality'
    );
    return {
      type: null,
      effectiveType: null,
      downlink: null,
      rtt: null,
      qualityRecommendation: 'medium',
      chunkSize: 512 * 1024, // 512KB default chunk size
    };
  }

  console.log('Network conditions:', {
    type: connection.type,
    effectiveType: connection.effectiveType,
    downlink: connection.downlink,
    rtt: connection.rtt,
  });

  // Determine recommended quality based on connection
  let qualityRecommendation = 'medium';
  let chunkSize = 512 * 1024; // 512KB default

  // Effective type will be one of 'slow-2g', '2g', '3g', or '4g'
  switch (connection.effectiveType) {
    case 'slow-2g':
    case '2g':
      qualityRecommendation = 'very-low';
      chunkSize = 128 * 1024; // 128KB chunks for very slow connections
      break;
    case '3g':
      if (connection.downlink && connection.downlink < 1) {
        qualityRecommendation = 'low';
        chunkSize = 256 * 1024; // 256KB chunks for slow 3G
      } else {
        qualityRecommendation = 'medium';
        chunkSize = 512 * 1024; // 512KB for decent 3G
      }
      break;
    case '4g':
    default:
      if (connection.downlink && connection.downlink > 5) {
        qualityRecommendation = 'high';
        chunkSize = 1024 * 1024; // 1MB chunks for fast connections
      } else {
        qualityRecommendation = 'medium';
        chunkSize = 768 * 1024; // 768KB for normal 4G
      }
      break;
  }

  return {
    type: connection.type || null,
    effectiveType: connection.effectiveType || null,
    downlink: connection.downlink || null,
    rtt: connection.rtt || null,
    qualityRecommendation,
    chunkSize,
  };
}

/**
 * Utility function to read basic video information without loading the full video
 */
async function getVideoInfo(videoBlob: Blob): Promise<VideoInfo> {
  return new Promise<VideoInfo>((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(videoBlob);

    video.muted = true;
    video.preload = 'metadata';
    video.playsInline = true;
    video.src = url;

    let timeoutId: number | null = null;

    // Set up event handlers
    video.onloadedmetadata = () => {
      if (timeoutId) clearTimeout(timeoutId);

      const info: VideoInfo = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        aspectRatio: video.videoWidth / video.videoHeight,
        size: videoBlob.size,
        type: videoBlob.type,
      };

      URL.revokeObjectURL(url);
      resolve(info);
    };

    video.onerror = () => {
      if (timeoutId) clearTimeout(timeoutId);
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load video metadata'));
    };

    // Add timeout
    timeoutId = window.setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error('Timeout loading video metadata'));
    }, 5000);

    // Start loading metadata
    video.load();
  });
}

/**
 * Check if a video blob is valid (has duration, not black/empty)
 * @param {Blob} videoBlob - The video blob to check
 * @returns {Promise<boolean>} Whether the video is valid
 */
async function isValidVideo(videoBlob: Blob): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    try {
      const video = document.createElement('video');
      const url = URL.createObjectURL(videoBlob);

      // Track if we've detected valid content
      let hasValidContent = false;
      let timeoutId: number | null = null;

      // Set up canvas to check for black frames
      const canvas = document.createElement('canvas');
      canvas.width = 320; // Small size is sufficient for detection
      canvas.height = 240;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        URL.revokeObjectURL(url);
        resolve(false);
        return;
      }

      video.muted = true;
      video.playsInline = true;
      video.src = url;

      // Check if the video has duration
      video.onloadedmetadata = () => {
        // Fail if video has no duration
        if (video.duration <= 0) {
          console.log('Invalid video: no duration');
          clearTimeout(timeoutId!);
          URL.revokeObjectURL(url);
          resolve(false);
          return;
        }

        // Small timeout to allow video to buffer
        setTimeout(() => {
          // Check frame at 0.1s (to skip any initial black frame)
          video.currentTime = 0.1;
        }, 100);
      };

      // Check for black frames
      video.onseeked = () => {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Check if the frame is black or transparent
        let isBlackOrTransparent = true;

        // Sample pixels (checking every 10th pixel for performance)
        for (let i = 0; i < data.length; i += 40) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          // If any pixel is not black, the frame is not black
          if (r > 5 || g > 5 || b > 5) {
            isBlackOrTransparent = false;
            break;
          }
        }

        if (!isBlackOrTransparent) {
          console.log('Video passed validation: contains non-black frames');
          hasValidContent = true;
          clearTimeout(timeoutId!);
          URL.revokeObjectURL(url);
          resolve(true);
          return;
        }

        // If we're here, the current frame was black, try another frame if available
        if (video.currentTime < Math.min(video.duration - 0.1, 1.0)) {
          video.currentTime += 0.3; // Check another frame
        } else {
          console.log('Invalid video: all checked frames are black');
          clearTimeout(timeoutId!);
          URL.revokeObjectURL(url);
          resolve(false);
        }
      };

      // Start loading the video
      video.load();

      // Set a timeout for the entire process
      timeoutId = window.setTimeout(() => {
        URL.revokeObjectURL(url);
        // If we hit the timeout but already found valid content, consider it valid
        resolve(hasValidContent);
      }, 5000);

      // Handle errors
      video.onerror = () => {
        console.log('Error validating video');
        clearTimeout(timeoutId!);
        URL.revokeObjectURL(url);
        resolve(false);
      };
    } catch (error) {
      console.error('Error in video validation:', error);
      resolve(false);
    }
  });
}

/**
 * Simple version of video compression that works better on mobile
 * This approach prioritizes reliability over quality
 */
async function simpleCompress(
  videoBlob: Blob,
  quality: string = 'medium',
  onProgress: (progress: number) => void
): Promise<Blob> {
  try {
    // If quality is 'original' or the video is small, return the original
    if (quality === 'original' || videoBlob.size < 5 * 1024 * 1024) {
      onProgress(100);
      return videoBlob;
    }

    // Get the video element and create a canvas
    const video = document.createElement('video');
    const url = URL.createObjectURL(videoBlob);
    video.src = url;
    video.muted = true;

    // Wait for metadata to load
    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(
        () => reject(new Error('Timeout loading video')),
        10000
      );
      video.onloadedmetadata = () => {
        clearTimeout(timeoutId);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timeoutId);
        reject(new Error('Error loading video'));
      };
      video.load();
    });

    // Get video dimensions
    const originalWidth = video.videoWidth;
    const originalHeight = video.videoHeight;

    // Skip if video is too small or has no dimensions
    if (originalWidth < 100 || originalHeight < 100) {
      URL.revokeObjectURL(url);
      onProgress(100);
      return videoBlob;
    }

    // Calculate target dimensions based on quality
    const settings = QUALITY_PRESETS[quality] || QUALITY_PRESETS.medium;
    if (!settings) {
      URL.revokeObjectURL(url);
      onProgress(100);
      return videoBlob;
    }

    // Scale dimensions
    let targetWidth: number;
    let targetHeight: number;
    if (originalHeight > originalWidth) {
      // Portrait video
      targetHeight = settings.width;
      targetWidth = Math.round(originalWidth * (targetHeight / originalHeight));
    } else {
      // Landscape video
      targetWidth = settings.width;
      targetHeight = Math.round(originalHeight * (targetWidth / originalWidth));
    }

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      URL.revokeObjectURL(url);
      onProgress(100);
      return videoBlob;
    }

    onProgress(20);

    // Create a MediaRecorder with limited options
    const mimeType = getBestSupportedMimeType();

    // Get an optimal bitrate
    const bitrate = Math.min(settings.bitrate, 2500000); // Cap at 2.5Mbps for reliability

    // Lower frame rate for better compatibility
    const frameRate = Math.min(settings.frameRate, 24);

    try {
      // @ts-ignore
      const stream = canvas.captureStream(frameRate);
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: bitrate,
      });

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      // Start recording
      mediaRecorder.start(1000);

      // Draw initial frame
      ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
      onProgress(30);

      // Play the video
      await video.play();

      // Use intervals instead of seeking for more reliable behavior
      const duration = video.duration;
      let elapsed = 0;
      const interval = 1000 / frameRate;

      // Return a promise that resolves when recording is complete
      return new Promise<Blob>((resolve) => {
        const drawFrame = () => {
          if (video.ended || elapsed >= duration) {
            mediaRecorder.stop();
            return;
          }

          ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
          elapsed += interval / 1000;

          // Update progress
          const progress = Math.min(90, 30 + (elapsed / duration) * 60);
          onProgress(Math.floor(progress));

          // Continue drawing frames
          requestAnimationFrame(drawFrame);
        };

        // Start drawing frames
        drawFrame();

        // Handle recording completion
        mediaRecorder.onstop = () => {
          URL.revokeObjectURL(url);

          if (chunks.length === 0) {
            console.warn('No chunks recorded, using original video');
            onProgress(100);
            resolve(videoBlob);
            return;
          }

          const newBlob = new Blob(chunks, { type: mimeType });

          // Verify the compressed video isn't empty
          if (newBlob.size < 1000) {
            console.warn('Compressed video too small, using original');
            onProgress(100);
            resolve(videoBlob);
            return;
          }

          onProgress(100);
          resolve(newBlob);
        };

        // Add a safety timeout
        setTimeout(
          () => {
            if (mediaRecorder.state !== 'inactive') {
              mediaRecorder.stop();
            }
          },
          Math.max(duration * 1500, 30000)
        ); // 1.5x video duration or 30 seconds, whichever is greater
      });
    } catch (error) {
      console.error('Error in MediaRecorder setup:', error);
      URL.revokeObjectURL(url);
      onProgress(100);
      return videoBlob;
    }
  } catch (error) {
    console.error('Simple compression failed:', error);
    onProgress(100);
    return videoBlob;
  }
}

export function EnhancedVideoUploadButton({
  videoBlob,
  cameraFacing,
  onProcessingComplete,
  onProcessingError,
  className = '',
  disabled = false,
  useDirectUpload = true,
  uploadOptions = {},
}: EnhancedVideoUploadProps) {
  // State for upload process
  const [uploading, setUploading] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [progressStage, setProgressStage] = useState<
    'compressing' | 'uploading' | null
  >(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // Video info
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfoState | null>(null);
  const [compressionStats, setCompressionStats] =
    useState<CompressionStats | null>(null);

  // Quality settings
  const [selectedQuality, setSelectedQuality] = useState<string>('auto');
  const [autoQuality, setAutoQuality] = useState<string>('medium');

  // Toast notifications
  const { toast } = useToast();

  // Update progress callback
  const updateProgress = (value: number) => {
    setProgress(value);
  };

  // Load video info when blob changes
  useEffect(() => {
    if (videoBlob) {
      getVideoInfo(videoBlob)
        .then((info) => {
          setVideoInfo(info);
          console.log('Video info:', info);
        })
        .catch((err) => console.error('Error getting video info:', err));
    }
  }, [videoBlob]);

  // Detect network conditions on mount and when connection changes
  useEffect(() => {
    const checkNetwork = () => {
      const networkConditions = detectNetworkConditions();
      setNetworkInfo(networkConditions);
      setAutoQuality(networkConditions.qualityRecommendation);
      console.log('Network conditions:', networkConditions);
    };

    // Check immediately
    checkNetwork();

    // Set up connection change listener if available
    const connection =
      navigator.connection ||
      (navigator as any).mozConnection ||
      (navigator as any).webkitConnection;

    if (connection) {
      connection.addEventListener('change', checkNetwork);
      return () => connection.removeEventListener('change', checkNetwork);
    }
  }, []);

  // Get effective quality setting (resolves 'auto' to the detected quality)
  const getEffectiveQuality = (): string => {
    return selectedQuality === 'auto' ? autoQuality : selectedQuality;
  };

  function checkCompressionSupport() {
    const checks = {
      mediaRecorder: typeof MediaRecorder !== 'undefined',
      canvas:
        typeof document.createElement('canvas').getContext('2d') !==
        'undefined',
      captureStream:
        typeof document.createElement('canvas').captureStream === 'function',
      videoElement:
        typeof document.createElement('video').canPlayType === 'function',
    };

    console.log('Compression support checks:', checks);
    return Object.values(checks).every(Boolean);
  }

  // Handler for the process button click
  const handleProcessVideoClick = async (): Promise<void> => {
    if (!videoBlob) {
      toast({
        title: 'Error',
        description: 'No video to process',
        variant: 'destructive',
      });
      return;
    }

    // Verify the source video is valid before attempting compression
    try {
      const isValid = await isValidVideo(videoBlob);
      if (!isValid) {
        toast({
          title: 'Invalid Video',
          description: 'The video appears to be empty or damaged',
          variant: 'destructive',
        });
        return;
      }
    } catch (error) {
      console.warn('Error validating video, continuing anyway:', error);
    }

    setUploading(true);
    setProgress(0);
    setProgressStage('compressing');
    setCompressionStats(null);

    try {
      // Determine which quality to use
      const effectiveQuality: string = getEffectiveQuality();

      // On mobile devices, consider using a lower quality or original
      const isMobile: boolean = isMobileDevice();
      const videoSize: number = videoBlob.size / (1024 * 1024); // Size in MB

      // For small videos on mobile, skip compression altogether
      let skipCompression: boolean = false;
      if (isMobile && videoSize < 5) {
        // Skip for videos under 5MB on mobile
        skipCompression = true;
        console.log('Small video on mobile device, skipping compression');
      }

      // Show initial toast
      toast({
        title: 'Processing Video',
        description:
          skipCompression || effectiveQuality === 'original'
            ? 'Preparing for upload...'
            : `Compressing video (${effectiveQuality} quality)...`,
      });

      // Compress the video if not using original quality and not skipping compression
      let processedBlob: Blob = videoBlob;
      let compressionResult: CompressionStats | null = null;

      if (!skipCompression && effectiveQuality !== 'original') {
        console.log(`Compressing video with ${effectiveQuality} quality`);
        try {
          // Use the simpler compression approach for better reliability
          processedBlob = await simpleCompress(
            videoBlob,
            effectiveQuality,
            (compressionProgress: number): void => {
              setProgress(compressionProgress);
            }
          );

          // Verify the compressed video is valid
          const isCompressedValid = await isValidVideo(processedBlob);

          if (!isCompressedValid || processedBlob.size < 1000) {
            console.warn('Compressed video is invalid, using original');
            toast({
              title: 'Compression Issue',
              description:
                'Using original video instead due to compression issue',
              variant: 'default',
            });
            processedBlob = videoBlob;
          } else if (processedBlob !== videoBlob) {
            // Calculate compression stats
            const originalSize: number = videoBlob.size / (1024 * 1024);
            const compressedSize: number = processedBlob.size / (1024 * 1024);
            const reduction: number = (1 - compressedSize / originalSize) * 100;

            compressionResult = {
              originalSize: originalSize.toFixed(2) + ' MB',
              compressedSize: compressedSize.toFixed(2) + ' MB',
              reduction: reduction.toFixed(1) + '%',
            };

            setCompressionStats(compressionResult);

            // Update toast with compression result
            toast({
              title: 'Video Compressed',
              description: `Reduced from ${originalSize.toFixed(1)}MB to ${compressedSize.toFixed(1)}MB (${reduction.toFixed(0)}% smaller)`,
              variant: 'default',
            });

            console.log('Compression complete:', compressionResult);
          }
        } catch (error) {
          console.error('Compression failed:', error);
          toast({
            title: 'Compression Failed',
            description: 'Using original video instead',
            variant: 'destructive',
          });
          // Fall back to original video
          processedBlob = videoBlob;
        }
      } else if (skipCompression) {
        // Just update progress for skipped compression
        setProgress(100);
        console.log('Compression skipped, using original video');
      }

      // Now upload the processed blob
      setProgressStage('uploading');
      setProgress(0);

      toast({
        title: 'Uploading',
        description: compressionResult
          ? `Uploading compressed video (${compressionResult.compressedSize})`
          : 'Uploading original video...',
      });

      // Use the uploadVideoDirectly function
      const result: ProcessVideoResponse = await uploadVideoDirectly(
        processedBlob,
        {
          cameraFacing,
          quality: effectiveQuality as any, // Convert to your accepted quality types
          onProgress: updateProgress,
          ...uploadOptions,
        }
      );

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
      setProgressStage(null);
    }
  };

  // Get network quality indicator
  const getNetworkIndicator = () => {
    if (!networkInfo) return null;

    const { effectiveType } = networkInfo;

    if (effectiveType === '4g') {
      return {
        icon: <Wifi className="h-4 w-4 text-green-500" />,
        label: 'Fast',
      };
    } else if (effectiveType === '3g') {
      return {
        icon: <Wifi className="h-4 w-4 text-yellow-500" />,
        label: 'Medium',
      };
    } else {
      return {
        icon: <WifiOff className="h-4 w-4 text-red-500" />,
        label: 'Slow',
      };
    }
  };

  // Format size for display
  const formatSize = (bytes: number): string => {
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + ' KB';
    }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Get progress label based on stage
  const getProgressLabel = (): string => {
    if (!progressStage) return '';

    switch (progressStage) {
      case 'compressing':
        return `Compressing ${progress}%`;
      case 'uploading':
        return `Uploading ${progress}%`;
      default:
        return `${progress}%`;
    }
  };

  // Network indicator
  const networkIndicator = getNetworkIndicator();

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <button
          className={`flex-1 px-4 py-2 bg-blue-500 text-white rounded-md disabled:opacity-50 ${className}`}
          onClick={handleProcessVideoClick}
          disabled={uploading || !videoBlob || disabled}
        >
          {uploading
            ? getProgressLabel() ||
              `Uploading ${progress ? `${progress}%` : '...'}`
            : 'Upload Video'}
        </button>

        <button
          className="px-2 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md disabled:opacity-50"
          onClick={() => setIsSettingsOpen(!isSettingsOpen)}
          disabled={uploading || disabled}
          title="Upload Settings"
        >
          <Settings className="h-5 w-5" />
        </button>
      </div>

      {uploading && progress > 0 && (
        <div className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-full mt-2 overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-300 ease-in-out"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
      )}

      {/* Settings panel */}
      {isSettingsOpen && (
        <div className="absolute z-10 mt-1 p-3 bg-white dark:bg-gray-800 rounded-md border border-gray-300 dark:border-gray-700 shadow-lg w-full">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-sm font-medium">Upload Settings</h3>
            <button
              onClick={() => setIsSettingsOpen(false)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Network status */}
          {networkIndicator && (
            <div className="flex items-center gap-1.5 mb-3 text-sm">
              {networkIndicator.icon}
              <span>
                Network: {networkIndicator.label}
                {networkInfo?.downlink &&
                  ` (${networkInfo.downlink.toFixed(1)} Mbps)`}
              </span>
            </div>
          )}

          {/* Video info */}
          {videoInfo && (
            <div className="mb-3 text-sm text-gray-500 dark:text-gray-300">
              <div>
                Original: {formatSize(videoInfo.size)} • {videoInfo.width}×
                {videoInfo.height} • {videoInfo.duration.toFixed(1)}s
              </div>
            </div>
          )}

          {/* Quality selector */}
          <div className="mb-3">
            <label className="block text-sm font-medium mb-1">
              Upload Quality:
            </label>
            <select
              className="w-full p-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
              value={selectedQuality}
              onChange={(e) => setSelectedQuality(e.target.value)}
              disabled={uploading}
            >
              <option value="auto">
                Auto (Based on Network) - {autoQuality}
              </option>
              <option value="original">
                Original Quality (No Compression)
              </option>
              <option value="high">High Quality (Slower Upload)</option>
              <option value="medium">Medium Quality (Balanced)</option>
              <option value="low">Low Quality (Faster Upload)</option>
              <option value="very-low">
                Very Low Quality (Fastest Upload)
              </option>
            </select>
          </div>

          {/* Estimated file size */}
          {videoInfo &&
            selectedQuality !== 'original' &&
            selectedQuality !== 'auto' && (
              <div className="text-xs text-gray-400 mb-3">
                <div>
                  Estimated compressed size:
                  {selectedQuality === 'very-low' &&
                    ` ~${formatSize(videoInfo.size * 0.15)}`}
                  {selectedQuality === 'low' &&
                    ` ~${formatSize(videoInfo.size * 0.25)}`}
                  {selectedQuality === 'medium' &&
                    ` ~${formatSize(videoInfo.size * 0.4)}`}
                  {selectedQuality === 'high' &&
                    ` ~${formatSize(videoInfo.size * 0.6)}`}
                </div>
              </div>
            )}

          {/* Upload time estimate */}
          {videoInfo && networkInfo?.downlink && networkInfo.downlink > 0 && (
            <div className="text-xs text-gray-400 mb-3">
              <div>
                {selectedQuality === 'original'
                  ? `Estimated upload time: ${(((videoInfo.size * 8) / (networkInfo.downlink * 1000000)) * 1.5).toFixed(1)}s`
                  : selectedQuality === 'auto'
                    ? `Estimated upload time: ${(((videoInfo.size * 8 * (autoQuality === 'very-low' ? 0.15 : autoQuality === 'low' ? 0.25 : autoQuality === 'medium' ? 0.4 : 0.6)) / (networkInfo.downlink * 1000000)) * 1.5).toFixed(1)}s`
                    : `Estimated upload time: ${(((videoInfo.size * 8 * (selectedQuality === 'very-low' ? 0.15 : selectedQuality === 'low' ? 0.25 : selectedQuality === 'medium' ? 0.4 : 0.6)) / (networkInfo.downlink * 1000000)) * 1.5).toFixed(1)}s`}
              </div>
            </div>
          )}

          {/* Compression stats if we've done compression */}
          {compressionStats && (
            <div className="mt-2 p-2 bg-gray-700 rounded text-sm">
              <div className="font-medium mb-1 flex items-center gap-1">
                <CheckCircle className="h-3.5 w-3.5 text-green-400" />
                <span>Compression Results</span>
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs">
                <div>Original:</div>
                <div>{compressionStats.originalSize}</div>
                <div>Compressed:</div>
                <div>{compressionStats.compressedSize}</div>
                <div>Reduction:</div>
                <div className="text-green-400">
                  {compressionStats.reduction}
                </div>
              </div>
            </div>
          )}

          {/* Tips */}
          <div className="flex items-start gap-1.5 mt-3 text-xs text-gray-400">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <span>
              Lower quality enables faster uploads on slow connections. Auto
              mode selects appropriate quality based on your network speed.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
