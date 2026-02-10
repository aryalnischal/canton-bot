#!/bin/bash

# Define paths
MONGOD_BIN="./mongodb-macos-aarch64-7.0.4/bin/mongod"
DATA_DIR="./mongodb_data"
LOG_FILE="./logs/mongod.log"

# Check if mongod is running
if pgrep -x "mongod" > /dev/null
then
    echo "✅ Database is already running."
else
    echo "🚀 Starting Database..."
    $MONGOD_BIN --dbpath $DATA_DIR --logpath $LOG_FILE --fork
    echo "✅ Database started."
    sleep 2
fi

# Start the Bot
echo "🤖 Starting Canton Bot (dYdX)..."
npx ts-node --project tsconfig.script.json -r tsconfig-paths/register scripts/standalone-bot.ts
