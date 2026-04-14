#!/bin/bash
# Seed initial content into Cloudflare KV from content.json
# Run from the "server/" directory:  bash seed-kv.sh

set -e

NAMESPACE_ID="3c15a60c562f495c8839ea1f251dfc6b"
CONTENT_FILE="../content.json"

if [ ! -f "$CONTENT_FILE" ]; then
  echo "ERROR: content.json not found at $CONTENT_FILE"
  exit 1
fi

PAGES=(home about our-approach meet-the-team sectors services company-formations governance ma-transactions spv-holding directorships accounting payroll-hr compliance-governance overseas-entities process-agent id-verification uk-afs insights international advisor-portal contact)

for page in "${PAGES[@]}"; do
  echo "Seeding: content:$page"
  # Extract the page object from content.json and put it into KV
  node -e "
    const fs = require('fs');
    const data = JSON.parse(fs.readFileSync('$CONTENT_FILE', 'utf8'));
    if (!data['$page']) { console.error('Page not found: $page'); process.exit(1); }
    fs.writeFileSync('/tmp/kv-$page.json', JSON.stringify({ content: data['$page'], updatedAt: new Date().toISOString(), updatedBy: 'system' }));
  "
  wrangler kv key put --namespace-id="$NAMESPACE_ID" "content:$page" --path="/tmp/kv-$page.json" --remote
  rm "/tmp/kv-$page.json"
done

echo ""
echo "✓ All pages seeded successfully"
