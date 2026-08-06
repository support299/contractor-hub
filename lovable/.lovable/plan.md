## Changes to `src/routes/admin.dashboard.tsx`

1. **Replace the "Role" pill (top right) with a Staff selector**
   - Load active users from `hub_users` (same source already used elsewhere, e.g. UsersMultiSelect / forms-store).
   - Render a shadcn `Select` labeled "Staff:" listing every user's name.
   - Default to the first user; selection drives the greeting ("Welcome back, {firstName}!") and the "Sarah (You)" highlight in the leaderboard.
   - No persistence; local component state only.

2. **Remove sections**
   - Delete the **Monthly Goals** card.
   - Delete the **Current Streak** card.
   - Delete the **Earned Badges** card.
   - Remove the now-unused helpers (`GoalRow`, `BadgeCard`, related lucide icons `Zap`, `ShieldCheck`, `Medal`, `Trophy` if unused after leaderboard keeps `Crown`).

3. **Move the Monthly Leaderboard to the right column**
   - Right column order: Google Review Performance (kept) → Monthly Leaderboard (moved here).
   - Left column order: Review Shoutout → Detailed Performance Metrics → Recent Client Feedback.
   - Keep the existing 2/3 + 1/3 grid; leaderboard rows stay as-is but the highlighted "(You)" row reflects the selected staff member.

No other files change. No backend/schema changes.