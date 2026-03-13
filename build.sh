#!/bin/bash
# Build script for Render deployment
echo "Installing Node.js dependencies..."
npm install

echo "Building frontend..."
npm run build

echo "Installing Python dependencies..."
pip install -r requirements.txt

echo "Build complete!"

