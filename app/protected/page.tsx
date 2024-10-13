import FetchDataSteps from '@/components/tutorial/fetch-data-steps';
import { createClient } from '@/utils/supabase/server';
import { InfoIcon } from 'lucide-react';
import { redirect } from 'next/navigation';
import fs from 'fs';

export default async function ProtectedPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect('/sign-in');
  }

  // // Initialize the Amazon Cognito credentials provider
  // AWS.config.update({
  //   accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  //   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  //   region: process.env.AWS_REGION,
  // });

  // const sagemakerRuntime = new AWS.SageMakerRuntime();

  // const endpointName = 'pose-estimation-endpoint';

  // const videoFile = fs.readFileSync('../0.mp4');

  // const params = {
  //   EndpointName: endpointName,
  //   Body: videoFile,
  //   ContentType: 'video/mp4',
  // };

  // // Send video to SageMaker endpoint
  // sagemakerRuntime.invokeEndpoint(params, (err, data) => {
  //   if (err) {
  //     console.error('Error invoking endpoint: ', err);
  //   } else {
  //     console.log('Response from SageMaker:', data.Body.toString());
  //   }
  // });

  async function invokeSageMakerEndpoint(videoFile: any) {
    const endpointUrl =
      'https://runtime.sagemaker.us-east-1.amazonaws.com/endpoints/pose-estimation-endpoint/invocations';

    try {
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'video/mp4', // Set the Content-Type to video/mp4
        },
        body: videoFile, // Pass the video file directly as the body
      });

      if (!response.ok) {
        throw new Error(`Error: ${response.statusText}`);
      }

      const result = await response.json(); // Assuming the model returns a JSON response
      console.log('Result from SageMaker:', result);
    } catch (error) {
      console.error('Error invoking SageMaker endpoint:', error);
    }
  }

  // Invoke the SageMaker endpoint with the video file
  const videoFilePath = 'app/0.mp4';
  const videoFile = fs.readFileSync(videoFilePath);
  invokeSageMakerEndpoint(videoFile);

  return (
    <div className="flex-1 w-full flex flex-col gap-12">
      <div className="w-full">
        <div className="bg-accent text-sm p-3 px-5 rounded-md text-foreground flex gap-3 items-center">
          <InfoIcon size="16" strokeWidth={2} />
          This is a protected page that you can only see as an authenticated
          user
        </div>
      </div>
      <div className="flex flex-col gap-2 items-start">
        <h2 className="font-bold text-2xl mb-4">Your user details</h2>
        <pre className="text-xs font-mono p-3 rounded border max-h-32 overflow-auto">
          {JSON.stringify(user, null, 2)}
        </pre>
      </div>
      <div>
        <h2 className="font-bold text-2xl mb-4">Next steps</h2>
        <FetchDataSteps />
      </div>
    </div>
  );
}
