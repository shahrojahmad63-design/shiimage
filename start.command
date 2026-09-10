#!/bin/bash
cd "$(dirname "$0")"

echo "=========================================================="
echo "    🚀 Starting QuickDrop (Mac ⇄ Android Wi-Fi Share)   "
echo "=========================================================="

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not found. Please install Node.js."
    exit 1
fi

# Install dependencies if node_modules is missing
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Open default browser after 1.5 seconds
(sleep 1.5 && open "http://localhost:3000") &

# Start the server
node server.js
