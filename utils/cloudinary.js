const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Verify connection with retry logic
const connectWithRetry = async (maxRetries = Infinity) => {
  let attempt = 0;
  const baseDelay = 2000; // 2 seconds
  const maxDelay = 30000; // 30 seconds max

  while (attempt < maxRetries) {
    attempt++;
    try {
      await cloudinary.api.ping();
      console.log('✅ Cloudinary Connected Successfully');
      return;
    } catch (error) {
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      console.error(`❌ Cloudinary Connection Failed (Attempt ${attempt}):`, error?.message || error || 'Unknown error');
      console.error('   Cloud Name:', process.env.CLOUDINARY_CLOUD_NAME || 'NOT SET');
      console.error('   API Key:', process.env.CLOUDINARY_API_KEY ? '***' + process.env.CLOUDINARY_API_KEY.slice(-4) : 'NOT SET');
      console.log(`   Retrying in ${delay / 1000}s...`);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  console.error('❌ Cloudinary Connection Failed after all retries');
};

connectWithRetry();

exports.uploadToCloudinary = async (fileBuffer, folder = 'digitalmenu') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'auto',
        transformation: [
          { width: 800, height: 600, crop: 'limit', quality: 'auto', fetch_format: 'auto' }
        ]
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );

    uploadStream.end(fileBuffer);
  });
};

exports.deleteFromCloudinary = async (publicId) => {
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error('Error deleting from Cloudinary:', error);
  }
};

exports.extractPublicId = (url) => {
  if (!url) return null;
  // Match everything after /upload/ (optionally skipping /v12345/) and before the extension
  // This supports both folder-nested and root-level public IDs
  const matches = url.match(/\/upload\/(?:v\d+\/)?(.+)\.\w+$/);
  return matches ? matches[1] : null;
};

// Upload raw file (for Excel/PDF reports) to Cloudinary
exports.uploadRawToCloudinary = async (fileBuffer, filename, folder = 'digitalmenu/reports') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'raw',
        public_id: filename,
        format: 'xlsx'
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );

    uploadStream.end(fileBuffer);
  });
};

// Get file from Cloudinary as buffer
exports.getFileFromCloudinary = async (publicId) => {
  try {
    // Generate signed URL for raw file
    const signedUrl = cloudinary.utils.api_sign_url(
      {
        public_id: publicId,
        resource_type: 'raw'
      },
      process.env.CLOUDINARY_API_SECRET
    );
    
    // For raw files, we use the download URL
    const downloadUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/raw/upload/${publicId}.xlsx`;
    
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.statusText}`);
    }
    
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
  } catch (error) {
    console.error('Error fetching file from Cloudinary:', error);
    throw error;
  }
};

// Search for reports in Cloudinary folder
exports.searchReports = async (folder = 'digitalmenu/reports', prefix = '') => {
  try {
    const result = await cloudinary.search
      .expression(`folder:${folder}/*`)
      .sort_by('created_at', 'desc')
      .max_results(100)
      .execute();
    
    return result.resources || [];
  } catch (error) {
    console.error('Error searching Cloudinary:', error);
    return [];
  }
};
