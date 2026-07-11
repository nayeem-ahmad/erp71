#!/bin/bash
# Script to remove the "New Sales Entry" navigation link from packages/shared-types/navigation.ts

# File path
FILE="packages/shared-types/navigation.ts"

# Remove the line containing layoutNode('sales.new', 'sales', 5),
sed -i "/layoutNode('sales\.new', 'sales', 5),/d" "$FILE"

echo "✅ Removed 'sales.new' from DEFAULT_TENANT_NAV_LAYOUT in $FILE"
