#!/bin/bash
echo "Starting Mother System Server..."
cd server
node index.js &
SERVER_PID=$!

echo "Starting Mother System Dashboard..."
cd ../dashboard
npm run dev &
DASHBOARD_PID=$!

echo "Mother system is running."
echo "Server PID: $SERVER_PID"
echo "Dashboard PID: $DASHBOARD_PID"
echo "Press Ctrl+C to stop all."

trap "kill $SERVER_PID $DASHBOARD_PID; exit" INT TERM
wait
