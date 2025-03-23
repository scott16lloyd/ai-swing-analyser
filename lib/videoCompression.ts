/**
 * Utility for compressing videos before upload to improve performance on slow connections
 * 
 * This file provides functions to:
 * - Detect network conditions
 * - Compress videos with appropriate quality settings
 * - Provide progress updates during compression
 */

// Network information type definition
type NetworkInformation = {
    type?: string;
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
  };
  
  // Extend Navigator interface to include connection property
  declare global {
    interface Navigator {
      connection?: NetworkInformation;
      mozConnection?: NetworkInformation;
      webkitConnection?: NetworkInformation;
    }
  }
  
  // Network detection result type
  interface NetworkConditionsResult {
    type: string | null;
    effectiveType: string | null;
    downlink: number | null;
    rtt: number | null;
    qualityRecommendation: string;
    chunkSize: number;
  }
  
  // Video information type
  interface VideoInfo {
    duration: number;
    width: number;
    height: number;
    aspectRatio: number;
    size: number;
    type: string;
  }
  
  // Quality preset type
  interface QualityPreset {
    width: number;
    height: number;
    bitrate: number;
    frameRate: number;
  }
  
  // Compression options type
  interface CompressVideoOptions {
    quality?: string;
    onProgress?: (progress: number) => void;
    maxDuration?: number;
  }
  
  /**
   * Detects current network conditions and recommends compression settings
   * @returns {NetworkConditionsResult} Network condition information and recommended settings
   */
  export const detectNetworkConditions = (): NetworkConditionsResult => {
    // Get network information if available
    const connection = navigator.connection || 
                       (navigator.mozConnection) || 
                       (navigator.webkitConnection) || null;
    
    // Default to medium quality if we can't detect network
    if (!connection) {
      console.log('Network information API not available, assuming medium quality');
      return {
        type: null,
        effectiveType: null,
        downlink: null,
        rtt: null,
        qualityRecommendation: 'medium',
        chunkSize: 512 * 1024 // 512KB default chunk size
      };
    }
    
    console.log('Network conditions:', {
      type: connection.type,
      effectiveType: connection.effectiveType,
      downlink: connection.downlink,
      rtt: connection.rtt
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
      chunkSize
    };
  };
  
  /**
   * Quality presets for video compression
   */
  export const QUALITY_PRESETS: Record<string, QualityPreset | null> = {
    'very-low': {
      width: 480,  // 480p
      height: 270,
      bitrate: 800000, // 800Kbps
      frameRate: 24
    },
    'low': {
      width: 640,  // 640p
      height: 360,
      bitrate: 1200000, // 1.2Mbps
      frameRate: 24
    },
    'medium': {
      width: 854,  // 854p
      height: 480,
      bitrate: 2500000, // 2.5Mbps
      frameRate: 30
    },
    'high': {
      width: 1280, // 720p
      height: 720,
      bitrate: 5000000, // 5Mbps
      frameRate: 30
    },
    'original': null // No compression
  };
  
  /**
   * Returns the best supported video format for MediaRecorder
   * @returns {string} MIME type
   */
  export const getBestSupportedMimeType = (): string => {
    const types = [
      'video/mp4;codecs=h264',
      'video/webm;codecs=h264',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log(`Using MIME type: ${type}`);
        return type;
      }
    }
    
    console.warn('No preferred MIME types supported, using default');
    return 'video/webm';
  };
  
  /**
   * Compresses a video blob to a lower quality for faster uploads
   * 
   * @param {Blob} videoBlob - The original video blob
   * @param {CompressVideoOptions} options - Compression options
   * @returns {Promise<Blob>} - Compressed video blob
   */
  export const compressVideo = async (videoBlob: Blob, options: CompressVideoOptions = {}): Promise<Blob> => {
    // Default options
    const {
      quality = 'medium',
      onProgress = (progress: number) => console.log(`Compression progress: ${progress}%`),
      maxDuration = 15 // Default max duration
    } = options;
    
    onProgress(0);
    
    // If quality is 'original', return the original blob
    if (quality === 'original') {
      onProgress(100);
      return videoBlob;
    }
    
    // Get quality settings
    const settings = QUALITY_PRESETS[quality] || QUALITY_PRESETS.medium;
    if (!settings) {
      console.warn('Invalid quality setting, using medium quality');
      return compressVideo(videoBlob, { ...options, quality: 'medium' });
    }
    
    console.log('Using compression settings:', settings);
    
    // Create a video element to load the original video
    const sourceVideo = document.createElement('video');
    sourceVideo.muted = true;
    sourceVideo.playsInline = true;
    
    try {
      // Create URL for the video blob
      const videoUrl = URL.createObjectURL(videoBlob);
      sourceVideo.src = videoUrl;
      
      // Wait for metadata to load
      await new Promise<void>((resolve, reject) => {
        let timeoutId: number | null = null;
        
        sourceVideo.onloadedmetadata = () => {
          if (timeoutId) clearTimeout(timeoutId);
          resolve();
        };
        
        sourceVideo.onerror = (event) => {
          if (timeoutId) clearTimeout(timeoutId);
          reject(new Error(`Error loading video: ${sourceVideo.error?.message || 'Unknown error'}`));
        };
        
        // Set a timeout in case metadata loading hangs
        timeoutId = window.setTimeout(() => {
          reject(new Error('Timeout loading video metadata'));
        }, 5000);
      });
      
      // Get the video dimensions and duration
      const originalWidth = sourceVideo.videoWidth;
      const originalHeight = sourceVideo.videoHeight;
      const originalDuration = sourceVideo.duration;
      
      console.log('Original video:', {
        width: originalWidth,
        height: originalHeight,
        duration: originalDuration.toFixed(2) + 's',
        size: (videoBlob.size / (1024 * 1024)).toFixed(2) + 'MB'
      });
      
      // Calculate target dimensions while maintaining aspect ratio
      const aspectRatio = originalWidth / originalHeight;
      
      // If the video is portrait, swap width and height in our calculations
      let targetWidth: number;
      let targetHeight: number;
      
      if (originalHeight > originalWidth) {
        // Portrait video
        targetHeight = settings.width;
        targetWidth = Math.round(settings.width / aspectRatio);
      } else {
        // Landscape video
        targetWidth = settings.width;
        targetHeight = Math.round(settings.width / aspectRatio);
      }
      
      // Ensure dimensions are even (required by some encoders)
      targetWidth = Math.floor(targetWidth / 2) * 2;
      targetHeight = Math.floor(targetHeight / 2) * 2;
      
      console.log('Target dimensions:', targetWidth, 'x', targetHeight);
      
      // Create a canvas for the compressed video frames
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d', { alpha: false });
      
      if (!ctx) {
        throw new Error('Failed to get 2D context from canvas');
      }
      
      // Get the best supported MIME type
      const mimeType = getBestSupportedMimeType();
      
      // Set up parameters for MediaRecorder
      const recorderOptions: MediaRecorderOptions = {
        mimeType,
        videoBitsPerSecond: settings.bitrate
      };
      
      // Create a MediaRecorder with the canvas stream
      // @ts-ignore - TypeScript doesn't fully recognize captureStream
      const stream = canvas.captureStream(settings.frameRate);
      const mediaRecorder = new MediaRecorder(stream, recorderOptions);
      
      // Store the recorded chunks
      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };
      
      // Start recording
      mediaRecorder.start(1000); // Capture in 1-second chunks
      
      // Calculate actual duration to process (respecting maxDuration)
      const duration = Math.min(originalDuration, maxDuration);
      console.log(`Processing ${duration.toFixed(2)}s of video`);
      
      // Track frame count for progress updates
      let processedFrames = 0;
      const totalFrames = Math.ceil(duration * settings.frameRate);
      
      // Disable image smoothing for faster rendering
      ctx.imageSmoothingQuality = 'low';
      
      // Process video frames
      return new Promise<Blob>((resolve, reject) => {
        // Set up completion handling
        mediaRecorder.onstop = () => {
          try {
            // Create final compressed video blob
            const compressedBlob = new Blob(chunks, { type: mimeType });
            
            console.log('Compression complete:', {
              originalSize: (videoBlob.size / (1024 * 1024)).toFixed(2) + 'MB',
              compressedSize: (compressedBlob.size / (1024 * 1024)).toFixed(2) + 'MB',
              reductionPercent: Math.round((1 - compressedBlob.size / videoBlob.size) * 100) + '%'
            });
            
            // Clean up
            URL.revokeObjectURL(sourceVideo.src);
            onProgress(100);
            resolve(compressedBlob);
          } catch (error) {
            console.error('Error creating compressed video:', error);
            reject(error);
          }
        };
        
        // Set up error handling
        mediaRecorder.onerror = (event) => {
          console.error('MediaRecorder error:', event);
          reject(new Error('Error during video compression'));
        };
        
        // Function to draw a frame at the specified time
        const drawFrameAtTime = (time: number) => {
          try {
            // Draw the current frame to canvas
            ctx.drawImage(sourceVideo, 0, 0, targetWidth, targetHeight);
            
            // Update progress
            processedFrames++;
            const progress = Math.min(95, Math.round((processedFrames / totalFrames) * 100));
            
            // Only update progress every few frames to avoid excessive UI updates
            if (processedFrames % 5 === 0) {
              onProgress(progress);
            }
            
            // If we've reached the end, stop recording
            if (time >= duration || sourceVideo.ended) {
              console.log(`Reached end of video at ${time.toFixed(2)}s`);
              mediaRecorder.stop();
              return;
            }
            
            // Otherwise, move to next frame
            sourceVideo.currentTime = Math.min(
              time + (1 / settings.frameRate),
              duration
            );
          } catch (error) {
            console.error('Error drawing frame:', error);
            // Try to continue despite errors
          }
        };
        
        // Handle seeking to a specific time
        sourceVideo.onseeked = () => {
          // Get current time and process the frame
          const currentTime = sourceVideo.currentTime;
          drawFrameAtTime(currentTime);
        };
        
        // Handle errors
        sourceVideo.onerror = (error) => {
          console.error('Video error during compression:', error);
          reject(new Error('Error processing video for compression'));
        };
        
        // Start the process by seeking to the beginning
        sourceVideo.currentTime = 0;
      });
    } catch (error) {
      console.error('Video compression failed:', error);
      // If compression fails, return the original
      return videoBlob;
    }
  };
  
  /**
   * Utility function to read basic video information without loading the full video
   * @param {Blob} videoBlob - Video blob to analyze
   * @returns {Promise<VideoInfo>} Video information
   */
  export const getVideoInfo = async (videoBlob: Blob): Promise<VideoInfo> => {
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
          type: videoBlob.type
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
  };
  
  /**
   * Helper function to estimate file size after compression
   * @param {VideoInfo} videoInfo - Video information from getVideoInfo()
   * @param {string} quality - Quality preset
   * @returns {number} Estimated compressed size in bytes
   */
  export const estimateCompressedSize = (videoInfo: VideoInfo, quality: string): number => {
    if (quality === 'original') return videoInfo.size;
    
    const settings = QUALITY_PRESETS[quality] || QUALITY_PRESETS.medium;
    if (!settings) return videoInfo.size;
    
    // Calculate compression ratio based on resolution and bitrate
    const resolutionRatio = (settings.width * settings.height) / (videoInfo.width * videoInfo.height);
    
    // Estimate bitrate of original video
    const originalBitrate = videoInfo.size * 8 / videoInfo.duration;
    
    // Calculate bitrate ratio
    const bitrateRatio = settings.bitrate / originalBitrate;
    
    // Combined ratio with greater weight on bitrate (more important factor)
    const combinedRatio = (bitrateRatio * 0.7) + (resolutionRatio * 0.3);
    
    // Estimated size
    const estimatedSize = videoInfo.size * combinedRatio;
    
    return Math.max(estimatedSize, videoInfo.size * 0.1); // At least 10% of original
  };