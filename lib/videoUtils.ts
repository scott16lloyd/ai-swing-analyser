/**
 * Utility functions for video processing in the golf swing recorder
 */

/**
 * Trims a video blob to a specific time range
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
  
    // Create a video element for the source
    const sourceVideo = document.createElement('video');
    sourceVideo.src = URL.createObjectURL(videoBlob);
    sourceVideo.muted = true; // Mute to avoid audio issues
    
    // Set up a promise to handle metadata loading
    await new Promise<void>((resolve, reject) => {
      sourceVideo.onloadedmetadata = () => {
        console.log(`Video metadata loaded: ${sourceVideo.duration}s`);
        resolve();
      };
      sourceVideo.onerror = () => {
        console.error('Failed to load video metadata');
        reject(new Error('Failed to load video metadata'));
      };
      sourceVideo.load();
    });
  
    // Validate trim points
    if (startTime >= endTime) {
      throw new Error(
        `Invalid trim range: start (${startTime}) must be less than end (${endTime})`
      );
    }
  
    if (endTime > sourceVideo.duration) {
      console.warn(
        `End time (${endTime}) exceeds video duration (${sourceVideo.duration}). Clamping to video length.`
      );
      endTime = sourceVideo.duration;
    }
  
    console.log(
      `Video duration: ${sourceVideo.duration}s, dimensions: ${sourceVideo.videoWidth}x${sourceVideo.videoHeight}`
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
    // @ts-ignore
    const canvasStream = canvas.captureStream(30); // 30 FPS
  
    // Try to get audio track
    let audioTrack: MediaStreamTrack | null = null;
  
    try {
      // Create a new MediaStream from the original video's MediaSource
      // @ts-ignore
      const originalStream = sourceVideo.captureStream();
      const audioTracks = originalStream.getAudioTracks();
      
      if (audioTracks.length > 0) {
        audioTrack = audioTracks[0];
        if (audioTrack) {
            canvasStream.addTrack(audioTrack);
            console.log('Successfully added audio track to canvas stream');
        }
      } else {
        console.log('No audio tracks found in original video');
      }
    } catch (err) {
      console.warn('Audio extraction not supported in this browser:', err);
    }
  
    // Set up MediaRecorder for the trimmed video
    const mimeType = getSupportedMimeType();
    console.log(`Using MIME type for trimming: ${mimeType}`);
  
    const mediaRecorder = new MediaRecorder(canvasStream, {
      mimeType: mimeType,
      videoBitsPerSecond: 5000000, // 5Mbps for high quality
    });
  
    const trimmedChunks: Blob[] = [];
    let recordingComplete = false;
  
    // Return a promise that resolves with the trimmed blob
    return new Promise((resolve, reject) => {
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          trimmedChunks.push(e.data);
        }
      };
  
      mediaRecorder.onstop = () => {
        if (!recordingComplete) {
          console.warn('MediaRecorder stopped unexpectedly');
        }
        
        console.log('MediaRecorder stopped, creating final video');
        
        try {
          const trimmedBlob = new Blob(trimmedChunks, { type: mimeType });
          console.log(`Created trimmed blob: ${trimmedBlob.size} bytes`);
          
          // Explicitly clean up resources
          if (audioTrack) {
            try {
              audioTrack.stop();
            } catch (e) {
              console.warn('Error stopping audio track:', e);
            }
          }
          
          URL.revokeObjectURL(sourceVideo.src);
          sourceVideo.removeAttribute('src');
          sourceVideo.load();
          
          resolve(trimmedBlob);
        } catch (error) {
          console.error('Error creating final video:', error);
          reject(error);
        }
      };
  
      // Start the MediaRecorder
      mediaRecorder.start(100); // Capture in 100ms chunks for better performance
  
      // Use requestAnimationFrame for more reliable frame capturing
      let frameCount = 0;
      
      // Helper function to manually draw frames at a consistent rate
      const captureFrames = () => {
        // Stop when we reach the end time
        if (sourceVideo.currentTime >= endTime) {
          console.log(`Reached end time (${endTime}s), stopping recorder`);
          recordingComplete = true;
          mediaRecorder.stop();
          sourceVideo.pause();
          return;
        }
        
        // Only draw frames if we're within our target time range
        if (sourceVideo.currentTime >= startTime) {
          ctx.drawImage(sourceVideo, 0, 0, canvas.width, canvas.height);
          frameCount++;
          
          // Log progress occasionally
          if (frameCount % 30 === 0) {
            console.log(`Processed ${frameCount} frames, current time: ${sourceVideo.currentTime}s`);
          }
        }
        
        // Continue capturing frames
        requestAnimationFrame(captureFrames);
      };
  
      sourceVideo.addEventListener('error', (e) => {
        console.error('Video error during trimming:', e);
        reject(new Error('Video error during playback for trimming'));
      });
  
      // Start playback to begin capturing
      sourceVideo.addEventListener('canplay', () => {
        console.log('Video can play, seeking to start time:', startTime);
        
        // Seek to the start time
        sourceVideo.currentTime = startTime;
        
        // Once seeked, start playing and capturing frames
        sourceVideo.addEventListener('seeked', () => {
          console.log('Seeked to start time, starting playback');
          
          // Start capturing frames
          sourceVideo.play()
            .then(() => {
              console.log('Playback started for frame capture');
              requestAnimationFrame(captureFrames);
            })
            .catch(err => {
              console.error('Error playing video for frame capture:', err);
              reject(new Error('Failed to play video for frame capture'));
            });
        }, { once: true });
      }, { once: true });
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