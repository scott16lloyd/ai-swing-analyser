'use server';

import { Storage } from '@google-cloud/storage';
import { revalidatePath } from 'next/cache';

export interface SignedUrlRequest {
  filename: string;
  contentType: string;
  metadata?: Record<string, any>;
}

export interface SignedUrlResponse {
  url: string;
  publicUrl: string;
}

export interface ProcessedVideoStatusRequest {
  bucketName?: string;
  fileName: string;
  processedFolder?: string;
}

export interface ProcessedVideoStatusResponse {
  exists: boolean;
  publicUrl?: string;
  fileName?: string;
  error?: string;
}

/**
 * Generate a signed URL for direct upload to Google Cloud Storage (simplified)
 */
export async function generateSignedUrl({
  filename,
  contentType,
  metadata = {},
}: SignedUrlRequest): Promise<SignedUrlResponse> {
  if (!filename || !contentType) {
    throw new Error('Filename and content type are required');
  }
  
  // Get bucket name from environment variables
  const bucketName = process.env.STORAGE_BUCKET_NAME || process.env.POSE_ESTIMATION_ANALYSIS_BUCKET;
  if (!bucketName) {
    throw new Error('Storage bucket name not configured');
  }
  
  try {
    // Get service account credentials from environment variable
    const serviceKeyEnv = process.env.GOOGLE_CLOUD_SERVICE_KEY;
    if (!serviceKeyEnv) {
      throw new Error('Google Cloud service account key not configured');
    }

    // Parse the service account credentials
    let credentials;
    try {
      credentials = JSON.parse(serviceKeyEnv);
    } catch (e) {
      throw new Error('Invalid Google Cloud service account key format');
    }
    
    // Log inputs for debugging
    console.log("Generating signed URL for:", {
      bucket: bucketName,
      file: filename,
      contentType
    });
    
    // Initialize Google Cloud Storage with credentials
    const storage = new Storage({
      credentials,
      projectId: credentials.project_id
    });
    
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(filename);
    
    // Generate a simple signed URL with minimal options
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      contentType,
      // Very minimal headers
      extensionHeaders: {}
    });
    
    // Generate a public URL
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${filename}`;
    
    return { url: signedUrl, publicUrl };
  } catch (error) {
    console.error('Error generating signed URL:', error);
    throw new Error(`Failed to generate signed URL: ${(error as Error).message}`);
  }
}

/**
 * Checks if a processed video is available in the specified bucket
 */
export async function checkProcessedVideoStatus({
  bucketName,
  fileName,
  processedFolder = 'processed_video/user',
}: ProcessedVideoStatusRequest): Promise<ProcessedVideoStatusResponse> {
  if (!fileName) {
    return { exists: false, error: 'File name is required' };
  }
  
  // Get bucket name from params or environment variables
  const storageBucket = bucketName || process.env.STORAGE_BUCKET_NAME || process.env.POSE_ESTIMATION_ANALYSIS_BUCKET;
  if (!storageBucket) {
    return { exists: false, error: 'Storage bucket name not configured' };
  }
  
  try {
    // Get service account credentials from environment variable
    const serviceKeyEnv = process.env.GOOGLE_CLOUD_SERVICE_KEY;
    if (!serviceKeyEnv) {
      return { exists: false, error: 'Google Cloud service account key not configured' };
    }

    // Parse the service account credentials
    let credentials;
    try {
      credentials = JSON.parse(serviceKeyEnv);
    } catch (e) {
      return { exists: false, error: 'Invalid Google Cloud service account key format' };
    }

    const fileNameOnly = fileName.includes('/') ? fileName.split('/').pop() : fileName;
    if (!fileNameOnly) {
      return { exists: false, error: 'Invalid file name' };
    }
    
    // Create the processed file path
    const processedFileName = `${processedFolder}/${fileName}`;
    
    // Log inputs for debugging
    console.log("Checking processed video status for:", {
      bucket: storageBucket,
      file: processedFileName
    });
    
    // Initialize Google Cloud Storage with credentials
    const storage = new Storage({
      credentials,
      projectId: credentials.project_id
    });
    
    // Check if the processed file exists
    const bucket = storage.bucket(storageBucket);
    const file = bucket.file(processedFileName);
    const [exists] = await file.exists();
    
    if (!exists) {
      // File doesn't exist yet
      return { exists: false };
    }
    
    // Generate a temporary public URL for the file
    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000, // 1 hour
    });
    
    // Revalidate the analysis page to ensure fresh data
    revalidatePath('/analysis-results');
    
    return {
      exists: true,
      publicUrl: url,
      fileName: processedFileName,
    };
  } catch (error) {
    console.error('Error checking processed video:', error);
    return { 
      exists: false, 
      error: `Failed to check processed video status: ${(error as Error).message}` 
    };
  }
}

// Add this diagnostic test function to your component
export async function testGoogleCloudStorage() {
  try {
    // 1. Create a small test file
    const testBlob = new Blob(['Test content: ' + new Date().toISOString()], { type: 'text/plain' });
    
    // 2. Get a signed URL
    const { url } = await generateSignedUrl({
      filename: 'test/diagnostic-' + Date.now() + '.txt',
      contentType: 'text/plain',
      metadata: { test: 'true' }
    });
    
    console.log('Signed URL generated:', url);
    
    // 3. Try the simplest possible upload
    const uploadResponse = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: testBlob
    });
    
    // 4. Log detailed response
    console.log('Upload status:', uploadResponse.status, uploadResponse.statusText);
    const responseText = await uploadResponse.text().catch(e => 'Could not read response: ' + e);
    console.log('Response body:', responseText);
    
    return { success: uploadResponse.ok, status: uploadResponse.status, response: responseText };
  } catch (error) {
    console.error('Test failed:', error);
    return { success: false, error: (error as Error).message };
  }
}