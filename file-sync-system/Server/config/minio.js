// config/minio.js
const Minio = require('minio');

const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT,
  port: parseInt(process.env.MINIO_PORT),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
});

const BUCKET_NAME = process.env.MINIO_BUCKET;

async function initializeBucket() {
  try {
    const bucketExists = await minioClient.bucketExists(BUCKET_NAME);
    if (!bucketExists) {
      await minioClient.makeBucket(BUCKET_NAME);
      console.log(`Created MinIO bucket: ${BUCKET_NAME}`);
    } else {
      console.log(`MinIO bucket already exists: ${BUCKET_NAME}`);
    }
  } catch (error) {
    console.error('Error initializing MinIO bucket:', error);
  }
}

initializeBucket();

module.exports = { minioClient, BUCKET_NAME };
