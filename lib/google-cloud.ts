import { Storage } from '@google-cloud/storage';

export const storage = new Storage({
  credentials: JSON.parse(process.env.GOOGLE_CLOUD_SERVICE_KEY as string),
});