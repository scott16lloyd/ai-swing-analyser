/**
 * Trims a video blob to a specific time range using a more direct approach
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
    console.log(`Trimming video from ${startTime}s to ${endTime}s`);
  
    // Create a video element for the source and load metadata
    const sourceVideo = document.createElement('video');
    sourceVideo.muted = true;
    
    // Load the video and wait for metadata
    const videoUrl = URL.createObjectURL(videoBlob);
    sourceVideo.src = videoUrl;
    
    await new Promise<void>((resolve, reject) => {
      sourceVideo.onloadedmetadata = () => resolve();
      sourceVideo.onerror = () => reject(new Error("Failed to load video metadata"));
      sourceVideo.load();
    });
    
    // Validate trim points
    if (endTime > sourceVideo.duration) {
      console.warn(`End time ${endTime}s exceeds video duration ${sourceVideo.duration}s. Clamping.`);
      endTime = sourceVideo.duration;
    }
    
    if (startTime >= endTime) {
      throw new Error(`Invalid trim range: start (${startTime}) must be less than end (${endTime})`);
    }
  
    // Calculate dimensions - use actual video size if available, otherwise default to HD
    const width = sourceVideo.videoWidth || 1280;
    const height = sourceVideo.videoHeight || 720;
    
    // Create canvas and get context
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      throw new Error('Could not get canvas context');
    }
    
    // Create MediaStream from canvas
    // @ts-ignore - TypeScript doesn't know about captureStream but browsers support it
    const canvasStream = canvas.captureStream(30);
    
    // Get supported MIME type
    const mimeType = getSupportedMimeType();
    
    // Create MediaRecorder
    const recorder = new MediaRecorder(canvasStream, {
      mimeType,
      videoBitsPerSecond: 5000000 // 5 Mbps
    });
    
    // Store recorded chunks
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    
    // Start recording
    recorder.start(100); // Capture in 100ms chunks
    
    // Create a promise to handle the trim operation
    return new Promise((resolve, reject) => {
      let frameCount = 0;
      
      // Handle when recording is stopped
      recorder.onstop = () => {
        try {
          // Create the final video blob
          const trimmedBlob = new Blob(chunks, { type: mimeType });
          console.log(`Created trimmed video: ${trimmedBlob.size} bytes, ${frameCount} frames`);
          
          // Clean up resources
          URL.revokeObjectURL(videoUrl);
          sourceVideo.src = '';
          
          resolve(trimmedBlob);
        } catch (error) {
          console.error('Error creating trimmed video:', error);
          reject(error);
        }
      };
      
      // Seek to the start position
      sourceVideo.currentTime = startTime;
      
      // Handle errors during processing
      sourceVideo.onerror = (error) => {
        console.error('Error during video processing:', error);
        recorder.stop();
        reject(new Error('Video processing error'));
      };
      
      // Function to capture frames when the video is playing
      const captureFrame = () => {
        // If we've reached or gone past the end time, stop
        if (sourceVideo.currentTime >= endTime) {
          console.log(`Reached end time ${endTime}s, stopping`);
          recorder.stop();
          sourceVideo.pause();
          return;
        }
        
        // Draw the current frame to the canvas
        ctx.drawImage(sourceVideo, 0, 0, width, height);
        frameCount++;
        
        // Request the next frame
        requestAnimationFrame(captureFrame);
      };
      
      // Once we've seeked to the start time, start playing and capturing
      sourceVideo.onseeked = () => {
        console.log(`Seeked to ${sourceVideo.currentTime}s, starting playback`);
        
        // Start playing the video
        sourceVideo.play().then(() => {
          console.log('Video playback started for frame capturing');
          
          // Start capturing frames
          requestAnimationFrame(captureFrame);
        }).catch(error => {
          console.error('Error playing video for processing:', error);
          recorder.stop();
          reject(new Error('Failed to play video for processing'));
        });
        
        // Only run onseeked once
        sourceVideo.onseeked = null;
      };
    });
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