#!/bin/bash
# ============================================================
# AXSUMA — Sostituzione immagini pagine interne
# Esegui questo script nella cartella "AXSUMA WEBSITE"
# Usage: chmod +x update-images.sh && ./update-images.sh
# ============================================================

echo "🔄 Aggiornamento immagini in corso..."

# --- ACCOUNTING ---
if [ -f "accounting.html" ]; then
  # Replace all generic Unsplash images with professional UK business ones
  sed -i.bak \
    -e 's|https://images.unsplash.com/photo-1552664730-d307ca884978[^"]*|https://images.unsplash.com/photo-1554469384-e58fac16e23a?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1497366216548-37526070297c[^"]*|https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1521791136064-7986c2920216[^"]*|https://images.unsplash.com/photo-1494145904049-0dca59b4bbad?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1522071820081-009f0129c71c[^"]*|https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1554224155-8d04cb21cd6c[^"]*|https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1526304640581-d334cdbbf45e[^"]*|https://images.unsplash.com/photo-1570126618953-d437176e8c79?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1486406146926-c627a92ad1ab[^"]*|https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1450101499163-c8848c66ca85[^"]*|https://images.unsplash.com/photo-1444653614773-995cb1ef9efa?w=1200\&q=80|g' \
    accounting.html
  echo "  ✅ accounting.html aggiornato"
else
  echo "  ⚠️  accounting.html non trovato"
fi

# --- COMPANY FORMATIONS ---
if [ -f "company-formations.html" ]; then
  sed -i.bak \
    -e 's|https://images.unsplash.com/photo-1552664730-d307ca884978[^"]*|https://images.unsplash.com/photo-1577415124269-fc1140a69e91?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1497366216548-37526070297c[^"]*|https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1521791136064-7986c2920216[^"]*|https://images.unsplash.com/photo-1541354329998-f4d9a9f9297f?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1522071820081-009f0129c71c[^"]*|https://images.unsplash.com/photo-1551836022-4c4c79ecde51?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1554224155-8d04cb21cd6c[^"]*|https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1526304640581-d334cdbbf45e[^"]*|https://images.unsplash.com/photo-1529655683826-aba9b3e77383?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1486406146926-c627a92ad1ab[^"]*|https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1450101499163-c8848c66ca85[^"]*|https://images.unsplash.com/photo-1494145904049-0dca59b4bbad?w=1200\&q=80|g' \
    company-formations.html
  echo "  ✅ company-formations.html aggiornato"
else
  echo "  ⚠️  company-formations.html non trovato"
fi

# --- GOVERNANCE ---
if [ -f "governance.html" ]; then
  sed -i.bak \
    -e 's|https://images.unsplash.com/photo-1552664730-d307ca884978[^"]*|https://images.unsplash.com/photo-1570126618953-d437176e8c79?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1497366216548-37526070297c[^"]*|https://images.unsplash.com/photo-1573167243872-43c6433b9d40?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1521791136064-7986c2920216[^"]*|https://images.unsplash.com/photo-1553877522-43269d4ea984?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1522071820081-009f0129c71c[^"]*|https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1554224155-8d04cb21cd6c[^"]*|https://images.unsplash.com/photo-1444653614773-995cb1ef9efa?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1526304640581-d334cdbbf45e[^"]*|https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1486406146926-c627a92ad1ab[^"]*|https://images.unsplash.com/photo-1551836022-4c4c79ecde51?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1450101499163-c8848c66ca85[^"]*|https://images.unsplash.com/photo-1541354329998-f4d9a9f9297f?w=1200\&q=80|g' \
    governance.html
  echo "  ✅ governance.html aggiornato"
else
  echo "  ⚠️  governance.html non trovato"
fi

# --- PROCESS AGENT ---
if [ -f "process-agent.html" ]; then
  sed -i.bak \
    -e 's|https://images.unsplash.com/photo-1552664730-d307ca884978[^"]*|https://images.unsplash.com/photo-1529655683826-aba9b3e77383?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1497366216548-37526070297c[^"]*|https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1521791136064-7986c2920216[^"]*|https://images.unsplash.com/photo-1494145904049-0dca59b4bbad?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1522071820081-009f0129c71c[^"]*|https://images.unsplash.com/photo-1553877522-43269d4ea984?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1554224155-8d04cb21cd6c[^"]*|https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1526304640581-d334cdbbf45e[^"]*|https://images.unsplash.com/photo-1448906654166-444d494666b3?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1486406146926-c627a92ad1ab[^"]*|https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200\&q=80|g' \
    -e 's|https://images.unsplash.com/photo-1450101499163-c8848c66ca85[^"]*|https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200\&q=80|g' \
    process-agent.html
  echo "  ✅ process-agent.html aggiornato"
else
  echo "  ⚠️  process-agent.html non trovato"
fi

# Cleanup backup files
echo ""
echo "🧹 Rimuovo file di backup (.bak)..."
rm -f *.bak 2>/dev/null
echo ""
echo "✅ Fatto! Tutte le immagini sono state aggiornate."
echo "   Apri le pagine nel browser per verificare il risultato."
