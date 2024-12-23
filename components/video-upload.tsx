'use client';

import { useState } from 'react';

export default function VideoUpload() {
  const [file, setFile] = useState(null);
  const [response, setResponse] = useState(null);

  const handleFileChange = (e: any) => {
    setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) {
      alert('Please select a file first!');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('http://127.0.0.1:4000/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        throw new Error('Error uploading video');
      }

      const data = await res.json();
      setResponse(data);
    } catch (err) {
      console.error(err);
      alert('Failed to upload video.');
    }
  };

  return (
    <div>
      <h1>Upload a Video</h1>
      <input type="file" accept="video/*" onChange={handleFileChange} />
      <button onClick={handleUpload}>Upload</button>

      {response && (
        <div>
          <h2>Pose Estimation Results:</h2>
          <pre>{JSON.stringify(response, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
