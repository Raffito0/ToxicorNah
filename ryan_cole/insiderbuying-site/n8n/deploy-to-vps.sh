#!/bin/bash
# Deploy n8n code files and system prompt to VPS
# Run from insiderbuying-site/ directory
#
# Usage: ssh root@72.62.61.93 'bash -s' < n8n/deploy-to-vps.sh
# Or: copy files manually via scp

VPS_N8N_CODE="/home/node/.n8n/code/insiderbuying"

echo "=== EarlyInsider n8n Deploy ==="

# Create code directory on n8n container
docker exec n8n-n8n-1 mkdir -p "$VPS_N8N_CODE"

echo "Deploying code files..."
for file in dexter-research.js select-keyword.js generate-article.js generate-image.js cross-link.js blog-helpers.js e2e-monitoring.js; do
  echo "  $file"
  docker cp "n8n/code/insiderbuying/$file" "n8n-n8n-1:$VPS_N8N_CODE/$file"
done

echo "Deploying system prompt..."
docker cp "FINANCIAL-ARTICLE-SYSTEM-PROMPT.md" "n8n-n8n-1:$VPS_N8N_CODE/FINANCIAL-ARTICLE-SYSTEM-PROMPT.md"

echo ""
echo "=== Deploy Complete ==="
echo ""
echo "Next steps:"
echo "1. Import 5 workflow JSON files via n8n UI:"
echo "   - n8n/workflows/insiderbuying/dexter-research.json"
echo "   - n8n/workflows/insiderbuying/w1-keyword-selection.json"
echo "   - n8n/workflows/insiderbuying/w2-article-generation.json"
echo "   - n8n/workflows/insiderbuying/w12-image-generation.json"
echo "   - n8n/workflows/insiderbuying/w13-cross-linking.json"
echo ""
echo "2. Set n8n environment variables in Settings > Environment Variables:"
echo "   NOCODB_BASE_URL, NOCODB_API_TOKEN, FINANCIAL_DATASETS_API_KEY,"
echo "   ANTHROPIC_API_KEY, KIE_API_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,"
echo "   R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL, TELEGRAM_BOT_TOKEN,"
echo "   TELEGRAM_CHAT_ID, DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD,"
echo "   REVALIDATION_TOKEN, SCREENSHOT_SERVER_URL"
echo ""
echo "3. Activate all 5 workflows"
echo "4. Insert test keyword in NocoDB and trigger W2 manually"
