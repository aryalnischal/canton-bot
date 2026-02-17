#!/bin/bash

# Canton Trading Bot - Startup Script
# MongoDB connects automatically via MONGODB_URI in .env.local

echo "🤖 Starting Canton Bot (dYdX)..."
echo "   MongoDB: Cloud Atlas (auto-connect)"
echo "   Network: $(grep DYDX_NETWORK .env.local | cut -d= -f2)"
echo ""

npx tsx scripts/standalone-bot.ts
