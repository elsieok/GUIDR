#!/bin/bash
# Measures the response time of the deployed GUIDR service every 20 minutes. Stop with Ctrl+C.
URL="https://guidr-999781595196.us-central1.run.app/api/info"
while true; do
  echo "$(date '+%H:%M:%S')  $(curl -s -o /dev/null -w '%{time_total}' "$URL") s"
  sleep 1200
done