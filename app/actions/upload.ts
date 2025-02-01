'use server'

import { storage } from '@/lib/google-cloud';

export async function uploadVideo(formData: FormData) {
    try {
        const file = formData.get('file') as File;

        if (!file) {
            throw new Error('No file provided');
        }

        const buffer = await file.arrayBuffer();
        const uniqueFileName = `unprocessed_video/${Date.now()}-${file.name}`;

        await storage
            .bucket(process.env.POSE_ESTIMATION_ANALYSIS_BUCKET as string)
            .file(uniqueFileName)
            .save(Buffer.from(buffer), {
                metadata: {
                    contentType: file.type,
                },
            });

        return {
            success: true,
            fileName: uniqueFileName,
        }
    } catch (error) {
        console.error('Error uploading video:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'An unknown error occurred',
        }
    }
}