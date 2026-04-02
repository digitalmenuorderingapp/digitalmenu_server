const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Verify connection
(async () => {
  try {
    await cloudinary.api.ping();
    console.log('✅ Cloudinary Connected Successfully');
  } catch (error) {
    console.error('❌ Cloudinary Connection Failed:', error.message);
  }
})();

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
