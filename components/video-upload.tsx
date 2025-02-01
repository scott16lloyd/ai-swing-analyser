'use client';

import { useState } from 'react';
import { Upload, X } from 'lucide-react';
import { uploadVideo } from '@/app/actions/upload';

export default function VideoUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type.startsWith('video/')) {
      setFile(selectedFile);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      return;
    }
    setUploading(true);
    setProgress(0);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const result = await uploadVideo(formData);
      if (result.success) {
        setProgress(100);
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Error uploading video:', error);
    } finally {
      setUploading(false);
    }
  };

  const clearFile = () => {
    setFile(null);
    setProgress(0);
  };

  return (
    <div className="w-full max-w-md mx-auto p-6 space-y-4">
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
        {!file ? (
          <div className="space-y-4">
            <Upload className="mx-auto h-12 w-12 text-gray-400" />
            <div>
              <label className="cursor-pointer text-blue-500 hover:text-blue-600">
                Choose a video
                <input
                  type="file"
                  className="hidden"
                  accept="video/*"
                  onChange={handleFileSelect}
                />
              </label>
              <p className="text-sm text-gray-500 mt-2">
                or drag and drop here
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm truncate">{file.name}</span>
              <button
                onClick={clearFile}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {progress > 0 && (
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-500 rounded-full h-2 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <button
        onClick={handleUpload}
        disabled={!file || uploading}
        className="w-full bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
      >
        {uploading ? 'Uploading...' : 'Upload Video'}
      </button>
    </div>
  );
}
