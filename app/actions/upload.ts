'use server'

import { storage } from '@/lib/google-cloud';
import { join } from 'path';
import { writeFile, readFile, unlink } from 'fs/promises';
import { mkdir } from 'fs/promises';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

async function cleanupFiles(filePaths: string[]) {
  for (const path of filePaths) {
    try {
      await unlink(path).catch(() => {});
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  }
}

export async function uploadVideo(formData: FormData) {
    try {
        const file = formData.get('file') as File;
        
        if (!file) {
            throw new Error('No file provided');
        }

        // Get other metadata from the form
        const cameraFacing = formData.get('cameraFacing') as string || 'unknown';
        const deviceInfo = formData.get('deviceInfo') as string || 'unknown';
        const quality = formData.get('quality') as string || 'high';

        // Create a temporary directory for processing
        const tempDir = join(tmpdir(), `golf-video-${Date.now()}`);
        await mkdir(tempDir, { recursive: true });
        
        // Input file path
        const inputFilePath = join(tempDir, `input-${Date.now()}-${file.name}`);
        
        // Output file path (always mp4 for consistency)
        const outputFileName = `processed-${Date.now()}.mp4`;
        const outputFilePath = join(tempDir, outputFileName);
        
        // Write the uploaded file to disk
        // Correctly convert ArrayBuffer to Uint8Array for writeFile
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        await writeFile(inputFilePath, uint8Array);
        
        // Process with FFmpeg - settings optimized for golf swing videos
        try {
            let ffmpegCommand;
            
            if (quality === 'high') {
                // High quality settings for detailed analysis
                ffmpegCommand = `ffmpeg -i "${inputFilePath}" -c:v libx264 -preset slow -crf 18 -profile:v high -level 4.2 -pix_fmt yuv420p -movflags +faststart -vf "fps=30" -c:a aac -b:a 128k "${outputFilePath}"`;
            } else {
                // Medium quality - good balance for most uses
                ffmpegCommand = `ffmpeg -i "${inputFilePath}" -c:v libx264 -preset medium -crf 23 -profile:v main -level 4.0 -pix_fmt yuv420p -movflags +faststart -vf "fps=30" -c:a aac -b:a 96k "${outputFilePath}"`;
            }
            
            // Execute FFmpeg
            execSync(ffmpegCommand);
        } catch (ffmpegError) {
            console.error('FFmpeg processing error:', ffmpegError);
            
            // If FFmpeg fails, upload the original file as fallback
            const uniqueFileName = `unprocessed_video/test/${Date.now()}-${file.name}`;
            
            // Convert ArrayBuffer to Uint8Array for Google Cloud Storage
            const originalArrayBuffer = await file.arrayBuffer();
            const originalBuffer = new Uint8Array(originalArrayBuffer);
            
            await storage
                .bucket(process.env.POSE_ESTIMATION_ANALYSIS_BUCKET as string)
                .file(uniqueFileName)
                .save(originalBuffer, {
                    metadata: {
                        contentType: file.type,
                        metadata: {
                            processingFailed: 'true',
                            originalName: file.name,
                            cameraFacing,
                            deviceInfo
                        }
                    },
                });
                
            await cleanupFiles([inputFilePath, outputFilePath]);
            
            return {
                success: true,
                fileName: uniqueFileName,
                processed: false,
                message: 'Original video uploaded (processing failed)',
            };
        }
        
        // Read the processed file
        const processedFileContent = await readFile(outputFilePath);
        
        // Upload to Cloud Storage
        const uniqueFileName = `unprocessed_video/test/${outputFileName}`;
        
        await storage
            .bucket(process.env.POSE_ESTIMATION_ANALYSIS_BUCKET as string)
            .file(uniqueFileName)
            .save(processedFileContent, {
                metadata: {
                    contentType: 'video/mp4',
                    metadata: {
                        originalName: file.name,
                        processingMethod: 'ffmpeg',
                        quality,
                        cameraFacing,
                        deviceInfo
                    }
                },
            });
            
        // Cleanup temp files
        await cleanupFiles([inputFilePath, outputFilePath]);

        return {
            success: true,
            fileName: uniqueFileName,
            processed: true,
        }
    } catch (error) {
        console.error('Error processing and uploading video:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'An unknown error occurred',
        }
    }
}