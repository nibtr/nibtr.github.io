#!/usr/bin/env bash

# Usage: ./new_post.sh "some title"

set -e

TITLE="$1"

if [ -z "$TITLE" ]; then
  echo "Usage: $0 \"Post Title\""
  exit 1
fi

# Generate filename (slug)
OUTPUT_DIR=./src/content/posts
SLUG=$(echo "$TITLE" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g' | sed -E 's/^-|-$//g')

# Date formats
DATE=$(date +"%Y-%m-%dT%H:%M:%S%z")
FILENAME="${OUTPUT_DIR}/${SLUG}.md"

# Create file
cat <<EOF > "$FILENAME"
+++
title = "$TITLE"
date = "$DATE"
draft = true
+++

EOF

echo "Created $FILENAME"
