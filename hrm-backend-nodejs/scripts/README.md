# Send to ALL employees
node scripts/sendWelcomeEmailToAll.js

# Preview without sending (dry run)
node scripts/sendWelcomeEmailToAll.js --dry-run

# Send to specific department
node scripts/sendWelcomeEmailToAll.js --department Engineering

# Send to specific organization
node scripts/sendWelcomeEmailToAll.js --org "Brainwave Technologie"

# Send only to employees (not managers/admins)
node scripts/sendWelcomeEmailToAll.js --role employee

# Combine filters
node scripts/sendWelcomeEmailToAll.js --department IT --org "DeBox"

# Skip confirmation prompt
node scripts/sendWelcomeEmailToAll.js --yes
```

**Features:**

1. **Filters** - Filter by department, organization, or role
2. **Dry run mode** - Preview who will receive emails without sending
3. **Progress bar** - Shows real-time progress with success/failure indicators
4. **Rate limiting** - 1 second delay between emails to avoid rate limits
5. **Confirmation prompt** - Asks before sending (use `--yes` to skip)
6. **Detailed summary** - Shows success/failed counts and error details

**Example output:**
```
╔════════════════════════════════════════════════════════════╗
║      🎉 Bulk Welcome Email Sender (All Employees)          ║
╚════════════════════════════════════════════════════════════╝

✅ Connected to MongoDB

📧 Found 5 employee(s) to send welcome emails:

┌─────────────────────────────────────────────────────────────────────
│ #   │ Employee ID │ Name                    │ Email                 │ Dept
├─────────────────────────────────────────────────────────────────────
│ 1   │ EMP0005     │ nidhi kumari            │ nidhi@brainwave...    │ Engineering
│ 2   │ EMP0009     │ Abhishek Sah            │ abhishek@brainwave... │ Engineering
│ 3   │ EMP0013     │ Divyansh Ranjan         │ divyansh@brainwave... │ Engineering
└─────────────────────────────────────────────────────────────────────

⚠️  Send welcome emails to 5 employee(s)? (yes/no): yes

📤 Sending welcome emails...

  [████████████████████] 100% (5/5) ✅ ytogosingh@gmail.com

╔════════════════════════════════════════════════════════════╗
║                      📊 SUMMARY                            ║
╠════════════════════════════════════════════════════════════╣
║  ✅ Successful:  5                                         ║
║  ❌ Failed:      0                                         ║
║  📧 Total:       5                                         ║
╚════════════════════════════════════════════════════════════╝

🎉 Welcome emails sent successfully!
⏰ Password setup links will expire in 24 hours.
