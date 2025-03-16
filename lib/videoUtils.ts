/**
 * Trims a video blob to a specific time range with improved error handling
 * @param videoBlob The original video blob
 * @param startTime Start time in seconds
 * @param endTime End time in seconds
 * @returns A Promise that resolves to the trimmed video blob
 */
export const trimVideoByTimeRange = async (
    videoBlob: Blob,
    startTime: number,
    endTime: number
  ): Promise<Blob> => {
    console.log(`Starting trim operation: ${startTime}s to ${endTime}s`);
  
    // Input validation
    if (!videoBlob || videoBlob.size === 0) {
      throw new Error("Invalid video blob provided");
    }
  
    if (typeof startTime !== 'number' || typeof endTime !== 'number') {
      throw new Error(`Invalid time values: start=${startTime}, end=${endTime}`);
    }
  
    if (startTime >= endTime) {
      throw new Error(`Invalid trim range: start (${startTime}) must be less than end (${endTime})`);
    }
  
    // Ensure positive values
    startTime = Math.max(0, startTime);
    endTime = Math.max(0.1, endTime); // Ensure at least 0.1s
  
    // Ensure minimum length
    if (endTime - startTime < 0.1) {
      endTime = startTime + 0.1; // Ensure at least 0.1s duration
    }
  
    // Create a video element for the source
    const sourceVideo = document.createElement('video');
    sourceVideo.muted = true; // Mute to avoid audio issues
  
    try {
      // Create and set source
      const videoUrl = URL.createObjectURL(videoBlob);
      sourceVideo.src = videoUrl;
      
      // Set up a promise to handle metadata loading
      await new Promise<void>((resolve, reject) => {
        sourceVideo.onloadedmetadata = () => {
          console.log(`Video metadata loaded: ${sourceVideo.duration}s`);
          resolve();
        };
        sourceVideo.onerror = (e) => {
          console.error('Failed to load video metadata:', e);
          reject(new Error('Failed to load video metadata'));
        };
        
        // Set a timeout in case metadata loading hangs
        const timeout = setTimeout(() => {
          console.warn('Metadata loading timed out');
          if (sourceVideo.duration) {
            resolve(); // Proceed if we have some duration
          } else {
            reject(new Error('Metadata loading timed out'));
          }
        }, 5000);
        
        sourceVideo.load();
        
        // Clear timeout if metadata loads normally
        sourceVideo.onloadedmetadata = () => {
          clearTimeout(timeout);
          console.log(`Video metadata loaded: ${sourceVideo.duration}s`);
          resolve();
        };
      });
  
      // Further validate with actual video duration
      if (isNaN(sourceVideo.duration) || !isFinite(sourceVideo.duration)) {
        console.warn(`Invalid video duration: ${sourceVideo.duration}`);
        // Try to proceed anyway with the values we have
      } else if (endTime > sourceVideo.duration) {
        console.warn(
          `End time (${endTime}) exceeds video duration (${sourceVideo.duration}). Clamping to video length.`
        );
        endTime = sourceVideo.duration;
        
        // Check again after clamping
        if (startTime >= endTime) {
          console.warn("After clamping end time, range became invalid. Adjusting start time.");
          startTime = Math.max(0, endTime - 0.5); // Ensure at least a half-second video
        }
      }
  
      console.log(
        `Validated trim range: ${startTime}s to ${endTime}s (duration: ${endTime - startTime}s)`
      );
      console.log(
        `Video properties: duration=${sourceVideo.duration}s, dimensions=${sourceVideo.videoWidth}x${sourceVideo.videoHeight}`
      );
  
      // Set up canvas for frame extraction
      const canvas = document.createElement('canvas');
      canvas.width = sourceVideo.videoWidth || 1280;
      canvas.height = sourceVideo.videoHeight || 720;
      const ctx = canvas.getContext('2d');
  
      if (!ctx) {
        throw new Error('Could not get canvas context');
      }
  
      // Create a stream from the canvas
      // @ts-ignore - TypeScript doesn't recognize captureStream
      const canvasStream = canvas.captureStream(30); // 30 FPS
  
      // Get the best supported MIME type
      const mimeType = getSupportedMimeType();
      console.log(`Using MIME type for trimming: ${mimeType}`);
  
      const mediaRecorder = new MediaRecorder(canvasStream, {
        mimeType: mimeType,
        videoBitsPerSecond: 5000000, // 5Mbps for high quality
      });
  
      const trimmedChunks: Blob[] = [];
      let frameCount = 0;
  
      // Return a promise that resolves with the trimmed blob
      return new Promise<Blob>((resolve, reject) => {
        let recordingComplete = false;
        let recordingError = false;
  
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            trimmedChunks.push(e.data);
          }
        };
  
        mediaRecorder.onstop = () => {
          console.log(`MediaRecorder stopped, processed ${frameCount} frames`);
  
          try {
            // Check if we collected any data
            if (trimmedChunks.length === 0) {
              throw new Error('No data was collected during trimming');
            }
  
            const trimmedBlob = new Blob(trimmedChunks, { type: mimeType });
            console.log(`Created trimmed blob: ${trimmedBlob.size} bytes`);
  
            // Clean up resources
            URL.revokeObjectURL(videoUrl);
            sourceVideo.removeAttribute('src');
            sourceVideo.load();
  
            resolve(trimmedBlob);
          } catch (error) {
            console.error('Error creating final video:', error);
            reject(error);
          }
        };
  
        mediaRecorder.onerror = (event) => {
          console.error('MediaRecorder error:', event);
          recordingError = true;
          reject(new Error('MediaRecorder error occurred'));
        };
  
        // Start the MediaRecorder
        try {
          mediaRecorder.start(100); // Capture in 100ms chunks
        } catch (e) {
          console.error('Failed to start MediaRecorder:', e);
          reject(new Error('Failed to start MediaRecorder'));
          return;
        }
  
        // Function to draw frames at a consistent rate
        const captureFrames = () => {
          if (recordingError) return;
  
          // Stop when we reach the end time
          if (sourceVideo.currentTime >= endTime) {
            console.log(`Reached end time (${endTime}s), stopping recorder`);
            recordingComplete = true;
            try {
              mediaRecorder.stop();
            } catch (e) {
              console.error('Error stopping media recorder:', e);
            }
            sourceVideo.pause();
            return;
          }
  
          // Draw frame to canvas
          try {
            ctx.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);
            frameCount++;
          } catch (e) {
            console.error('Error drawing frame:', e);
            // Try to continue anyway
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
  
        // Handle errors
        sourceVideo.onerror = (e) => {
          console.error('Video error during trimming:', e);
          reject(new Error('Video error during playback for trimming'));
        };
  
        // Set a timeout safety to ensure we don't hang if something goes wrong
        const safetyTimeout = setTimeout(() => {
          if (!recordingComplete) {
            console.warn('Trim operation timed out, forcing completion');
            try {
              if (mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
              }
            } catch (e) {
              console.error('Error stopping timed-out recorder:', e);
              reject(new Error('Trim operation timed out'));
            }
          }
        }, 30000); // 30-second safety timeout
  
        // Start the process by seeking to start time
        console.log('Seeking to start time:', startTime);
        sourceVideo.currentTime = startTime;
  
        // Once seeked, start playing and capturing frames
        sourceVideo.onseeked = () => {
          console.log('Seeked to start time, starting playback');
  
          // Start capturing frames
          sourceVideo.play()
            .then(() => {
              console.log('Playback started for frame capture');
              requestAnimationFrame(captureFrames);
            })
            .catch((err) => {
              console.error('Error playing video for frame capture:', err);
              reject(new Error('Failed to play video for frame capture'));
            });
  
          // Only run onseeked once
          sourceVideo.onseeked = null;
        };
      }).finally(() => {
        // Clean up resources even if the operation fails
        try {
          if (sourceVideo) {
            sourceVideo.pause();
            sourceVideo.src = '';
            sourceVideo.load();
          }
        } catch (e) {
          console.warn('Error cleaning up video resources:', e);
        }
      });
    } catch (error) {
      console.error('Error in trimVideoByTimeRange:', error);
      throw error;
    }
  };
  
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
   * Prepares a video element for playback with a blob
   * @param videoElement The video element reference
   * @param blob The video blob to play
   */
  export const prepareVideoForPlayback = (
    videoElement: HTMLVideoElement | null,
    blob: Blob
  ): void => {
    if (!videoElement) return;
    
    console.log(`Preparing video for playback, blob size: ${blob.size} bytes`);
    
    // Create a new object URL to avoid potential caching issues
    const url = URL.createObjectURL(blob);
    
    // Clear any existing blob URLs first
    if (videoElement.src && videoElement.src.startsWith('blob:')) {
      URL.revokeObjectURL(videoElement.src);
    }
    
    // Set the source to the new blob URL
    videoElement.src = url;
    
    // Wait for the video to load metadata before trying to play
    videoElement.onloadedmetadata = () => {
      console.log(`Video metadata loaded. Duration: ${videoElement.duration}s`);
      // Reset the playback position to the start
      videoElement.currentTime = 0;
    };
    
    // Wait for the video to be ready to play
    videoElement.oncanplay = () => {
      console.log('Video can play, starting playback');
      videoElement.play()
        .then(() => console.log('Playback started successfully'))
        .catch(err => console.error('Error starting playback:', err));
    };
    
    // Force a reload to apply the new source
    videoElement.load();
  };
  
  /**
   * Format a duration in seconds to a readable string
   * @param seconds The duration in seconds
   * @returns Formatted string in the format "m:ss.t"
   */
  export const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
  };

/**
 * Gets the actual duration of a video blob by loading it into a video element
 * @param videoBlob The video blob to check
 * @returns Promise that resolves to the duration in seconds
 */
export const getVideoDuration = (videoBlob: Blob): Promise<number> => {
    return new Promise((resolve, reject) => {
      // Create a temporary video element
      const tempVideo = document.createElement('video');
      const url = URL.createObjectURL(videoBlob);
      
      // Set up event listeners
      tempVideo.onloadedmetadata = () => {
        // Get the duration
        const duration = tempVideo.duration;
        console.log(`Video metadata loaded, duration: ${duration}s`);
        
        // Clean up
        URL.revokeObjectURL(url);
        
        // If we got a valid duration, resolve with it
        if (duration && isFinite(duration) && duration > 0) {
          resolve(duration);
        } else {
          console.warn(`Invalid duration detected: ${duration}, using fallback`);
          // Fallback to a reasonable estimate based on file size
          // A very rough estimate: assume 1MB ≈ 1 second of video at moderate quality
          const estimatedDuration = videoBlob.size / (1024 * 1024);
          resolve(Math.max(estimatedDuration, 1)); // At least 1 second
        }
      };
      
      tempVideo.onerror = (error) => {
        console.error('Error loading video to get duration:', error);
        URL.revokeObjectURL(url);
        
        // Fallback to a size-based estimate
        const estimatedDuration = videoBlob.size / (1024 * 1024);
        console.log(`Using fallback duration estimate: ${estimatedDuration}s`);
        resolve(Math.max(estimatedDuration, 1)); // At least 1 second
      };
      
      // Add a safety timeout
      const timeout = setTimeout(() => {
        console.warn('Duration detection timed out');
        URL.revokeObjectURL(url);
        
        // Fallback to a size-based estimate
        const estimatedDuration = videoBlob.size / (1024 * 1024);
        console.log(`Using fallback duration estimate after timeout: ${estimatedDuration}s`);
        resolve(Math.max(estimatedDuration, 1)); // At least 1 second
      }, 3000); // 3 second timeout
      
      // Start loading the video
      tempVideo.src = url;
      tempVideo.preload = 'metadata';
      
      // When metadata is loaded, it will trigger onloadedmetadata
      tempVideo.load();
      
      // Clear timeout if metadata loads normally
      tempVideo.onloadedmetadata = () => {
        clearTimeout(timeout);
        const duration = tempVideo.duration;
        console.log(`Video metadata loaded, duration: ${duration}s`);
        
        // Clean up
        URL.revokeObjectURL(url);
        
        // If we got a valid duration, resolve with it
        if (duration && isFinite(duration) && duration > 0) {
          resolve(duration);
        } else {
          console.warn(`Invalid duration detected: ${duration}, using fallback`);
          // Fallback to a reasonable estimate based on file size
          const estimatedDuration = videoBlob.size / (1024 * 1024);
          resolve(Math.max(estimatedDuration, 1)); // At least 1 second
        }
      };
    });
  };