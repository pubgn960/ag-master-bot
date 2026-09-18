-- Uploaded Images Storage
CREATE TABLE IF NOT EXISTS uploaded_images (
  id UUID PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes INT NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_uploaded_images_created_at ON uploaded_images (created_at DESC);
