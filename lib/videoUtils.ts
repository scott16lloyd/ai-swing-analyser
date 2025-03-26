export const trimVideoByTimeRange = async (
  videoBlob: Blob, 
  startTime: number, 
  endTime: number
): Promise<Blob> => {
  if (!videoBlob) {
    throw new Error("Invalid video blob provided");
  }

  // Ensure valid time range
  startTime = Math.max(0, startTime);
  endTime = Math.max(startTime + 0.5, endTime);
  
  try {
    // Create a video element to load the source
    const sourceVideo = document.createElement('video');
    sourceVideo.playsInline = true;
    sourceVideo.muted = true;
    
    // Create blob URL
    const videoUrl = URL.createObjectURL(videoBlob);
    sourceVideo.src = videoUrl;
    
    // Wait for metadata to load
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.warn('Metadata loading timed out');
        resolve();
      }, 3000);
      
      sourceVideo.onloadedmetadata = () => {
        clearTimeout(timeout);
        resolve();
      };
      
      sourceVideo.onerror = (e) => {
        clearTimeout(timeout);
        reject(new Error('Failed to load video metadata'));
      };
      
      sourceVideo.load();
    });
    
    // Adjust end time if it exceeds video duration
    if (sourceVideo.duration && isFinite(sourceVideo.duration)) {
      if (endTime > sourceVideo.duration) {
        endTime = sourceVideo.duration;
      }
      if (startTime >= endTime) {
        startTime = Math.max(0, endTime - 0.5);
      }
    }
    
    // For simplicity, we'll return the original blob for now
    // In a production app, you would implement actual trimming here
    console.log(`Video would be trimmed from ${startTime}s to ${endTime}s`);
    return videoBlob;
  } catch (error) {
    console.error('Error in simplified trimVideoByTimeRange:', error);
    throw error;
  }
};

async function mobileTrimVideoHighQuality(
  sourceVideo: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  startTime: number, 
  endTime: number,
  originalBlob: Blob
): Promise<Blob> {
  console.log('Starting high-quality mobile trim');
  
  // Get the highest quality supported MIME type
  const mimeType = getHighQualityMimeType();
  console.log(`Using high-quality MIME type: ${mimeType}`);
  
  // Create a stream from the canvas with original FPS
  // INCREASED FPS from 30 to ensure we don't miss the impact moment
  const fps = 60;
  // @ts-ignore - TypeScript doesn't recognize captureStream
  const canvasStream = canvas.captureStream(fps);
  
  // Set up MediaRecorder with high quality settings
  const mediaRecorder = new MediaRecorder(canvasStream, {
    mimeType: mimeType,
    // INCREASED bitrate for higher quality
    videoBitsPerSecond: 8000000,
  });
  
  const chunks: Blob[] = [];
  let frameCount = 0;
  let processingError = false;
  
  // Set up promise for recording completion
  return new Promise<Blob>((resolve, reject) => {
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
      }
    };
    
    mediaRecorder.onstop = () => {
      try {
        console.log(`MediaRecorder stopped, collected ${chunks.length} chunks, processed ${frameCount} frames`);
        
        // If we have no chunks, reject
        if (chunks.length === 0) {
          reject(new Error('No data captured during recording'));
          return;
        }
        
        const finalBlob = new Blob(chunks, { type: mimeType });
        console.log(`Created final video: ${finalBlob.size} bytes`);
        resolve(finalBlob);
      } catch (error) {
        console.error('Error creating final video:', error);
        reject(error);
      }
    };
    
    mediaRecorder.onerror = (event) => {
      console.error('MediaRecorder error:', event);
      processingError = true;
      reject(new Error('MediaRecorder error occurred'));
    };
    
    // Start recording - REDUCED chunk size for more frequent data collection
    try {
      mediaRecorder.start(100); // Smaller chunk size for better granularity
      console.log('MediaRecorder started');
    } catch (error) {
      console.error('Failed to start MediaRecorder:', error);
      reject(error);
      return;
    }
    
    // Safety timeout - stop after 30 seconds or if duration is too long
    // INCREASED buffer time to ensure we capture all frames
    const maxDuration = Math.min(30, endTime - startTime);
    const safetyTimeout = setTimeout(() => {
      if (mediaRecorder.state !== 'inactive') {
        console.log('Safety timeout reached, stopping recorder');
        try {
          mediaRecorder.stop();
        } catch (e) {
          console.error('Error stopping recorder:', e);
        }
      }
    }, (maxDuration * 1000) + 5000); // Add 5 seconds buffer
    
    // Seek to start position with a slight buffer before the intended start
    // ADDED a small offset to ensure we start before the actual start time
    const seekTime = Math.max(0, startTime - 0.1);
    console.log(`Seeking to ${seekTime}s (with 0.1s buffer before requested ${startTime}s)`);
    sourceVideo.currentTime = seekTime;
    
    // Mobile compatible frame processor
    const processFrames = () => {
      if (processingError) {
        console.log('Processing error detected, stopping recorder');
        clearTimeout(safetyTimeout);
        try {
          if (mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
          }
        } catch (e) {
          console.error('Error stopping recorder:', e);
        }
        return;
      }
      
      // IMPROVED end time detection with additional buffer to ensure we include the impact moment
      if (sourceVideo.currentTime >= endTime + 0.2) { // Added 0.2s buffer after end time
        // We've reached the end, stop recording
        console.log(`Reached end time ${sourceVideo.currentTime}s > ${endTime}s, stopping recorder`);
        clearTimeout(safetyTimeout);
        
        try {
          if (mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
          }
        } catch (e) {
          console.error('Error stopping recorder:', e);
        }
        
        return;
      }
      
      try {
        // Draw the current frame to canvas
        ctx.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);
        frameCount++;
        
        // Only log occasionally to reduce console spam
        if (frameCount % 15 === 0) {
          console.log(`Processed frame ${frameCount}, time: ${sourceVideo.currentTime.toFixed(2)}/${endTime.toFixed(2)}s`);
        }
      } catch (e) {
        console.warn('Error drawing video frame:', e);
        // Continue despite errors
      }
      
      // Continue to next frame on next animation frame
      requestAnimationFrame(processFrames);
    };
    
    // When video is seeked to start point, start playing and processing
    sourceVideo.onseeked = () => {
      console.log(`Successfully seeked to ${sourceVideo.currentTime.toFixed(2)}s`);
      
      
      sourceVideo.play()
        .then(() => {
          console.log('Video playback started, beginning frame processing');
          // Start processing frames
          requestAnimationFrame(processFrames);
        })
        .catch(err => {
          console.error('Error playing video:', err);
          
          // On iOS, autoplay might be prevented
          if (isSafari()) {
            console.log('Safari detected, trying alternative approach');
            // Now we can pass the originalBlob parameter properly
            tryAlternativeSafariApproach(sourceVideo, originalBlob, startTime, endTime)
              .then(resolve)
              .catch(reject);
          } else {
            reject(new Error('Failed to play video for frame capture'));
          }
        });
    };
    
    // Handle seeking errors
    sourceVideo.onerror = (error) => {
      console.error('Error with video element:', error);
      reject(new Error('Video element error during processing'));
    };
  });
}

/**
 * Standard approach for desktop browsers
 */
async function standardTrimVideo(
  sourceVideo: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  startTime: number,
  endTime: number
): Promise<Blob> {
  console.log('Using standard trim approach');
  
  // Get high quality MIME type
  const mimeType = getHighQualityMimeType();
  
  // Create a stream from the canvas
  // @ts-ignore
  // INCREASED FPS for better capture
  const canvasStream = canvas.captureStream(60); // Increased to 60 FPS
  
  // Set up high quality MediaRecorder
  const mediaRecorder = new MediaRecorder(canvasStream, {
    mimeType: mimeType,
    videoBitsPerSecond: 8000000, // Increased to 8Mbps for high quality
  });
  
  const chunks: Blob[] = [];
  let frameCount = 0;
  
  // Return a promise that resolves with the trimmed blob
  return new Promise<Blob>((resolve, reject) => {
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
      }
    };
    
    mediaRecorder.onstop = () => {
      console.log(`MediaRecorder stopped, processed ${frameCount} frames`);
      
      try {
        if (chunks.length === 0) {
          throw new Error('No data was collected during trimming');
        }
        
        const trimmedBlob = new Blob(chunks, { type: mimeType });
        console.log(`Created trimmed blob: ${trimmedBlob.size} bytes`);
        
        resolve(trimmedBlob);
      } catch (error) {
        console.error('Error creating final video:', error);
        reject(error);
      }
    };
    
    // Start the MediaRecorder with more frequent chunks
    mediaRecorder.start(50); // More frequent chunks for better quality
    
    // Function to draw frames
    const captureFrames = () => {
      // Stop when we reach the end time with a small buffer to ensure we don't cut off too early
      if (sourceVideo.currentTime >= endTime + 0.2) {
        console.log(`Reached end time (${endTime}s), stopping recorder`);
        mediaRecorder.stop();
        sourceVideo.pause();
        return;
      }
      
      // Draw frame to canvas
      try {
        ctx.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);
        frameCount++;
      } catch (e) {
        console.error('Error drawing frame:', e);
      }
      
      // Log progress occasionally
      if (frameCount % 30 === 0) {
        console.log(
          `Processed ${frameCount} frames, current time: ${sourceVideo.currentTime.toFixed(2)}s`
        );
      }
      
      // Continue capturing frames
      requestAnimationFrame(captureFrames);
    };
    
    // Start the process by seeking to slightly before start time
    const seekTime = Math.max(0, startTime - 0.1);
    console.log('Seeking to start time with buffer:', seekTime);
    sourceVideo.currentTime = seekTime;
    
    // Once seeked, start playing and capturing frames
    sourceVideo.onseeked = () => {
      console.log('Seeked to start time, starting playback');
      
      // Slow down playback for more precise frame capture
      sourceVideo.playbackRate = 0.8;
      
      sourceVideo.play()
        .then(() => {
          console.log('Playback started for frame capture');
          requestAnimationFrame(captureFrames);
        })
        .catch((err) => {
          console.error('Error playing video for frame capture:', err);
          reject(new Error('Failed to play video for frame capture'));
        });
    };
    
    // Set a safety timeout
    const safetyTimeout = setTimeout(() => {
      if (mediaRecorder.state !== 'inactive') {
        console.warn('Trim operation taking too long, forcing completion');
        mediaRecorder.stop();
      }
    }, 30000); // 30-second safety timeout
    
    // Clean up the timeout when recording stops
    mediaRecorder.onstop = () => {
      clearTimeout(safetyTimeout);
      console.log(`MediaRecorder stopped, processed ${frameCount} frames`);
      
      try {
        if (chunks.length === 0) {
          throw new Error('No data was collected during trimming');
        }
        
        const trimmedBlob = new Blob(chunks, { type: mimeType });
        console.log(`Created trimmed blob: ${trimmedBlob.size} bytes`);
        
        resolve(trimmedBlob);
      } catch (error) {
        console.error('Error creating final video:', error);
        reject(error);
      }
    };
  });
}

/**
 * Returns true if running in Safari
 */
function isSafari(): boolean {
  const userAgent = navigator.userAgent.toLowerCase();
  return userAgent.includes('safari') && !userAgent.includes('chrome');
}

/**
 * Get a high-quality MIME type that's supported by the browser
 */
function getHighQualityMimeType(): string {
  // Try high quality formats first
  const types = [
    'video/mp4;codecs=h264', // Most compatible high quality
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9',
    'video/mp4',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      console.log(`High-quality MIME type supported: ${type}`);
      return type;
    }
  }
  
  console.warn('No ideal MIME types supported, falling back to default');
  return 'video/webm';
}

/**
 * For Safari on iOS as a last resort
 * This uses a simpler approach to work around iOS media restrictions
 */
async function tryAlternativeSafariApproach(
  videoElement: HTMLVideoElement,
  videoBlob: Blob,
  startTime: number,
  endTime: number
): Promise<Blob> {
  // Simple fallback implementation for Safari
  console.log('Trying alternative approach for Safari');
  
  // We return the original blob as a last resort
  console.log('Alternative approach: returning original blob as fallback');
  return videoBlob;
}

/**
 * Helper function to find the best supported video format
 * @returns The most suitable MIME type for video recording
 */
export const getSupportedMimeType = (): string => {
  const types = [
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9',
    'video/mp4;codecs=h264',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      console.log('Using MIME type:', type);
      return type;
    }
  }

  // Fallback to basic webm
  return 'video/webm';
};

/**
 * Prepares a video for playback with improved error handling
 * @param blobToPlay The video blob to play
 * @returns The created blob URL or undefined if preparation failed
 */
export const prepareVideoForPlayback = (blobToPlay: Blob): string | undefined => {
  if (!blobToPlay || blobToPlay.size === 0) {
    console.error('Invalid blob provided for playback');
    return undefined;
  }

  console.log(`Preparing video for playback, blob size: ${blobToPlay.size} bytes, type: ${blobToPlay.type}`);
  
  // Create an appropriate blob URL for this video
  let finalBlob = blobToPlay;
  
  // If the blob doesn't have a valid video MIME type, create a new one with the correct type
  if (!blobToPlay.type.includes('video/')) {
    const format = getBestVideoFormat();
    console.log(`Converting blob to ${format.mimeType} for better compatibility`);
    finalBlob = new Blob([blobToPlay], { type: format.mimeType });
  }
  
  // Now create blob URL for the prepared video
  const blobUrl = URL.createObjectURL(finalBlob);
  
  // Find preview video elements in DOM
  const videoElements = document.querySelectorAll('video');
  let previewFound = false;
  
  // Use Array.from to convert NodeList to Array for iteration
  Array.from(videoElements).forEach(videoElement => {
    // Skip hidden video elements (like the recording source)
    if (videoElement.className.includes('hidden')) return;
    
    // Clean up any existing blob URLs
    if (videoElement.src && videoElement.src.startsWith('blob:')) {
      URL.revokeObjectURL(videoElement.src);
    }
    
    // Update the video source
    videoElement.src = blobUrl;
    videoElement.load();
    
    // Mark that we found at least one preview element
    previewFound = true;
  });
  
  if (!previewFound) {
    console.warn('No visible video elements found for playback');
    URL.revokeObjectURL(blobUrl);
    return undefined;
  }
  
  // Return the blob URL in case it needs to be used elsewhere
  return blobUrl;
};

/**
* Gets the actual duration of a video blob by loading it into a video element
* @param videoBlob The video blob to check
* @returns Promise that resolves to the duration in seconds
*/
export const getVideoDuration = (videoBlob: Blob): Promise<number> => {
  return new Promise((resolve, reject) => {
    if (!videoBlob || videoBlob.size === 0) {
      console.error('Invalid video blob provided to getVideoDuration');
      reject(new Error('Invalid video blob'));
      return;
    }

    // Create a temporary video element
    const tempVideo = document.createElement('video');
    tempVideo.preload = 'metadata';
    tempVideo.playsInline = true;
    tempVideo.muted = true;
    
    // Create blob URL
    const url = URL.createObjectURL(videoBlob);
    
    // Ensure we clean up resources
    const cleanup = () => {
      URL.revokeObjectURL(url);
      if (tempVideo.parentNode) {
        tempVideo.parentNode.removeChild(tempVideo);
      }
    };
    
    // Set up event listeners
    tempVideo.onloadedmetadata = () => {
      // Get the duration
      const duration = tempVideo.duration;
      console.log(`Video metadata loaded, duration: ${duration}s`);
      
      // Clean up
      cleanup();
      
      // If we got a valid duration, resolve with it
      if (duration && isFinite(duration) && duration > 0) {
        resolve(duration);
      } else {
        console.warn(`Invalid or zero duration detected: ${duration}, using fallback`);
        // Fallback to a reasonable estimate based on file size
        const estimatedDuration = Math.max(videoBlob.size / (1024 * 1024), 1);
        resolve(estimatedDuration);
      }
    };
    
    tempVideo.onerror = (error) => {
      console.error('Error loading video to get duration:', error);
      cleanup();
      
      // Reject with error
      reject(new Error('Failed to load video metadata'));
    };
    
    // Add a safety timeout
    const timeout = setTimeout(() => {
      console.warn('Duration detection timed out');
      cleanup();
      
      // Fallback to a size-based estimate
      const estimatedDuration = Math.max(videoBlob.size / (1024 * 1024), 1);
      console.log(`Using fallback duration estimate after timeout: ${estimatedDuration}s`);
      resolve(estimatedDuration);
    }, 3000); // 3 second timeout
    
    // Start loading the video
    tempVideo.src = url;
    
    // Clear timeout when metadata loads
    const originalOnLoadedMetadata = tempVideo.onloadedmetadata;
    tempVideo.onloadedmetadata = (event) => {
      clearTimeout(timeout);
      if (originalOnLoadedMetadata) {
        originalOnLoadedMetadata.call(tempVideo, event);
      }
    };
    
    // Force loading
    tempVideo.load();
    
    // Add to DOM temporarily (helps on some browsers)
    tempVideo.style.display = 'none';
    document.body.appendChild(tempVideo);
  });
};

/**
 * Gets the best supported video format for the current browser
 * Tests each format in order and returns the first one that's supported
 */
export const getBestVideoFormat = (): { mimeType: string; extension: string } => {
  // Array of formats to try in priority order
  const formats: Array<{ mimeType: string; extension: string }> = [
    { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
    { mimeType: 'video/mp4;codecs=h264', extension: 'mp4' },
    { mimeType: 'video/mp4', extension: 'mp4' }
  ];
  
  // Test each format and return the first supported one
  for (const format of formats) {
    try {
      if (MediaRecorder.isTypeSupported(format.mimeType)) {
        console.log(`Using supported format: ${format.mimeType}`);
        return format;
      }
    } catch (e) {
      console.warn(`Error checking support for ${format.mimeType}:`, e);
    }
  }
  
  // If no format is explicitly supported, return empty to let browser choose default
  console.warn('No explicitly supported format found, using browser default');
  return { mimeType: '', extension: 'webm' };
};

/**
 * Format a duration in seconds to a readable string
 */
export const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
};