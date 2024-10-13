import {S3Client, PutObjectCommand} from '@aws-sdk/client-s3';
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

// Create an S3 client service object
const s3Client = new S3Client({ region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
                }});

export async function POST(req: Request) {
    if (req.method === 'POST') {
        try {
            const body = await req.json();
            const { videoBlob, fileName } = body;

            const buffer = Buffer.from(videoBlob.split(',')[1], 'base64');

            // Create a unique filename for the video
            const key = `${uuidv4()}-${fileName}`;

            // Set the parameters for S3 upload
            const params = {
                Bucket: process.env.AWS_BUCKET_NAME!,
                Key: key,
                Body: buffer,
                ContentType: 'video/webm',
            };

            // Send file to S3
            const command = new PutObjectCommand(params);
            await s3Client.send(command);

            // Return success response
            return NextResponse.json({ message: 'Video uploaded successfully!' });
        } catch (error) {
            if (error instanceof Error) {
            return NextResponse.json(
                { message: 'Error uploading video', error: error.message },
                { status: 500 }
              );
            }
        }
    }
}